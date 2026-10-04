import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = (await fs.readFile(new URL('../src/components/passenger/GoRouteCard.tsx', import.meta.url), 'utf8'))
  .replace("import './go-routes.css';", '')
  .replace("'lucide-react'", JSON.stringify(import.meta.resolve('lucide-react')));
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const { countdown, GoRouteCard } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const now = Date.parse('2026-10-03T20:27:00Z');
const iso = offset => new Date(now + offset).toISOString();
const transit = { mode: 'TRANSIT', durationSeconds: 480, vehicleType: 'TRAM', lineShortName: '9',
  departureTime: iso(420000), arrivalTime: iso(900000) };
const walk = seconds => ({ mode: 'WALK', durationSeconds: seconds });
const render = route => renderToStaticMarkup(createElement(GoRouteCard, {
  route, index: 0, active: false, expanded: false, now, onSelect() {}, onToggle() {}, fareLine: 'FairRide',
}));

test('scheduled countdown rounds up remaining minutes and never invents missing times', () => {
  assert.deepEqual(countdown(iso(419000), now), { kind: 'in', minutes: 7 });
  assert.deepEqual(countdown(iso(30000), now), { kind: 'in', minutes: 1 });
  assert.equal(countdown(iso(3600000), now).kind, 'at');
  assert.equal(countdown(iso(-1000), now).kind, 'gone');
  for (const value of [undefined, '', 'not-a-date']) assert.deepEqual(countdown(value, now), { kind: 'missing' });
});
test('card distinguishes access walking, riding between clock chips, and final walking', () => {
  const html = render({ durationSeconds: 1020, steps: [walk(420), transit, walk(120)] });
  assert.match(html, /Dojście pieszo: 7 min/);
  assert.match(html, /Czas jazdy z przesiadkami: 8 min/);
  assert.match(html, /Planowy odjazd:/);
  assert.match(html, /Planowy przyjazd:/);
  assert.doesNotMatch(html, /Czas jazdy z przesiadkami: 2 min/);
});
test('invalid or missing walking and arrival data remain unknown, while zero is valid', () => {
  for (const duration of [null, -1, NaN]) {
    assert.match(render({ durationSeconds: null, steps: [walk(duration), transit] }), /Dojście pieszo: brak danych/);
  }
  assert.match(render({ durationSeconds: 480, steps: [walk(0), transit] }), /Dojście pieszo: 0 min/);
  assert.match(render({ durationSeconds: null, steps: [transit] }), /Dojście pieszo: brak danych/);
  for (const arrivalTime of [undefined, 'invalid', iso(300000)]) {
    assert.match(render({ durationSeconds: null, steps: [{ ...transit, arrivalTime }] }), /Czas jazdy z przesiadkami: brak danych/);
  }
});
test('walking-only and unknown-transport cards do not pretend to have departures', () => {
  const walking = render({ durationSeconds: 600, steps: [walk(600)] });
  assert.match(walking, /Trasa piesza/);
  assert.doesNotMatch(walking, /Odjazd za/);
  assert.match(render({ durationSeconds: null, steps: [{ mode: 'OTHER', durationSeconds: null }] }), /Brak danych o transporcie/);
});