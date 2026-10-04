import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const mockApi = compile('export const getGoogleMapsConfig = options => globalThis.__mapsConfig(options);');
const source = (await fs.readFile(new URL('../src/services/google-maps-loader.ts', import.meta.url), 'utf8'))
  .replace("from '@workspace/api-client-react'", `from ${JSON.stringify(mockApi)}`);
const { loadGoogleMaps, resetGoogleMaps, MAP_ERROR_EVENT } = await import(compile(source));
const w = new EventTarget();
w.setTimeout = setTimeout;
w.clearTimeout = clearTimeout;
globalThis.window = w;
const scripts = [];
globalThis.document = {
  querySelectorAll: () => scripts.filter(s => !s.removed),
  createElement: () => ({ removed: false, remove() { this.removed = true; } }),
  head: { appendChild(script) { scripts.push(script); } },
};
let calls = 0;
const config = options => {
  calls++;
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal instanceof AbortSignal);
  return Promise.resolve({ apiKey: 'test-only-not-a-real-key' });
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const libraries = () => { w.google = { maps: { geometry: {}, marker: { AdvancedMarkerElement: class {} } } }; };

test('configuration failure is explicit and does not request the Google SDK', async () => {
  resetGoogleMaps();
  const count = scripts.length;
  globalThis.__mapsConfig = async () => { throw { data: { error: 'Brak konfiguracji mapy.' } }; };
  await assert.rejects(loadGoogleMaps(), e => e.code === 'MAP_CONFIG' && e.message === 'Brak konfiguracji mapy.');
  assert.equal(scripts.length, count);
});

test('auth failure never reuses partial Google globals; retry fetches fresh config', async () => {
  resetGoogleMaps(); calls = 0; globalThis.__mapsConfig = config;
  const first = loadGoogleMaps();
  const rejected = assert.rejects(first, e => e.code === 'MAP_AUTH');
  await flush(); libraries();
  w.gm_authFailure();
  await rejected;
  assert.equal(scripts.at(-1).removed, true);
  const second = loadGoogleMaps();
  assert.equal(w.google, undefined);
  await flush();
  assert.equal(calls, 2);
  libraries(); w.__fairRideMapsReady();
  await second;
});

test('late authorization failure emits a map error and a forced retry can recover', async () => {
  resetGoogleMaps(); calls = 0; globalThis.__mapsConfig = config;
  const first = loadGoogleMaps(); await flush();
  libraries(); w.__fairRideMapsReady(); await first;
  let code;
  const listener = event => { code = event.detail.code; };
  w.addEventListener(MAP_ERROR_EVENT, listener);
  w.gm_authFailure();
  assert.equal(code, 'MAP_AUTH');
  const second = loadGoogleMaps(true); await flush();
  libraries(); w.__fairRideMapsReady(); await second;
  assert.equal(calls, 2);
  w.removeEventListener(MAP_ERROR_EVENT, listener);
});

test('cancelling an old attempt does not remove the new SDK request', async () => {
  resetGoogleMaps(); globalThis.__mapsConfig = config;
  const first = loadGoogleMaps();
  const rejected = assert.rejects(first, e => e.code === 'MAP_INIT');
  await flush();
  const second = loadGoogleMaps(true); await flush(); await rejected;
  assert.equal(scripts.at(-1).removed, false);
  libraries(); w.__fairRideMapsReady(); await second;
  resetGoogleMaps();
  delete globalThis.__mapsConfig;
});