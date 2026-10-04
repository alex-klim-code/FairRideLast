import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/services/route-map-segments.ts', import.meta.url), 'utf8');
const { routeMapSegments, routeStroke } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`);
test('mixed routes draw each real walking/transit geometry, never a solid full-route underneath', () => {
  const steps = [{ mode: 'WALK', polyline: 'walk-a' }, { mode: 'TRANSIT', polyline: 'bus' }, { mode: 'WALK', polyline: 'walk-b' }];
  assert.deepEqual(routeMapSegments(steps, 'full'), steps);
  const walking = routeStroke('WALK', 0);
  assert.equal(walking.strokeOpacity, 0);
  assert.equal(walking.icons[0].icon.path, 0);
  assert.equal(walking.icons[0].icon.fillOpacity, 1);
  assert.equal(walking.icons[0].repeat, '14px');
  const bus = routeStroke('TRANSIT', 0);
  assert.equal(bus.strokeOpacity, 0.9);
  assert.equal(bus.icons, undefined);
});
test('single-mode fallback preserves mode; unavailable mixed geometry is not mislabelled', () => {
  assert.equal(routeMapSegments([{ mode: 'WALK' }], 'full')[0].mode, 'WALK');
  assert.equal(routeMapSegments([{ mode: 'TRANSIT' }], 'full')[0].mode, 'TRANSIT');
  assert.equal(routeMapSegments([{ mode: 'WALK' }, { mode: 'TRANSIT' }], 'full')[0].mode, 'OTHER');
  assert.equal(routeMapSegments(undefined, 'full')[0].mode, 'OTHER');
});