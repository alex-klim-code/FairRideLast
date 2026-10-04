import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

// Never read the real Routes credential in tests.
const source = (await fs.readFile(new URL('../src/lib/google-transit.ts', import.meta.url), 'utf8'))
  .replace('process.env.GOOGLE_API_KEY', JSON.stringify('test-only-key'));
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { normalizeTransit, durationSeconds, computeGoogleTransit, normalizeBrowserMapKey } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

// Public example coordinates, not a passenger's position; fetch is mocked in every unit test.
const point = { lat: 50.0616, lng: 19.9383 };
test('browser keys normalize pasted whitespace and paired quotes without exposing malformed values', () => {
  const fakeKey = `AIza${'x'.repeat(35)}`;
  assert.equal(normalizeBrowserMapKey(` \n${fakeKey}\r `), fakeKey);
  assert.equal(normalizeBrowserMapKey(`"${fakeKey}"`), fakeKey);
  assert.equal(normalizeBrowserMapKey(`'${fakeKey}'`), fakeKey);
  for (const value of [undefined, '', 'GOOGLE_MAPS_BROWSER_API_KEY', 'private-sentinel-value', `apiKey=${fakeKey}`]) {
    assert.throws(() => normalizeBrowserMapKey(value), error =>
      error.status === 503 && !error.message.includes('private-sentinel-value') && !error.message.includes(fakeKey));
  }
});
const transitStep = (line = '52') => ({
  travelMode: 'TRANSIT', distanceMeters: 2000, staticDuration: '420s',
  navigationInstruction: { instructions: '<b>Tramwaj</b> do Wawelu' },
  transitDetails: {
    headsign: 'Czerwone Maki', stopCount: 4,
    stopDetails: {
      departureStop: { name: 'Teatr Bagatela' }, arrivalStop: { name: 'Wawel' },
      departureTime: '2026-10-03T12:00:00Z', arrivalTime: '2026-10-03T12:07:00Z',
    },
    transitLine: { name: 'Tramwaj 52', nameShort: line, color: '#123456', vehicle: { type: 'TRAM' },
      agencies: [{ name: 'MPK', uri: 'https://example.test/' }, { name: 'Unsafe', uri: 'javascript:alert(1)' }] },
  },
});
const payload = () => ({
  routes: [{ duration: '1000s', distanceMeters: 4500, polyline: { encodedPolyline: 'encoded' },
    localizedValues: { transitFare: { text: '6,00 zł' } },
    legs: [{ steps: [
      { travelMode: 'WALK', distanceMeters: 200, staticDuration: '180s', navigationInstruction: { instructions: 'Idź na przystanek' } },
      transitStep(), transitStep('18'),
    ] }],
  }],
});

test('maps real transit lines, transfers, walking, stop names, times and provider fare', () => {
  const result = normalizeTransit(payload());
  assert.equal(result.provider, 'google');
  assert.equal(result.routes.length, 1);
  const route = result.routes[0];
  assert.equal(route.transfers, 1);
  assert.equal(route.durationSeconds, 1000);
  assert.equal(route.fareText, '6,00 zł');
  assert.equal(route.steps[0].mode, 'WALK');
  assert.equal(route.steps[1].lineShortName, '52');
  assert.equal(route.steps[1].departureStop, 'Teatr Bagatela');
  assert.equal(route.steps[1].arrivalStop, 'Wawel');
  assert.equal(route.steps[1].departureTime, '2026-10-03T12:00:00Z');
  assert.equal(route.steps[1].instruction, 'Tramwaj do Wawelu');
  assert.equal(route.steps[1].agencies[1].uri, undefined);
  assert.equal(JSON.stringify(result).includes('apiKey'), false);
});
test('empty is valid, malformed responses fail explicitly and durations support protobuf decimals', () => {
  assert.deepEqual(normalizeTransit({}).routes, []);
  assert.throws(() => normalizeTransit(null));
  assert.throws(() => normalizeTransit({ routes: {} }));
  assert.throws(() => normalizeTransit({ routes: [{}] }));
  assert.equal(durationSeconds('123.5s'), 123.5);
  assert.equal(durationSeconds('invalid'), null);
});
test('missing measures are not fabricated zeros and every returned alternative is retained', () => {
  const fixture = payload();
  const missing = structuredClone(fixture.routes[0]);
  delete missing.distanceMeters; delete missing.duration;
  delete missing.legs[0].steps[0].distanceMeters; delete missing.legs[0].steps[0].staticDuration;
  fixture.routes = [missing, ...Array.from({ length: 5 }, () => fixture.routes[0])];
  const routes = normalizeTransit(fixture).routes;
  assert.equal(routes.length, 6);
  assert.equal(routes[0].distanceMeters, null);
  assert.equal(routes[0].durationSeconds, null);
  assert.equal(routes[0].steps[0].distanceMeters, null);
  assert.equal(routes[0].steps[0].durationSeconds, null);
  const zero = payload(); zero.routes[0].legs[0].steps[0].distanceMeters = 0;
  zero.routes[0].legs[0].steps[0].staticDuration = '0s';
  assert.equal(normalizeTransit(zero).routes[0].steps[0].durationSeconds, 0);
});
test('request is TRANSIT with real coordinate waypoints, explicit field mask and no caching', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    const body = JSON.parse(options.body);
    assert.equal(body.travelMode, 'TRANSIT');
    assert.deepEqual(body.origin.location.latLng, { latitude: point.lat, longitude: point.lng });
    assert.equal(body.computeAlternativeRoutes, true);
    assert.equal(typeof options.headers['X-Goog-Api-Key'], 'string');
    assert.ok(options.headers['X-Goog-FieldMask'].includes('routes.legs.steps'));
    assert.equal(options.headers['X-Goog-FieldMask'].includes('*'), false);
    return new Response(JSON.stringify(payload()), { status: 200 });
  };
  try {
    assert.equal((await computeGoogleTransit({ origin: point, destination: { lat: 50.0541, lng: 19.9352 } })).routes.length, 1);
  } finally { globalThis.fetch = original; }
});
test('authorization failures, quotas and malformed bodies expose safe messages only', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('sensitive upstream message', { status: 403 });
    await assert.rejects(computeGoogleTransit({ origin: point, destination: point }), error =>
      error.status === 503 && /Routes API/.test(error.message) && !error.message.includes('sensitive'));
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { details: [{ reason: 'API_KEY_INVALID', metadata: { secret: 'do-not-expose' } }] } }), { status: 400 });
    await assert.rejects(computeGoogleTransit({ origin: point, destination: point }), error =>
      error.status === 503 && /nie rozpoznaje/.test(error.message) && !error.message.includes('do-not-expose'));
    globalThis.fetch = async () => new Response('quota detail', { status: 429 });
    await assert.rejects(computeGoogleTransit({ origin: point, destination: point }), error => error.status === 429);
    globalThis.fetch = async () => new Response('invalid json', { status: 200 });
    await assert.rejects(computeGoogleTransit({ origin: point, destination: point }), /nieprawidłową/);
  } finally { globalThis.fetch = original; }
});