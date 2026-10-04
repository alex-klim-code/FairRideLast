import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Exercise the actual service without a browser or a dependency on public API uptime.
const source = await fs.readFile(new URL('../src/services/geocoding.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('import.meta.env.BASE_URL', "'/'"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseGeocodingResults, searchDestinations, searchDestinationSuggestions } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const feature = (coordinates = [19.936, 50.054]) => ({
  geometry: { type: 'Point', coordinates },
  properties: { name: 'Wawel', city: 'Kraków', country: 'Polska', osm_type: 'W', osm_id: 123 },
});

test('autocomplete uses cached matches without a new request and cancels queued searches', async () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  Date.now = () => 50000;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ provider: 'geoapify', features: [feature()] }) };
  };
  try {
    const found = await searchDestinationSuggestions('Tauron Arena', new AbortController().signal);
    assert.deepEqual(await searchDestinationSuggestions(' TAURON   Arena ', new AbortController().signal), found);
    assert.equal(calls, 1);
    const controller = new AbortController();
    const waiting = searchDestinationSuggestions('Changed destination', controller.signal);
    controller.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; Date.now = realNow; }
});

const compileModule = text => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const pricingUrl = compileModule(await fs.readFile(new URL('../../../lib/fairride-core/src/pricing.ts', import.meta.url), 'utf8'));
const demoSource = await fs.readFile(new URL('../src/services/demo.ts', import.meta.url), 'utf8');
const demoUrl = compileModule(demoSource.replaceAll("'./pricing'", JSON.stringify(pricingUrl)));
const { readState } = await import(demoUrl);
const routingSource = await fs.readFile(new URL('../src/services/routing.ts', import.meta.url), 'utf8');
const { buildRouteOptions } = await import(compileModule(routingSource.replace("'./demo'", JSON.stringify(demoUrl))));

test('real coordinates can match demo connections, but distant destinations and origins cannot', () => {
  const origin = { name: 'Kraków demo', lat: 50.0616, lng: 19.9383 };
  const wawel = { name: 'Wawel address', lat: 50.054, lng: 19.936 };
  const berlin = { name: 'Berlin', lat: 52.52, lng: 13.405 };
  const options = buildRouteOptions(origin, wawel, readState().vehicles);
  assert.ok(options.length > 0);
  options.forEach(option => {
    assert.equal(option.vehicle.lineId, option.line.id);
    assert.deepEqual(option.coordinates.at(-1), [wawel.lat, wawel.lng]);
  });
  assert.deepEqual(buildRouteOptions(origin, berlin, readState().vehicles), []);
  assert.deepEqual(buildRouteOptions(berlin, wawel, readState().vehicles), []);
});

test('normalizes names and longitude/latitude and drops duplicates and invalid coordinates', () => {
  const results = parseGeocodingResults({ provider: 'geoapify', features: [feature(), feature(), feature([19, 100]), feature(['19', 50]), null] });
  assert.equal(results.length, 1);
  assert.equal(results[0].lat, 50.054);
  assert.equal(results[0].lng, 19.936);
  assert.equal(results[0].name, 'Wawel');
  assert.equal(results[0].label, 'Wawel, Kraków, Polska');
});
test('supports addresses without POI names and distinguishes empty from malformed responses', () => {
  const address = feature();
  address.properties = { street: 'Długa', housenumber: '12', city: 'Kraków' };
  assert.equal(parseGeocodingResults({ provider: 'geoapify', features: [address] })[0].name, 'Długa 12');
  assert.deepEqual(parseGeocodingResults({ provider: 'geoapify', features: [] }), []);
  assert.throws(() => parseGeocodingResults({ error: 'failed' }), /invalid response/);
  assert.throws(() => parseGeocodingResults({ provider: 'photon', features: [] }), /invalid response/);
  address.properties = { address_line1: 'Długa 12', formatted: 'Długa 12, Kraków', place_id: 'geoapify-place' };
  const mapped = parseGeocodingResults({ provider: 'geoapify', features: [address] })[0];
  assert.equal(mapped.label, 'Długa 12, Kraków');
  assert.equal(mapped.id, 'geoapify-place');
  assert.equal(mapped.source, 'geoapify');
});
test('user search is encoded, globally searchable, cached and throttled; failures and aborts remain explicit', async () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  let now = 100000;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/geocoding/search');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { query: 'Wawel Kraków' });
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ provider: 'geoapify', features: [feature()] }) };
  };
  try {
    await assert.rejects(searchDestinations('ab'), /od 3 do 200/);
    const first = await searchDestinations(' Wawel   Kraków ');
    assert.deepEqual(await searchDestinations('wawel kraków'), first);
    assert.equal(calls, 1);
    await assert.rejects(searchDestinations('Berlin'), /Odczekaj chwilę/);
    now += 2000;
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(searchDestinations('Berlin'), /limit zapytań/);
    now += 2000;
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(searchDestinations('Warszawa'), /Sprawdź internet/);
    now += 2000;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ provider: 'geoapify', features: [] }) });
    assert.deepEqual(await searchDestinations('Missing place'), []);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(searchDestinations('Wawel Kraków', controller.signal), { name: 'AbortError' });
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
});