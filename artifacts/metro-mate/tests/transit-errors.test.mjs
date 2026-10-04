import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText).toString('base64')}`;
const errorUrl = compile(await fs.readFile(new URL('../src/services/transit-error.ts', import.meta.url), 'utf8'));
const { transitErrorMessage } = await import(errorUrl);
test('Polish safe errors distinguish rate limits, gate unavailability and offline failures', () => {
  assert.match(transitErrorMessage({ status: 429 }), /Limit zapytań/);
  assert.match(transitErrorMessage({ status: 503 }), /chwilowo niedostępne/);
  assert.match(transitErrorMessage(new Error('private upstream error')), /internetem/);
  assert.match(transitErrorMessage({ data: { error: 'Osiągnięto dzienny limit 500 zapytań.' } }), /500/);
  assert.equal(transitErrorMessage({ data: { error: 'x'.repeat(1000) } }).length, 500);
});

// Small deterministic hook runner: exercises the component's actual click,
// promise rejection and error rendering, with no browser or real Google call.
const hooks = { values: [], cursor: 0, pending: [] };
globalThis.__transitHooks = hooks;
const reactUrl = compile(`
const h=globalThis.__transitHooks;
export function useState(initial) {
  const i=h.cursor++;
  if (!(i in h.values)) h.values[i]=typeof initial === 'function' ? initial() : initial;
  return [h.values[i], v=>{h.values[i]=v;}];
}
export function useRef(initial) {
  const i=h.cursor++;
  if (!(i in h.values)) h.values[i]={current:initial};
  return h.values[i];
}
export function useEffect(fn, deps) {
  const i=h.cursor++, previous=h.values[i];
  if (!previous || deps.some((v,j)=>!Object.is(v,previous.deps[j]))) {
    h.pending.push(()=>{previous?.cleanup?.();h.values[i]={deps,cleanup:fn()};});
  }
}
export default {createElement(type, props, ...children) { return {type, props:props||{}, children}; }};
`);
const iconsUrl = compile('export const ExternalLink="icon",Footprints="icon",Navigation="icon",Route="icon";');
const apiUrl = compile('export async function computeTransitRoutes() { return globalThis.__transitCompute(); }');
const urlHelper = compile('export const googleTransitUrl = () => "https://example.test";');
const farePolicy = compile('export const discountFor = () => ({label:"Normalny"}); export const quoteRoute = () => ({totalCents:0,walkingKm:0,legs:[]});');
const accountHelpers = compile('export const moneyText = cents => String(cents / 100);');
const walkingHelpers = compile(await fs.readFile(new URL('../src/services/trip-walking.ts', import.meta.url), 'utf8'));
const cardHelper = compile('export const GoRouteCard = "route-card";');
let source = await fs.readFile(new URL('../src/components/TransitDirections.tsx', import.meta.url), 'utf8');
source = 'import React from ' + JSON.stringify(reactUrl) + ';\nconst window = { setInterval: () => 0, clearInterval: () => {} };\n' + source
  .replace("from 'react'", `from ${JSON.stringify(reactUrl)}`)
  .replace("from 'lucide-react'", `from ${JSON.stringify(iconsUrl)}`)
  .replace("from '@workspace/api-client-react'", `from ${JSON.stringify(apiUrl)}`)
  .replace("from '../services/transit-directions'", `from ${JSON.stringify(urlHelper)}`)
  .replace("from '../services/transit-error'", `from ${JSON.stringify(errorUrl)}`)
  .replace("from '../services/fare-policy'", `from ${JSON.stringify(farePolicy)}`)
  .replace("from '../services/passenger-account'", `from ${JSON.stringify(accountHelpers)}`)
  .replace("from '../services/trip-walking'", `from ${JSON.stringify(walkingHelpers)}`)
  .replace("from './passenger/GoRouteCard'", `from ${JSON.stringify(cardHelper)}`);
const { TransitDirections } = await import(compile(source));
const find = (node, id) => {
  if (!node || typeof node !== 'object') return undefined;
  if (node.props?.['data-testid'] === id) return node;
  return (node.children || []).flat(Infinity).map(child => find(child, id)).find(Boolean);
};
test('TransitDirections shows the daily budget and unavailable-gate message after a click', async () => {
  const props = { origin: { lat: 50, lng: 19 }, destination: { lat: 51, lng: 20 },
    selectedRouteId: null, onSelectRoute() {} };
  const render = () => {
    hooks.cursor = 0; hooks.pending = [];
    const tree = TransitDirections(props);
    for (const effect of hooks.pending) effect();
    return tree;
  };
  for (const message of [
    'Osiągnięto dzienny limit 500 zapytań w tej wersji demo. Spróbuj po odnowieniu limitu.',
    'Ochrona limitu zapytań jest chwilowo niedostępna. Nie wysłano zapytania do Google. Spróbuj później.',
  ]) {
    hooks.values = [];
    globalThis.__transitCompute = async () => { throw { status: 429, data: { error: message } }; };
    await find(render(), 'button-plan-real-route').props.onClick();
    const alert = find(render(), 'status-transit-error');
    assert.equal(alert.props.role, 'alert');
    assert.equal(alert.children[0], message);
    assert.equal(find(alert, 'button-transit-retry').children[0], 'Spróbuj ponownie');
  }
  delete globalThis.__transitCompute;
});

test('destination intent auto-plans once, tolerates GPS noise, and never charges for GPS/profile renders', async () => {
  hooks.values = [];
  let calls = 0;
  globalThis.__transitCompute = async () => { calls++; return { routes: [] }; };
  const props = { origin: { lat: 50, lng: 19 }, destination: { lat: 50.1, lng: 19.1 },
    selectedRouteId: null, onSelectRoute() {}, autoPlanKey: 1, discountId: 'normal' };
  const render = () => {
    hooks.cursor = 0; hooks.pending = [];
    const tree = TransitDirections(props);
    for (const effect of hooks.pending) effect();
    return tree;
  };
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  props.origin = { lat: 50.000001, lng: 19 }; // centimetres of GPS noise
  props.discountId = 'student';
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  props.origin = { lat: 50.01, lng: 19 }; // real movement invalidates, doesn't reroute
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  props.autoPlanKey = 2;
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  delete globalThis.__transitCompute;
});

test('an explicit destination waits for genuine GPS without introducing a fallback', async () => {
  hooks.values = [];
  let calls = 0;
  globalThis.__transitCompute = async () => { calls++; return { routes: [] }; };
  const props = { origin: null, destination: { lat: 50.1, lng: 19.1 },
    selectedRouteId: null, onSelectRoute() {}, autoPlanKey: 3 };
  const render = () => {
    hooks.cursor = 0; hooks.pending = [];
    const tree = TransitDirections(props);
    for (const effect of hooks.pending) effect();
    return tree;
  };
  const waiting = render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.ok(find(waiting, 'status-transit-needs-location'));
  props.origin = { lat: 50, lng: 19 };
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  delete globalThis.__transitCompute;
});

test('a transient GPS error preserves the previous itinerary, but real movement invalidates it', async () => {
  hooks.values = [];
  let calls = 0, selected = null;
  const route = { id: 'test-route', durationSeconds: 600, distanceMeters: 1000, transfers: 0, steps: [] };
  globalThis.__transitCompute = async () => { calls++; return { routes: [route] }; };
  const props = { origin: { lat: 50.0616, lng: 19.9383 }, destination: { lat: 50.07, lng: 19.99 },
    selectedRouteId: route.id, onSelectRoute(value) { selected = value; }, autoPlanKey: 1 };
  const render = () => {
    hooks.cursor = 0; hooks.pending = [];
    const tree = TransitDirections(props);
    for (const effect of hooks.pending) effect();
    return tree;
  };
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(find(render(), 'list-real-routes'));
  props.origin = null; // POSITION_UNAVAILABLE clears only the current GPS fix
  render();
  const unavailable = render();
  assert.ok(find(unavailable, 'list-real-routes'));
  assert.ok(find(unavailable, 'status-transit-needs-location'));
  assert.equal(selected, route);
  props.origin = { lat: 50.0617, lng: 19.9383 }; // 11.132 m after GPS recovery
  render();
  assert.ok(find(render(), 'list-real-routes'));
  assert.equal(selected, route);
  assert.equal(calls, 1);
  props.origin = { lat: 50.0636, lng: 19.9383 };
  render();
  assert.equal(find(render(), 'list-real-routes'), undefined);
  assert.equal(selected, null);
  assert.equal(calls, 1);
  delete globalThis.__transitCompute;
  delete globalThis.__transitHooks;
});