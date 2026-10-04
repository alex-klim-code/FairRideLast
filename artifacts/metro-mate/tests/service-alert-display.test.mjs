import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function compile(file, replacements = {}) {
  let source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replace(from, JSON.stringify(to));
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const departureUrl = await compile('../src/components/passenger/departure-display.ts');
const displayUrl = await compile('../src/components/passenger/service-alert-display.ts', { "'./departure-display'": departureUrl });
const { serviceAlertDisplay } = await import(displayUrl);
const componentUrl = await compile('../src/components/passenger/StopServiceAlerts.tsx', { "'./service-alert-display'": displayUrl });
const { StopServiceAlerts } = await import(componentUrl);
const now = Date.parse('2026-10-04T10:00:00Z'), iso = delta => new Date(now + delta).toISOString();
const alert = { id: 'ztp-A-detour', title: 'Ulica zamknięta', description: 'Wsiądź przy ulicy obok.',
  effect: 4, dataset: 'A', updatedAt: iso(0), periods: [], appliesToStop: true, departureIds: ['day'] };
const departure = { id: 'day', status: 'SCHEDULED', departureTime: iso(300000), scheduledDepartureTime: iso(300000),
  expectedDepartureTime: null, realtimeUpdatedAt: null, delaySeconds: null };
const data = { alerts: [alert], alertsStatus: 'AVAILABLE', alertsUpdatedAt: iso(0), departures: [departure] };
const render = value => renderToStaticMarkup(createElement(StopServiceAlerts, { data: value, now }));
test('official alert is visible and readable, but not an automatic check-in blocker', () => {
  const html = render(data);
  assert.match(html, /Objazd · Ulica zamknięta/);
  assert.match(html, /Wsiądź przy ulicy obok/);
  assert.match(html, /Brak komunikatu nie potwierdza normalnego kursowania/);
  assert.doesNotMatch(html, /disabled|Check-in|wszystko działa|bez zakłóceń/i);
});
test('empty, partial and unavailable alerts never guarantee normal operation', () => {
  for (const alertsStatus of ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']) {
    const html = render({ ...data, alerts: [], alertsStatus });
    assert.match(html, /Brak komunikatu nie potwierdza normalnego kursowania/);
    assert.match(html, alertsStatus === 'AVAILABLE' ? /Brak aktualnych komunikatów/ :
      alertsStatus === 'PARTIAL' ? /Część komunikatów/ : /niedostępne lub nieaktualne/);
  }
});
test('source age and end time expire on screen independently of network refresh', () => {
  assert.equal(serviceAlertDisplay(data, now + 120001).alerts.length, 0);
  const expiring = { ...data, alerts: [{ ...alert, periods: [{ start: null, end: iso(1000) }], departureIds: [] }] };
  assert.equal(serviceAlertDisplay(expiring, now).alerts.length, 1);
  assert.equal(serviceAlertDisplay(expiring, now + 1000).alerts.length, 0);
  assert.equal(serviceAlertDisplay({ ...data, alerts: [{ ...alert, updatedAt: iso(-121000) }] }, now).alerts.length, 0);
});
test('future period is shown only for its affected departure, not as a current stop closure', () => {
  const future = { ...data, alerts: [{ ...alert, appliesToStop: false, periods: [{ start: iso(240000), end: iso(360000) }] }] };
  assert.equal(serviceAlertDisplay(future, now).alerts.length, 1);
  assert.match(render(future), /Dotyczy wskazanych odjazdów/);
  assert.equal(serviceAlertDisplay({ ...future, departures: [] }, now).alerts.length, 0);
});
test('text is escaped; source timestamps and malformed periods are not fabricated', () => {
  const html = render({ ...data, alerts: [{ ...alert, description: '<script>evil()</script>' }] });
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  assert.equal(serviceAlertDisplay({ ...data, alertsUpdatedAt: null }, now).status, 'UNAVAILABLE');
  assert.equal(serviceAlertDisplay({ ...data, alerts: [{ ...alert, periods: [{ start: 'bad', end: null }] }] }, now).alerts.length, 0);
});