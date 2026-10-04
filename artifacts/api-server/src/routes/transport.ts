import { Router } from "express";
import { CreateDemoTransportSessionBody, CreateVehicleCheckInBody, StartVehicleInspectionBody, SetTransportStaffBody } from "@workspace/api-zod";
import { actorFor, demoActorFor, setDemoRole, transportMode, verifiedActorFor } from "../lib/transport-session";
import { TransportError, startInspection, endInspection, checkInVehicle, checkOutVehicle } from "../lib/transport-domain";
import { transportTransactionFor } from "../lib/transport-store";
import { transportSnapshot } from "../lib/transport-feed-service";
import { mockTransport } from "../lib/transport-providers";
import { workspaceFor } from "../lib/transport-privacy";
import { listPermissions, savePermission } from "../lib/staff-permissions";

const router = Router();
router.use("/transport", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  // Custom-header + JSON mutations are not cross-site HTML form requests.
  // Partitioned cookies isolate embedding sites; CORS without credentials
  // prevents cross-origin custom-header requests using an existing session.
  if (!["GET", "HEAD"].includes(req.method)) {
    if (req.get("X-FairRide-Demo") !== "1" && req.get("X-FairRide-Request") !== "1") {
      res.status(403).json({ error: "Same-origin transport request required." }); return;
    }
    // Credentials are never enabled in CORS. Also reject browser cross-site
    // requests directly, including same-site sibling subdomains.
    const site = req.get("Sec-Fetch-Site");
    if (site && site !== "same-origin" && site !== "none") {
      res.status(403).json({ error: "Cross-origin transport mutations are forbidden." }); return;
    }
    const allowed = req.path.endsWith("/session") ? ["role"] :
      /^\/staff\/[^/]+$/.test(req.path) ? ["role", "disabled"] :
      req.path === "/check-ins" ? ["vehicleId", "requestId"] :
      req.path.endsWith("/inspection") ? ["requestId"] : [];
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => !allowed.includes(key)))) {
      res.status(400).json({ error: "Unexpected request fields. Identity and permissions are server-owned." }); return;
    }
  }
  next();
});
router.post("/transport/session", (req, res) => {
  const body = CreateDemoTransportSessionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose Passenger, Conductor or Admin." }); return; }
  res.json(setDemoRole(req, res, body.data.role));
});
router.get("/transport/session", (req, res) => {
  if (transportMode(req) !== "demo") throw new TransportError(403, "Demo mode required.");
  res.json(demoActorFor(req));
});
router.delete("/transport/session", (req, res) => { setDemoRole(req, res, null); res.status(204).end(); });
router.get("/transport/account", async (req, res) => { res.json(await verifiedActorFor(req)); });
router.get("/transport/staff", async (req, res) => {
  if ((await verifiedActorFor(req)).role !== "ADMIN") throw new TransportError(403, "Verified Admin access required.");
  res.json(await listPermissions());
});
router.put("/transport/staff/:userId", async (req, res) => {
  const actor = await verifiedActorFor(req);
  if (actor.role !== "ADMIN") throw new TransportError(403, "Verified Admin access required.");
  const body = SetTransportStaffBody.safeParse(req.body);
  if (!body.success) throw new TransportError(400, "Choose a valid role and suspension status.");
  res.json(await savePermission(actor.id, String(req.params.userId), body.data.role, body.data.disabled));
});
router.get("/transport/catalog", async (req, res) => {
  if (transportMode(req) === "demo") {
    res.json({ ...mockTransport.catalog(), feeds: [], sourceNotice: "Isolated DEMO fleet. No live operations or verified account data." }); return;
  }
  const snapshot = await transportSnapshot();
  const lines = await transportTransactionFor("verified", state => state.lines ?? snapshot.catalog.lines, false);
  res.json({ ...snapshot.catalog, lines });
});
router.get("/transport/workspace", async (req, res) => {
  const actor = await actorFor(req);
  res.json(await transportTransactionFor(transportMode(req), (state, current = actor) => workspaceFor(state, current), false, actor));
});
router.post("/transport/vehicles/:vehicleId/inspection", async (req, res) => {
  const actor = await actorFor(req);
  const body = StartVehicleInspectionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid inspection request." }); return; }
  res.json(await transportTransactionFor(transportMode(req), (state, current = actor) => startInspection(state, current, String(req.params.vehicleId), body.data.requestId, state.lines ?? []), true, actor));
});
router.post("/transport/inspections/:inspectionId/end", async (req, res) => {
  const actor = await actorFor(req);
  res.json(await transportTransactionFor(transportMode(req), (state, current = actor) => endInspection(state, current, String(req.params.inspectionId)), true, actor));
});
router.post("/transport/check-ins", async (req, res) => {
  const actor = await actorFor(req);
  const body = CreateVehicleCheckInBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid check-in request." }); return; }
  const result = await transportTransactionFor(transportMode(req), (state, current = actor) => checkInVehicle(state, current, body.data.vehicleId, body.data.requestId), true, actor);
  if (result.blocked) {
    res.status(423).json({ error: "Ticket inspection in progress. New check-ins are temporarily unavailable for this vehicle.", code: "CHECK_IN_LOCKED" }); return;
  }
  res.json(result.checkIn);
});
router.post("/transport/check-ins/:checkInId/checkout", async (req, res) => {
  const actor = await actorFor(req);
  res.json(await transportTransactionFor(transportMode(req), (state, current = actor) => checkOutVehicle(state, current, String(req.params.checkInId)), true, actor));
});
router.use("/transport", (error: unknown, req: Parameters<typeof actorFor>[0], res: import("express").Response, _next: import("express").NextFunction) => {
  if (error instanceof TransportError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ event: "transport_operation_failed" }, "Transport operation failed");
  res.status(503).json({ error: "Transport service is temporarily unavailable. No successful operation was confirmed. Retry to refresh server state." });
});
export default router;