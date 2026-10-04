import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Isolated PostgreSQL schema, controlled fetch only: never contacts a real geocoder.
const require = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = require('pg');
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `geocoding_test_${process.pid}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 30 });
await pool.query(`CREATE TABLE geocoding_cache(key text PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE geocoding_gate(id integer PRIMARY KEY,next_at timestamptz NOT NULL);
CREATE TABLE geocoding_usage(id serial PRIMARY KEY,requested_at timestamptz NOT NULL);`);
globalThis.__geocodingTestPool = pool;
const source = (await fs.readFile(new URL('../src/lib/geocoding.ts', import.meta.url), 'utf8'))
  .replace('import { pool } from "@workspace/db";', 'const pool = globalThis.__geocodingTestPool;');
const compile = text => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const replicaA = await import(compile(source));
const replicaB = await import(compile(`${source}\n// Second API replica`));
delete globalThis.__geocodingTestPool;
const config = { url: new URL('https://api.geoapify.com/v1/geocode/search'), interval: 1500,
  dailyLimit: 2700, apiKey: 'test-only-key', secret: 'test-only-not-a-credential' };
const feature = { geometry: { type: 'Point', coordinates: [19.936, 50.054] }, properties: { name: 'Test place', city: 'Kraków', extra: 'discard' } };
const originalFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

const reset = () => pool.query('TRUNCATE geocoding_cache, geocoding_gate, geocoding_usage');
test('reverse GPS lookup validates, sanitizes and shares the search quota without persisting the address', async () => {
  await reset();
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(url.pathname, '/v1/geocode/reverse');
    assert.equal(url.searchParams.get('lat'), '50.06');
    assert.equal(url.searchParams.get('lon'), '19.94');
    assert.equal(url.searchParams.has('text'), false);
    return Response.json({ features: [feature] });
  };
  const result = await replicaA.reverseAddress(50.06, 19.94, { ...config, dailyLimit: 1 });
  assert.equal(result.features[0].properties.extra, undefined);
  assert.equal((await pool.query('SELECT * FROM geocoding_cache')).rowCount, 0);
  assert.throws(() => replicaA.reverseAddress(NaN, 19, config), { status: 400 });
  assert.throws(() => replicaA.reverseAddress(91, 19, config), { status: 400 });
  assert.throws(() => replicaA.reverseAddress(50, 181, config), { status: 400 });
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  await assert.rejects(replicaB.searchAddresses('Search after GPS', { ...config, dailyLimit: 1 }), { status: 429 });
  await assert.rejects(replicaB.reverseAddress(50.06, 19.94, { ...config, dailyLimit: 1 }), { status: 429 });
  assert.equal(calls, 1);
});
test('reverse provider failures use shared cooldown and never persist response data', async () => {
  for (const reply of [async () => { throw new Error('private'); }, async () => Response.json({ wrong: true }),
    async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })]) {
    await reset(); globalThis.fetch = reply;
    await assert.rejects(replicaA.reverseAddress(50, 19, config));
    await assert.rejects(replicaB.searchAddresses('No retry storm', config), { status: 429 });
    assert.equal((await pool.query('SELECT * FROM geocoding_cache')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM geocoding_usage')).rowCount, 1);
  }
});
test('requires explicit capacity, a server key and quota within the supported plan', () => {
  const valid = { GEOAPIFY_API_KEY: config.apiKey, GEOCODING_INTERVAL_MS: '1500',
    GEOCODING_CAPACITY_CONFIRMED: 'true', SESSION_SECRET: config.secret };
  assert.equal(replicaA.providerConfig(valid).interval, 1500);
  assert.equal(replicaA.providerConfig(valid).dailyLimit, 2700);
  assert.equal(replicaA.providerConfig({ ...valid, GEOCODING_PHOTON_URL: 'https://photon.komoot.io/api/' }).url.href, config.url.href);
  for (const override of [
    { GEOCODING_CAPACITY_CONFIRMED: 'false' }, { GEOAPIFY_API_KEY: '' },
    { GEOCODING_DAILY_LIMIT: '3001' }, { GEOCODING_DAILY_LIMIT: '0' }, { GEOCODING_INTERVAL_MS: '0' },
  ]) assert.throws(() => replicaA.providerConfig({ ...valid, ...override }), { status: 503 });
});

