import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

// Real PostgreSQL locking, separate pools and isolated schema; no real Google.
const require = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const serverRequire = createRequire(new URL('../package.json', import.meta.url));
const { Pool } = require('pg');
// Never exercise identity tests with a workspace secret.
process.env.SESSION_SECRET = 'test-only-shared-secret-not-a-production-credential';
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `transit_test_${process.pid}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const options = { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 20 };
const poolA = new Pool(options);
let poolB = new Pool(options);
await poolA.query(`CREATE TABLE transit_budget (
  id text PRIMARY KEY, day_start timestamptz NOT NULL, daily integer NOT NULL DEFAULT 0,
  minute_start timestamptz NOT NULL, minute integer NOT NULL DEFAULT 0,
  leases jsonb NOT NULL DEFAULT '[]'::jsonb,
  passengers jsonb NOT NULL DEFAULT '[]'::jsonb)`);
const load = async (path, replacements = {}) => {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  return { url, module: await import(url) };
};
const google = await load('../src/lib/google-transit.ts');
const budget = await load('../src/lib/transit-budget.ts', {
  'import { pool } from "@workspace/db";': 'const pool = globalThis.__transitTestPool;',
  '"./google-transit"': JSON.stringify(google.url),
});
const { createTransitBudgetGate, TransitBudgetError } = budget.module;
const identity = await load('../src/lib/transit-identity.ts', {
  '"./transit-budget"': JSON.stringify(budget.url),
});
const { transitPassengerId } = identity.module;
let peerSequence = 0;
const testGate = database => {
  const gate = createTransitBudgetGate(database);
  // Global-limit tests use distinct peers; per-peer tests pass an explicit ID.
  return { ...gate, reserve: (id = (++peerSequence).toString(16).padStart(64, '0')) => gate.reserve(id) };
};
const gateA = () => testGate(poolA);
const gateB = () => testGate(poolB);
const reset = () => poolA.query('TRUNCATE transit_budget');
after(async () => {
  await Promise.all([poolA.end(), poolB.end()]);
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('simultaneous first reservations across pools cannot exceed four active slots', async () => {
  await reset();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
    (i % 2 ? gateA() : gateB()).reserve()));
  const accepted = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  assert.equal(accepted.length, 4);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429));
  const row = (await poolA.query('SELECT * FROM transit_budget')).rows[0];
  assert.equal(row.daily, 4);
  assert.equal(row.minute, 4);
  assert.equal(row.leases.length, 4);
  await Promise.all(accepted.map(r => gateB().release(r.token)));
  assert.equal((await poolA.query('SELECT leases FROM transit_budget')).rows[0].leases.length, 0);
});

test('last daily unit is atomic, and survives a fresh pool and gate (restart)', async () => {
  await reset();
  const first = await gateA().reserve();
  await gateA().release(first.token);
  await poolA.query('UPDATE transit_budget SET daily=499');
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) =>
    (i % 2 ? gateA() : gateB()).reserve()));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r =>
    r.reason.status === 429 && r.reason.retryAfter > 86000));
  await poolB.end();
  poolB = new Pool(options);
  await assert.rejects(gateB().reserve(), { status: 429 });
  assert.equal((await poolA.query('SELECT daily FROM transit_budget')).rows[0].daily, 500);
});

test('global minute cap remains 30 and rolling windows use database time', async () => {
  await reset();
  for (let i = 0; i < 30; i++) {
    const gate = i % 2 ? gateA() : gateB();
    const r = await gate.reserve(); await gate.release(r.token);
  }
  await assert.rejects(gateB().reserve(), { status: 429, retryAfter: 60 });
  await poolA.query("UPDATE transit_budget SET minute_start=clock_timestamp()-interval '61 seconds'");
  const next = await gateB().reserve(); await gateB().release(next.token);
  const row = (await poolA.query('SELECT daily, minute FROM transit_budget')).rows[0];
  assert.deepEqual(row, { daily: 31, minute: 1 });
  await poolA.query("UPDATE transit_budget SET day_start=clock_timestamp()-interval '25 hours', daily=500");
  const renewed = await gateA().reserve(); await gateA().release(renewed.token);
  assert.equal((await poolA.query('SELECT daily FROM transit_budget')).rows[0].daily, 1);
});

test('crashed worker leases expire; late releases never remove a new lease or refund counters', async () => {
  await reset();
  const old = await gateA().reserve();
  await poolA.query(`UPDATE transit_budget SET leases=$1::jsonb`, [
    JSON.stringify(Array.from({ length: 4 }, (_, i) => ({ token: `${i}`, expiresAt: 1 }))),
  ]);
  const next = await gateB().reserve();
  await gateA().release(old.token);
  const row = (await poolA.query('SELECT * FROM transit_budget')).rows[0];
  assert.equal(row.daily, 2);
  assert.equal(row.leases.length, 1);
  assert.equal(row.leases[0].token, next.token);
  assert.deepEqual(Object.keys(row.leases[0]).sort(), ['expiresAt', 'token']);
  await gateB().release(next.token);
});

// Exercise the actual route without sockets. Express installs the production
// body validator; only its compute dependency is mocked.
const routeSource = await fs.readFile(new URL('../src/routes/transit.ts', import.meta.url), 'utf8');
const compiledRouter = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('from "express"', `from ${JSON.stringify(pathToFileURL(serverRequire.resolve('express')).href)}`)
  .replace('from "@workspace/api-zod"', `from ${JSON.stringify((await (async () => {
    const built = await build({ entryPoints: [serverRequire.resolve('@workspace/api-zod')],
      bundle: true, write: false, platform: 'node', format: 'esm' });
    return `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
  })()))}`)
  .replace('from "../lib/google-transit"', `from ${JSON.stringify(google.url)}`)
  .replace('from "../lib/transit-budget"', `from ${JSON.stringify(budget.url)}`)
  .replace('from "../lib/transit-identity"', `from ${JSON.stringify(identity.url)}`);
const { createTransitRouter } = await import(`data:text/javascript;base64,${Buffer.from(compiledRouter).toString('base64')}`);
const invoke = async (router, body = { origin: { lat: 50, lng: 19 }, destination: { lat: 51, lng: 20 } }, peer = {}) => {
  const layer = router.stack.find(l => l.route?.path === '/transit/routes');
  const headers = {};
  const res = Object.assign(new (await import('node:events')).EventEmitter(), {
    statusCode: 200, destroyed: false, writableEnded: false,
    setHeader(k, v) { headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; this.writableEnded = true; return this; },
  });
  await layer.route.stack[0].handle({
    body, ip: '203.0.113.99', socket: { remoteAddress: '192.0.2.10' }, log: { warn() {} }, ...peer,
  }, res);
  return { status: res.statusCode, body: res.body, headers };
};

test('no Google call after exhausted budget, failed DB, invalid input or expired reservation', async () => {
  await reset();
  const r = await gateA().reserve(); await gateA().release(r.token);
  await poolA.query('UPDATE transit_budget SET daily=500');
  let calls = 0;
  const compute = async () => { calls++; return { routes: [] }; };
  const exhausted = await invoke(createTransitRouter(gateB(), compute));
  assert.equal(exhausted.status, 429);
  assert.match(exhausted.body.error, /500/);
  assert.ok(Number(exhausted.headers['Retry-After']) > 0);
  assert.equal(exhausted.headers['Cache-Control'], 'no-store');
  const broken = createTransitBudgetGate({ connect: async () => { throw new Error('private credentials'); } });
  const failed = await invoke(createTransitRouter(broken, compute));
  assert.equal(failed.status, 503);
  assert.match(failed.body.error, /Nie wysłano/);
  assert.ok(!failed.body.error.includes('private'));
  assert.equal((await invoke(createTransitRouter(broken, compute), {})).status, 400);
  const expired = { reserve: async () => ({ token: 'expired', usable: () => false }), release: async () => {} };
  assert.equal((await invoke(createTransitRouter(expired, compute))).status, 503);
  assert.equal(calls, 0);
});

test('successful and failing Google calls consume the shared 12/min cap across routers', async () => {
  await reset();
  let calls = 0;
  const compute = async () => {
    calls++;
    if (calls === 1) throw new google.module.TransitError(503, 'Google chwilowo niedostępne.');
    return { provider: 'google', routes: [] };
  };
  const routers = [createTransitRouter(gateA(), compute), createTransitRouter(gateB(), compute)];
  assert.equal((await invoke(routers[0])).status, 503);
  for (let i = 1; i < 12; i++) assert.equal((await invoke(routers[i % 2])).status, 200);
  for (const router of routers) {
    const blocked = await invoke(router);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
    assert.equal(blocked.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls, 12);
  const row = (await poolA.query('SELECT * FROM transit_budget')).rows[0];
  assert.equal(row.daily, 12);
  assert.equal(row.leases.length, 0);
  assert.deepEqual(Object.keys(row.passengers[0]).sort(), ['count', 'expiresAt', 'id']);
  assert.equal(row.passengers[0].count, 12);
  assert.equal(row.passengers[0].id, transitPassengerId('192.0.2.10'));
  assert.ok(!JSON.stringify(row).includes('192.0.2.10'));
});

test('HMAC identity is canonical, keyed, domain-separated and never accepts an unknown peer', () => {
  const id = transitPassengerId('192.0.2.10');
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(id, transitPassengerId('::ffff:192.0.2.10'));
  assert.equal(id, transitPassengerId('::ffff:c000:020a'));
  assert.equal(transitPassengerId('2001:0db8:0:0:0:0:0:1'), transitPassengerId('2001:db8::1'));
  assert.notEqual(id, transitPassengerId('192.0.2.10', 'different-test-secret'));
  assert.notEqual(id, transitPassengerId('192.0.2.11'));
  assert.throws(() => transitPassengerId(undefined), { status: 503 });
  assert.throws(() => transitPassengerId('unknown'), { status: 503 });
  assert.throws(() => transitPassengerId('192.0.2.10', ''), { status: 503 });
});

test('competing instances cannot spend the thirteenth unit; restarts and releases do not reset the passenger', async () => {
  await reset();
  const id = transitPassengerId('192.0.2.11');
  for (let i = 0; i < 11; i++) {
    const gate = i % 2 ? gateA() : gateB();
    const r = await gate.reserve(id); await gate.release(r.token);
  }
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) =>
    (i % 2 ? gateA() : gateB()).reserve(id)));
  const accepted = results.filter(r => r.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429));
  await gateB().release(accepted[0].value.token);
  await poolB.end(); poolB = new Pool(options);
  await assert.rejects(gateB().reserve(id), { status: 429 });
  const row = (await poolA.query('SELECT * FROM transit_budget')).rows[0];
  assert.equal(row.daily, 12);
  assert.equal(row.minute, 12);
  assert.equal(row.passengers[0].count, 12);
  const other = await gateB().reserve(transitPassengerId('192.0.2.12'));
  await gateB().release(other.token);
});

test('passenger expiry uses DB time, prunes old pseudonyms and is independent of global windows', async () => {
  await reset();
  const id = transitPassengerId('192.0.2.11');
  for (let i = 0; i < 12; i++) {
    const r = await gateA().reserve(id); await gateA().release(r.token);
  }
  const original = (await poolA.query('SELECT passengers FROM transit_budget')).rows[0].passengers;
  await poolA.query("UPDATE transit_budget SET minute_start=clock_timestamp()-interval '61 seconds'");
  await assert.rejects(gateB().reserve(id), { status: 429 });
  assert.deepEqual((await poolA.query('SELECT passengers FROM transit_budget')).rows[0].passengers, original);
  await poolA.query(`UPDATE transit_budget SET passengers=
    (SELECT jsonb_agg(jsonb_set(p, '{expiresAt}', '1'::jsonb)) FROM jsonb_array_elements(passengers) p)`);
  const another = await gateB().reserve(transitPassengerId('192.0.2.12'));
  await gateB().release(another.token);
  assert.equal((await poolA.query('SELECT passengers FROM transit_budget')).rows[0].passengers.length, 1);
  const renewed = await gateB().reserve(id); await gateB().release(renewed.token);
  const row = (await poolA.query('SELECT * FROM transit_budget')).rows[0];
  const fresh = row.passengers.find(p => p.id === id);
  assert.equal(fresh.count, 1);
  assert.ok(fresh.expiresAt > original[0].expiresAt);
  assert.equal(row.daily, 14);
  assert.equal(row.minute, 2);
});

test('forwarding headers and req.ip cannot bypass socket identity; invalid identity and missing secret fail closed', async () => {
  await reset();
  let calls = 0;
  const compute = async () => { calls++; return { routes: [] }; };
  const routers = [createTransitRouter(gateA(), compute), createTransitRouter(gateB(), compute)];
  for (let i = 0; i < 12; i++) {
    assert.equal((await invoke(routers[i % 2], undefined, {
      ip: `203.0.113.${i}`,
      headers: { 'x-forwarded-for': `203.0.113.${i}`, 'forwarded': `for=203.0.113.${i}`,
        'x-real-ip': `203.0.113.${i}` },
      socket: { remoteAddress: i % 2 ? '::ffff:192.0.2.10' : '192.0.2.10' },
    })).status, 200);
  }
  assert.equal((await invoke(routers[1], undefined, { ip: '198.51.100.1' })).status, 429);
  assert.equal((await invoke(routers[0], undefined, { socket: {} })).status, 503);
  process.env.SESSION_SECRET = '';
  try {
    const failed = await invoke(routers[1]);
    assert.equal(failed.status, 503);
    assert.equal(failed.headers['Retry-After'], '60');
    assert.match(failed.body.error, /Nie wysłano/);
  } finally { process.env.SESSION_SECRET = 'test-only-shared-secret-not-a-production-credential'; }
  assert.equal(calls, 12);
  await assert.rejects(gateA().reserve('192.0.2.10'), { status: 503 });
  assert.equal((await poolA.query('SELECT daily FROM transit_budget')).rows[0].daily, 12);
});

test('missing schema and row-lock timeout fail closed without a Google call', async () => {
  await reset();
  let calls = 0;
  const compute = async () => { calls++; return { routes: [] }; };
  await poolA.query('ALTER TABLE transit_budget RENAME TO unavailable_budget');
  try {
    const result = await invoke(createTransitRouter(gateB(), compute));
    assert.equal(result.status, 503);
    assert.match(result.body.error, /Nie wysłano/);
  } finally {
    await poolA.query('ALTER TABLE unavailable_budget RENAME TO transit_budget');
  }
  const r = await gateA().reserve(); await gateA().release(r.token);
  const blocker = await poolA.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM transit_budget FOR UPDATE');
    const result = await invoke(createTransitRouter(gateB(), compute));
    assert.equal(result.status, 503);
    assert.equal(result.headers['Retry-After'], '60');
  } finally {
    await blocker.query('ROLLBACK'); blocker.release();
  }
  assert.equal(calls, 0);
  assert.equal((await poolA.query('SELECT daily FROM transit_budget')).rows[0].daily, 1);
});

test('ambiguous COMMIT consumes capacity conservatively but never invokes Google', async () => {
  await reset();
  let calls = 0;
  const uncertain = createTransitBudgetGate({
    async connect() {
      const client = await poolA.connect();
      return {
        async query(config) {
          const result = await client.query(config);
          if (config.text === 'COMMIT') throw new Error('lost acknowledgment');
          return result;
        },
        release(destroy) { client.release(destroy); },
      };
    },
  });
  const result = await invoke(createTransitRouter(uncertain, async () => { calls++; }));
  assert.equal(result.status, 503);
  assert.equal(calls, 0);
  assert.equal((await poolB.query('SELECT daily FROM transit_budget')).rows[0].daily, 1);
});