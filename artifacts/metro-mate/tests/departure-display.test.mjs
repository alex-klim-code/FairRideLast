import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/components/passenger/departure-display.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { departureDisplay } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const now = Date.parse('2026-10-04T10:00:00Z');
const d = {
  status: 'UPDATED', scheduledDepartureTime: '2026-10-04T10:05:00Z',
  departureTime: '2026-10-04T10:05:00Z', expectedDepartureTime: '2026-10-04T10:08:00Z',
  delaySeconds: 180, realtimeUpdatedAt: new Date(now).toISOString(),
};
test('predicted and planned times remain separate; delay label is explicit', () => {
  const view = departureDisplay(d, now);
  assert.equal(view.planned, d.scheduledDepartureTime); assert.equal(view.expected, d.expectedDepartureTime);
  assert.equal(view.label, 'Przewidywany · opóźnienie +3 min'); assert.equal(view.blocked, false);
});
test('cancellation and skipped stop block selection', () => {
  for (const status of ['CANCELLED', 'SKIPPED']) {
    const view = departureDisplay({ ...d, status, expectedDepartureTime: null }, now);
    assert.equal(view.blocked, true); assert.equal(view.expected, null);
    assert.equal(view.label, status === 'CANCELLED' ? 'Odwołany' : 'Nie zatrzyma się');
  }
});
test('source expiry on screen removes live claim and stale cancellation without a fetch', () => {
  for (const status of ['UPDATED', 'CANCELLED', 'SKIPPED', 'SCHEDULED']) {
    for (const realtimeUpdatedAt of [null, '', 'invalid', new Date(now - 121000).toISOString(), new Date(now + 31000).toISOString()]) {
      const view = departureDisplay({ ...d, status, realtimeUpdatedAt }, now);
      assert.equal(view.status, 'SCHEDULED'); assert.equal(view.expected, null); assert.equal(view.blocked, false);
      assert.equal(view.label, 'Rozkład · brak świeżej prognozy');
    }
  }
  assert.equal(departureDisplay(d, now + 120001).status, 'SCHEDULED');
});
test('zero, early and sub-minute delay labels do not invent late departures', () => {
  assert.match(departureDisplay({ ...d, delaySeconds: 0 }, now).label, /bez opóźnienia/);
  assert.match(departureDisplay({ ...d, delaySeconds: -120 }, now).label, /2 min wcześniej/);
  assert.match(departureDisplay({ ...d, delaySeconds: 30 }, now).label, /\+30 s/);
});