test('parallel passengers across replicas share one provider slot and one cache', async () => {
  await reset();
  let calls = 0;
  let release;
  let started;
  const fetching = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get('text'), 'Test place');
    assert.equal(new URL(url).searchParams.get('apiKey'), config.apiKey);
    assert.equal(new URL(url).searchParams.get('format'), 'geojson');
    assert.equal(new URL(url).searchParams.has('filter'), false);
    assert.equal(options.redirect, 'error');
    started();
    await pending;
    return Response.json({ features: [feature] });
  };
  const first = replicaA.searchAddresses('Test place', config);
  await fetching;
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
    (i % 2 ? replicaA : replicaB).searchAddresses(`Passenger ${i}`, config)));
  assert.ok(attempts.every(result => result.status === 'rejected' && result.reason.status === 429));
  assert.equal(calls, 1);
  release();
  const result = await first;
  assert.equal(result.provider, 'geoapify');
  assert.equal(result.features[0].properties.extra, undefined);
  assert.deepEqual(await replicaB.searchAddresses('test PLACE', config), result);
  assert.equal(calls, 1);
  await assert.rejects(replicaB.searchAddresses('Other address', config), { status: 429 });
  const rows = await pool.query('SELECT * FROM geocoding_cache');
  assert.equal(rows.rowCount, 1);
  assert.match(rows.rows[0].key, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(rows.rows[0]).includes('Passenger'));
});

test('cache expires, empty results cache, provider throttling shares a cooldown', async () => {
  await reset();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ features: [] }); };
  assert.deepEqual((await replicaA.searchAddresses('Empty address', config)).features, []);
  await replicaB.searchAddresses('empty address', config);
  assert.equal(calls, 1);
  await pool.query("UPDATE geocoding_cache SET expires_at='epoch'; UPDATE geocoding_gate SET next_at='epoch'");
  await replicaB.searchAddresses('Empty address', config);
  assert.equal(calls, 2);
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); };
  await assert.rejects(replicaA.searchAddresses('Busy provider', config), { status: 429, retryAfter: 120 });
  await assert.rejects(replicaB.searchAddresses('Another query', config), error => error.status === 429 && error.retryAfter >= 119);
  assert.equal(calls, 3);
  await pool.query("UPDATE geocoding_cache SET expires_at='epoch'");
  await replicaA.purgeExpiredGeocodingCache();
  assert.equal((await pool.query('SELECT * FROM geocoding_cache')).rowCount, 0);
});

test('network/timeout/malformed/oversized failures never leak provider details and release locks', async () => {
  for (const mock of [
    async () => { throw new Error('Sensitive provider URL with address'); },
    async () => { throw new DOMException('Sensitive query', 'TimeoutError'); },
    async () => Response.json({ error: 'Sensitive provider response' }),
    async () => new Response('x'.repeat(129 * 1024)),
  ]) {
    await reset();
    globalThis.fetch = mock;
    await assert.rejects(replicaA.searchAddresses('Private input', config));
    const client = await pool.connect();
    try {
      assert.equal((await client.query('SELECT pg_try_advisory_lock(731904201) AS locked')).rows[0].locked, true);
      await client.query('SELECT pg_advisory_unlock(731904201)');
    } finally { client.release(); }
    await assert.rejects(replicaB.searchAddresses('Other input', config), { status: 429 });
    assert.equal((await pool.query('SELECT * FROM geocoding_cache')).rowCount, 0);
  }
  assert.deepEqual(replicaA.sanitizeGeocoding({ features: [null, { ...feature, geometry: { type: 'Point', coordinates: ['19', 50] } }] }).features, []);
});

test('rolling 24-hour quota is shared, survives replicas/restarts and counts failed attempts', async () => {
  await reset();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ features: [] }); };
  const lowQuota = { ...config, dailyLimit: 2 };
  await replicaA.searchAddresses('First address', lowQuota);
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  await replicaB.searchAddresses('Second address', lowQuota);
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  await assert.rejects(replicaA.searchAddresses('Third address', lowQuota), error => error.status === 429 && error.retryAfter > 86300);
  assert.equal(calls, 2);
  await replicaB.searchAddresses('FIRST ADDRESS', lowQuota); // Cache works even when quota exhausted.
  assert.equal(calls, 2);
  await pool.query("UPDATE geocoding_usage SET requested_at=clock_timestamp()-interval '25 hours'");
  await replicaB.searchAddresses('Third address', lowQuota);
  assert.equal(calls, 3);
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  globalThis.fetch = async () => { calls++; throw new Error('network failure'); };
  await assert.rejects(replicaA.searchAddresses('Failed address', lowQuota));
  assert.equal((await pool.query('SELECT count(*) FROM geocoding_usage')).rows[0].count, '2');
  await pool.query("UPDATE geocoding_gate SET next_at='epoch'");
  await assert.rejects(replicaB.searchAddresses('Another address', lowQuota), { status: 429 });
  assert.equal(calls, 4);
});