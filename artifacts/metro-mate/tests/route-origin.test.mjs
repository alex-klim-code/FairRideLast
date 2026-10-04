import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const geocoding = compile((await fs.readFile(new URL('../src/services/geocoding.ts', import.meta.url), 'utf8')).replace('import.meta.env.BASE_URL', "'/'"));
const api = compile('export const reverseAddress = (...args) => globalThis.__reverse(...args);');
const source = (await fs.readFile(new URL('../src/services/route-origin.ts', import.meta.url), 'utf8'))
  .replace("from '@workspace/api-client-react'", `from ${JSON.stringify(api)}`)
  .replace("from './geocoding'", `from ${JSON.stringify(geocoding)}`);
const { createOriginResolver, gpsOrigin, movedOrigin } = await import(compile(source));
const point = { lat: 50.06, lng: 19.94 };
const payload = { provider: 'geoapify', features: [{ geometry: { type: 'Point', coordinates: [19, 51] },
  properties: { formatted: 'Długa 12, Kraków', name: 'Długa 12' } }] };
test('resolved address changes the name, never the true GPS position', async () => {
  globalThis.__reverse = async () => payload;
  let result;
  await createOriginResolver().resolve(point, p => result = p);
  assert.deepEqual(result, { ...point, name: 'Długa 12, Kraków' });
});
test('empty, malformed, offline and limited lookups honestly fall back to GPS', async () => {
  for (const response of [{ ...payload, features: [] }, { invalid: true }, new Error('offline'), { status: 429 }]) {
    globalThis.__reverse = async () => { if (response instanceof Error || response.status) throw response; return response; };
    let result; await createOriginResolver().resolve(point, p => result = p);
    assert.deepEqual(result, gpsOrigin(point));
  }
});
test('ignores late responses, even when a fetch does not honor cancellation', async () => {
  const pending = [];
  globalThis.__reverse = (_, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  const resolver = createOriginResolver();
  const values = [];
  const old = resolver.resolve(point, p => values.push(p));
  const newer = resolver.resolve({ lat: 52, lng: 20 }, p => values.push(p));
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(payload); await newer;
  pending[0].resolve(payload); await old;
  assert.equal(values.length, 1); assert.equal(values[0].lat, 52);
  const canceled = resolver.resolve(point, p => values.push(p));
  resolver.cancel(); pending[2].resolve(payload); await canceled;
  assert.equal(values.length, 1);
});
test('GPS jitter does not change a settled start; significant movement does', () => {
  assert.equal(movedOrigin(point, { lat: point.lat + 0.000001, lng: point.lng }), false);
  assert.equal(movedOrigin(point, { lat: point.lat + 0.001, lng: point.lng }), true);
});