import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import express from "express";

// Real routes/session/permission policy, with only external Clerk, DB and feed
// boundaries replaced. No test login or trusted-role header is added to the app.
const source = `
export { default as router } from "./routes/transport";
export { permissionActor, savePermission } from "./lib/staff-permissions";
export { permissions, users, sessions } from "test-boundaries";
export { states } from "./lib/transport-store";
`;
const boundaries = `
export const permissions = new Map(), users = new Map(), sessions = new Map();
export const getAuth = req => ({userId:req.get("X-Test-User"),sessionId:req.get("X-Test-Session")});
export const clerkClient = {
  users:{getUser:async id=> users.get(id) ?? {id,primaryEmailAddressId:"email",emailAddresses:[{id:"email",verification:{status:"verified"}}]}},
  sessions:{getSession:async id=>sessions.get(id)??{status:"revoked",userId:"unknown"}}
};
const query = async (sql,args=[]) => {
  if(sql.startsWith("SELECT role, disabled")) return {rows:permissions.has(args[0])?[permissions.get(args[0])]:[]};
  if(sql==="SELECT user_id, role, disabled FROM fairride_staff_permissions") return {rows:[...permissions].map(([user_id,p])=>({user_id,...p}))};
  if(sql.startsWith("INSERT INTO fairride_staff_permissions")) {permissions.set(args[0],{role:args[1],disabled:args[2]});return {rows:[]};}
  if(sql.startsWith('SELECT user_id AS')) return {rows:[...permissions].filter(([id])=>!args.length||id===args[0]).map(([userId,p])=>({userId,...p,updatedAt:new Date()}))};
  return {rows:[]};
};
export const pool={query,connect:async()=>({query,release(){}})};
`;
const result = await build({
  stdin: { contents: source, resolveDir: new URL("../src/", import.meta.url).pathname },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{
    name: "auth-boundaries",
    setup(b) {
      b.onResolve({ filter: /^(@clerk\/express|@workspace\/db|test-boundaries)$/ }, () => ({ path: "boundaries", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: boundaries, loader: "js" }));
      b.onResolve({ filter: /transport-store$/ }, () => ({ path: "store", namespace: "store" }));
      b.onLoad({ filter: /.*/, namespace: "store" }, () => ({
        contents: `import {mockTransport} from "./transport-providers";
          export const states = new Map();
          export async function transportTransactionFor(mode,operation) {
            if(!states.has(mode))states.set(mode,{version:1,vehicles:structuredClone(mockTransport.vehicles),lines:mockTransport.lines,
              inspections:[],checkIns:[],updatedAt:new Date(0).toISOString()});
            return operation(states.get(mode));
          }`,
        resolveDir: new URL("../src/lib/", import.meta.url).pathname, loader: "js",
      }));
      b.onResolve({ filter: /transport-feed-service$/ }, () => ({ path: "feed", namespace: "feed" }));
      b.onLoad({ filter: /.*/, namespace: "feed" }, () => ({
        contents: `import {mockTransport} from "./transport-providers";export const transportSnapshot=async()=>({catalog:{...mockTransport.catalog(),feeds:[]},vehicles:mockTransport.vehicles,generatedAt:Date.now()});`,
        resolveDir: new URL("../src/lib/", import.meta.url).pathname, loader: "js",
      }));
    },
  }],
});
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { router, permissions, sessions, users, states, permissionActor, savePermission } = module.exports;
let server, base;
before(async () => {
  // A fixed test-only signing secret; never read or print a workspace secret.
  process.env.SESSION_SECRET = "unit-test-only-transport-signing";
  const app = express(); app.use(express.json()); app.use("/api", router);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/transport`;
});
after(() => server.close());
const uid = "user_PassengerA", staff = "user_ConductorA", other = "user_ConductorB", admin = "user_AdminA";
const verified = id => {
  sessions.set(`sess-${id}`, { status: "active", userId: id });
  return { "X-Test-User": id, "X-Test-Session": `sess-${id}`, "X-FairRide-Request": "1" };
};
const demo = { "X-FairRide-Mode": "demo", "X-FairRide-Demo": "1" };
async function call(path, headers = {}, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { response, status: response.status, data: response.status === 204 ? null : await response.json() };
}
const vehicle = "krakow-tram-14-0-TR-142";

test("unprovisioned verified accounts are Passenger; role changes keep immutable ownership", async () => {
  assert.deepEqual(permissionActor(uid), { id: `clerk:${uid}`, role: "USER" });
  assert.equal((await call("/account", verified(uid))).data.role, "USER");
  permissions.set(uid, { role: "CONDUCTOR", disabled: false });
  assert.deepEqual((await call("/account", verified(uid))).data, { id: `clerk:${uid}`, role: "CONDUCTOR" });
  permissions.delete(uid);
  assert.equal((await call("/account", verified(uid))).data.id, `clerk:${uid}`);
});
test("public demo selection requires explicit sandbox mode and cannot authenticate live endpoints", async () => {
  assert.equal((await call("/session", { "X-FairRide-Demo": "1" }, { role: "ADMIN" })).status, 403);
  const login = await call("/session", demo, { role: "ADMIN" });
  assert.equal(login.status, 200);
  const cookie = login.response.headers.getSetCookie().find(c => c.includes("Partitioned")).split(";")[0];
  const headers = { Cookie: cookie, "X-FairRide-Request": "1" };
  assert.equal((await call("/workspace", headers)).status, 401);
  assert.equal((await call("/account", { ...demo, ...headers })).status, 401);
  assert.equal((await call("/staff", { ...demo, ...headers })).status, 401);
  assert.equal((await call(`/vehicles/${vehicle}/inspection`, headers, { requestId: "demo-forged-live" })).status, 401);
  assert.equal((await call(`/vehicles/${vehicle}/inspection`, { ...demo, Cookie: cookie }, { requestId: "sandbox-inspection" })).status, 200);
  assert.equal(states.get("demo").inspections.length, 1);
  assert.equal((await call("/workspace", verified(uid))).data.inspections.length, 0);
});
test("forged roles/ownership/replay fields are rejected; Passenger never starts inspections", async () => {
  const headers = verified(uid);
  for (const field of ["role", "userId", "conductorId", "actor"]) {
    assert.equal((await call("/check-ins", headers, { vehicleId: vehicle, requestId: "forgery-test", [field]: "ADMIN" })).status, 400);
  }
  assert.equal((await call(`/vehicles/${vehicle}/inspection`, headers, { requestId: "passenger-inspection" })).status, 403);
  assert.equal((await call("/staff/" + staff, headers, { role: "ADMIN", disabled: false }, "PUT")).status, 403);
});
test("Passenger history is account-owned across sign-out/reload; staff see anonymous scoped references", async () => {
  permissions.set(staff, { role: "CONDUCTOR", disabled: false });
  permissions.set(other, { role: "CONDUCTOR", disabled: false });
  permissions.set(admin, { role: "ADMIN", disabled: false });
  const ticket = await call("/check-ins", verified(uid), { vehicleId: vehicle, requestId: "passenger-checkin" });
  assert.equal(ticket.status, 200);
  assert.equal((await call("/workspace", verified("user_PassengerB"))).data.checkIns.length, 0);
  const inspection = await call(`/vehicles/${vehicle}/inspection`, verified(staff), { requestId: "verified-inspection" });
  assert.equal(inspection.status, 200);
  const owner = (await call("/workspace", verified(staff))).data;
  assert.equal(owner.checkIns[0].userId, ""); assert.equal(owner.checkIns[0].requestId, "");
  assert.equal((await call("/workspace", verified(other))).data.checkIns.length, 0);
  const passenger = (await call("/workspace", verified(uid))).data;
  assert.equal(passenger.checkIns[0].id, ticket.data.id);
  assert.equal(passenger.inspections[0].conductorId, "");
  assert.equal((await call(`/inspections/${inspection.data.id}/end`, verified(other), {})).status, 403);
  assert.equal((await call("/check-ins", verified(staff), { vehicleId: vehicle, requestId: "staff-board" })).status, 403);
  sessions.set(`sess-${uid}`, { status: "revoked", userId: uid });
  assert.equal((await call("/workspace", { "X-Test-User": uid, "X-Test-Session": `sess-${uid}` })).status, 401);
  // A new valid sign-in has exactly the same ownership.
  assert.equal((await call("/workspace", verified(uid))).data.checkIns[0].id, ticket.data.id);
  assert.equal((await call(`/check-ins/${ticket.data.id}/checkout`, verified("user_PassengerB"), {})).status, 403);
  assert.equal((await call(`/check-ins/${ticket.data.id}/checkout`, verified(uid), {})).status, 200);
  // Demotion blocks the conductor's old session without changing lock ownership.
  permissions.set(staff, { role: "USER", disabled: false });
  assert.equal((await call(`/inspections/${inspection.data.id}/end`, verified(staff), {})).status, 403);
  permissions.set(staff, { role: "CONDUCTOR", disabled: true });
  assert.equal((await call("/workspace", verified(staff))).status, 403);
  assert.equal((await call(`/inspections/${inspection.data.id}/end`, verified(admin), {})).status, 200);
  permissions.set(staff, { role: "CONDUCTOR", disabled: false });
  const history = (await call("/workspace", verified(staff))).data;
  assert.equal(history.inspections[0].id, inspection.data.id);
  assert.equal(history.inspections[0].conductorId, `clerk:${staff}`);
  assert.equal(history.checkIns.length, 0);
  assert.equal((await call("/workspace", verified(other))).data.inspections.length, 0);
});
test("verified primary email and active user are required; stale metadata cannot grant a role", async () => {
  users.set("user_Unverified", { primaryEmailAddressId: "email", emailAddresses: [{ id: "email", verification: { status: "unverified" } }], publicMetadata: { role: "ADMIN" } });
  assert.equal((await call("/account", verified("user_Unverified"))).status, 403);
  users.set("user_Banned", { banned: true, primaryEmailAddressId: "email", emailAddresses: [{ id: "email", verification: { status: "verified" } }] });
  assert.equal((await call("/account", verified("user_Banned"))).status, 403);
  assert.equal((await call("/account", verified("user_MetadataAdmin"))).data.role, "USER");
});
test("permission updates require Admin; last active Admin and repeated bootstrap are protected", async () => {
  await assert.rejects(() => savePermission(`clerk:${uid}`, other, "ADMIN", false), e => e.status === 403);
  await assert.rejects(() => savePermission("operator", "user_NewAdmin", "ADMIN", false, true), e => e.status === 409);
  await assert.rejects(() => savePermission(`clerk:${admin}`, admin, "USER", false), e => e.status === 409);
  await assert.rejects(() => savePermission(`clerk:${admin}`, admin, "ADMIN", true), e => e.status === 409);
  const record = await savePermission(`clerk:${admin}`, other, "USER", false);
  assert.equal(record.role, "USER");
  assert.equal((await call("/account", verified(other))).data.role, "USER");
});
test("browser cross-origin mutations are rejected even with valid custom headers", async () => {
  assert.equal((await call("/check-ins", { ...verified(uid), "Sec-Fetch-Site": "cross-site" }, { vehicleId: vehicle, requestId: "cross-origin-checkin" })).status, 403);
});