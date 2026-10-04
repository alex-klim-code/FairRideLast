import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const text = await fs.readFile(new URL('../src/services/trip-walking.ts', import.meta.url), 'utf8');
const { groupWalking } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`);
const step = (mode, distanceMeters = 100, durationSeconds = 60) => ({ mode, distanceMeters, durationSeconds });
test('aggregates contiguous access, transfers and egress from actual steps', () => {
  const groups = groupWalking([step('WALK'), step('WALK', 50, 30), step('TRANSIT'),
    step('WALK', 20, 12), step('TRANSIT'), step('WALK', 70, 42)]);
  assert.deepEqual(groups.map(g => [g.kind, g.distanceMeters, g.durationSeconds]),
    [['access', 150, 90], ['transfer', 20, 12], ['egress', 70, 42]]);
});
test('walking-only, zero walking, omitted walking and unknown measures stay distinct', () => {
  assert.equal(groupWalking([step('WALK')])[0].kind, 'walking-only');
  assert.deepEqual(groupWalking([step('TRANSIT')]), []);
  assert.equal(groupWalking([step('WALK', 0, 0), step('TRANSIT')])[0].distanceMeters, 0);
  const missing = step('WALK'); delete missing.durationSeconds;
  const group = groupWalking([step('TRANSIT'), missing, step('WALK', NaN)])[0];
  assert.equal(group.durationSeconds, null); assert.equal(group.distanceMeters, null);
  assert.deepEqual(groupWalking([]), []);
  assert.equal(groupWalking([step('WALK'), step('OTHER'), step('WALK')]).length, 2);
});