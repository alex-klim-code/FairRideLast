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
const helper = await compile('../src/services/passenger-ticket.ts');
const { activeTicketPayload } = await import(helper);
const component = await compile('../src/components/passenger/ActiveTicketQr.tsx', {
  "'../../services/passenger-ticket'": helper,
  "'qrcode.react'": import.meta.resolve('qrcode.react'),
});
const { ActiveTicketQr } = await import(component);
const ride = {
  id: 'test-ticket-uuid', status: 'active', startedAt: '2026-10-04T08:00:00.000Z',
  distanceMeters: 120, amountCents: 55, lastFix: { lat: 50, lng: 19 },
};
const render = r => renderToStaticMarkup(createElement(ActiveTicketQr, { ride: r }));

test('check-in QR identifies one persisted ticket without personal, GPS or changing fare data', () => {
  const payload = activeTicketPayload(ride);
  assert.deepEqual(JSON.parse(payload), {
    type: 'fairride.check-in', version: 1, ticketId: ride.id, checkedInAt: ride.startedAt,
  });
  assert.equal(activeTicketPayload({ ...ride, distanceMeters: 500, amountCents: 70, lastFix: null }), payload);
  assert.equal(activeTicketPayload(JSON.parse(JSON.stringify(ride))), payload);
  assert.notEqual(activeTicketPayload({ ...ride, id: 'next-ticket' }), payload);
});
test('QR is a locally rendered, accessible black-on-white SVG with a quiet zone', () => {
  const html = render(ride);
  assert.match(html, /<svg/);
  assert.match(html, /Kod QR aktywnego biletu FairRide/);
  assert.match(html, /role="img"/);
  assert.match(html, /fill="#ffffff"/);
  assert.match(html, /fill="#10251d"/);
  assert.match(html, /Numer biletu/);
  assert.match(html, /test-ticket-uuid/);
  assert.doesNotMatch(html, /https?:|<img|<script/);
  assert.equal(render({ ...ride, distanceMeters: 500, amountCents: 70 }), html);
});
test('completed and unpaid tickets never display an active QR', () => {
  for (const settled of [true, false]) {
    const completed = { ...ride, status: 'completed', settled };
    assert.equal(activeTicketPayload(completed), null);
    assert.equal(render(completed), '');
  }
});