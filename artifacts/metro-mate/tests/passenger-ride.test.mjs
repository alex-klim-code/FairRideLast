import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const pricing = compile(await fs.readFile(new URL('../../../lib/fairride-core/src/pricing.ts', import.meta.url), 'utf8'));
const policy = compile((await fs.readFile(new URL('../../../lib/fairride-core/src/fare-policy.ts', import.meta.url), 'utf8'))
  .replace("from './pricing'", `from ${JSON.stringify(pricing)}`));
const accountModule = compile((await fs.readFile(new URL('../../../lib/fairride-core/src/passenger-account.ts', import.meta.url), 'utf8'))
  .replace("from './fare-policy'", `from ${JSON.stringify(policy)}`));
const rideModule = compile((await fs.readFile(new URL('../../../lib/fairride-core/src/passenger-ride.ts', import.meta.url), 'utf8'))
  .replace("from './fare-policy'", `from ${JSON.stringify(policy)}`)
  .replace("from './pricing'", `from ${JSON.stringify(pricing)}`));
const { createAccount, refillAccount, readAccount, saveAccount, accountKey } = await import(accountModule);
const { startRide, recordRideFix, finishRide, settleRide, interruptRide, getActiveRide } = await import(rideModule);
const user = { id: 'gps-unit-user', firstName: 'Test', lastName: 'Rider', email: '', phone: '' };
const time = Date.parse('2026-10-04T08:00:00Z');
const fix = (seconds = 0, metres = 0, accuracy = 3) => ({ lat: 50 + metres / 111195, lng: 19, accuracy, timestamp: time + seconds * 1000 });
const when = seconds => new Date(time + seconds * 1000);
const selection = { transport: 'BUS', lineName: '124', originName: 'Start', destinationName: 'Cel' };
const account = () => refillAccount(createAccount(user), 2000, 'blik', 'refill', when(0));
const begin = a => startRide(a ?? account(), selection, fix(), 'ride-one', when(0));
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
test('only one active check-in survives retries, reloads and competing selections', () => {
  const a = begin(), s = storage();
  saveAccount(s, a);
  const stored = s.getItem(accountKey(user.id));
  const latest = readAccount(s, user);
  assert.equal(startRide(latest, selection, fix(1), 'ride-one', when(1)), latest);
  assert.throws(() => startRide(latest, { ...selection, lineName: '52', transport: 'TRAM' }, fix(1), 'ride-two', when(1)), /check-out/);
  assert.equal(s.getItem(accountKey(user.id)), stored);
  assert.equal(latest.rides.filter(r => r.status === 'active').length, 1);
  assert.throws(() => saveAccount(s, { ...latest, rides: [...latest.rides, { ...latest.rides[0], id: 'duplicate-active' }] }));
  assert.equal(s.getItem(accountKey(user.id)), stored);
  const ended = finishRide(latest, fix(2), when(2), 'ride-one');
  const next = startRide(ended, selection, fix(3), 'ride-two', when(3));
  assert.equal(getActiveRide(next).id, 'ride-two');
  assert.equal(next.rides.filter(r => r.status === 'active').length, 1);
});
test('transport name, line number and scheduled departure survive check-in, storage and checkout', () => {
  const selected = { ...selection, transportName: 'Autobus', lineNumber: '124', scheduledDepartureTime: '2026-10-04T08:05:00Z' };
  let a = startRide(account(), selected, fix(), 'metadata-ride', when(0));
  assert.equal(a.balanceCents, 2000);
  assert.equal(a.rides[0].startedAt, '2026-10-04T08:00:00.000Z');
  assert.equal(a.rides[0].scheduledDepartureTime, selected.scheduledDepartureTime);
  const s = storage(); saveAccount(s, a);
  a = readAccount(s, user);
  assert.equal(a.rides[0].transportName, 'Autobus');
  assert.equal(a.rides[0].lineNumber, '124');
  a = finishRide(a, 'metadata-checkout', when(10));
  assert.equal(a.rides[0].scheduledDepartureTime, selected.scheduledDepartureTime);
});
test('invalid optional boarding metadata is rejected, not frozen into a ride', () => {
  for (const extra of [{ lineNumber: '' }, { transportName: 'x'.repeat(161) }, { scheduledDepartureTime: 'not-a-date' }]) {
    assert.throws(() => startRide(account(), { ...selection, ...extra }, fix(), 'bad-boarding', when(0)));
  }
});

test('boarding does not debit; GPS movement charges exactly once at checkout', () => {
  let a = begin();
  assert.equal(a.balanceCents, 2000);
  a = recordRideFix(a, fix(10, 100), time + 10000);
  assert.ok(getActiveRide(a).distanceMeters > 99);
  assert.equal(a.balanceCents, 2000);
  a = finishRide(a, fix(20, 200), when(20), 'ride-one');
  const r = a.rides[0];
  assert.equal(r.status, 'completed');
  assert.equal(r.settled, true);
  assert.equal(r.amountCents, 58); // 0.50 boarding + 0.40/km for 200m.
  assert.equal(a.balanceCents, 1942);
  assert.equal(r.lastFix, null);
  assert.equal(r.anchorFix, null);
  assert.equal(finishRide(a, fix(21, 210), when(21), 'ride-one'), a);
  assert.equal(settleRide(a, r.id), a);
  assert.equal(a.transactions.filter(t => t.kind === 'ride').length, 1);
  const s = storage(); saveAccount(s, a);
  assert.deepEqual(readAccount(s, user), a);
});
test('noise, duplicate callbacks and implausible jumps cannot inflate distance', () => {
  let a = begin();
  a = recordRideFix(a, fix(1, 4), time + 1000);
  a = recordRideFix(a, fix(2, -3), time + 2000);
  assert.equal(getActiveRide(a).distanceMeters, 0);
  const before = a;
  assert.equal(recordRideFix(a, fix(2, 900), time + 2000), before);
  a = recordRideFix(a, fix(3, 10000), time + 3000);
  assert.equal(getActiveRide(a).distanceMeters, 0);
  assert.ok(getActiveRide(a).trackingWarning);
  let stationary = begin();
  for (let second = 1; second <= 200; second++) stationary = recordRideFix(stationary, fix(second, 2), time + second * 1000);
  stationary = recordRideFix(stationary, fix(201, 1000), time + 201000);
  assert.equal(getActiveRide(stationary).distanceMeters, 0);
});
test('low accuracy and missing/paused GPS re-anchor without billing the gap', () => {
  let a = recordRideFix(begin(), fix(10, 100), time + 10000);
  const measured = getActiveRide(a).distanceMeters;
  a = recordRideFix(a, fix(20, 200, 80), time + 20000);
  a = recordRideFix(a, fix(25, 4000), time + 25000);
  assert.equal(getActiveRide(a).distanceMeters, measured);
  a = recordRideFix(a, fix(70, 8000), time + 70000);
  assert.equal(getActiveRide(a).distanceMeters, measured);
  a = interruptRide(a);
  a = recordRideFix(a, fix(80, 9000), time + 80000);
  assert.equal(getActiveRide(a).distanceMeters, measured);
  a = finishRide(a, undefined, when(81));
  assert.equal(a.rides[0].status, 'completed');
  assert.equal(a.rides[0].distanceMeters, measured);
  assert.ok(a.rides[0].trackingWarning);
});
test('insufficient balance ends tracking, preserves debt, and settlement is idempotent', () => {
  let a = begin(createAccount(user));
  a = finishRide(a, fix(10, 100), when(10));
  assert.equal(getActiveRide(a), null);
  assert.equal(a.balanceCents, 0);
  assert.equal(a.rides[0].settled, false);
  assert.throws(() => startRide(a, selection, fix(11), 'another', when(11)), /rozlicz/);
  assert.throws(() => settleRide(a, 'ride-one'), /Za mało/);
  a = refillAccount(a, 100, 'blik', 'refill-debt', when(11));
  a = settleRide(a, 'ride-one', when(12));
  assert.equal(a.balanceCents, 46);
  assert.equal(a.rides[0].settled, true);
  assert.equal(settleRide(a, 'ride-one'), a);
  const s = storage(); saveAccount(s, a); assert.deepEqual(readAccount(s, user), a);
});
test('discount is frozen on check-in and free reductions never require funds', () => {
  const base = account();
  base.profile.discountId = 'student';
  let a = begin(base);
  a.profile.discountId = 'normal';
  a = finishRide(a, fix(10, 100), when(10));
  assert.equal(a.rides[0].discountPercent, 50);
  assert.equal(a.rides[0].amountCents, 27);
  const free = createAccount(user); free.profile.discountId = 'senior';
  const done = finishRide(begin(free), fix(10, 100), when(10));
  assert.equal(done.balanceCents, 0);
  assert.equal(done.rides[0].settled, true);
});
test('fresh reliable GPS is required; delayed checkout cannot end another ride', () => {
  assert.throws(() => startRide(account(), selection, fix(0, 0, 51), 'bad', when(0)), /GPS/);
  assert.throws(() => startRide(account(), selection, fix(), 'old', when(21)), /GPS/);
  assert.throws(() => startRide(account(), selection, { ...fix(), lat: 150 }, 'bad', when(0)), /GPS/);
  let a = finishRide(begin(), fix(10, 100), when(10), 'ride-one');
  a = startRide(a, selection, fix(11, 100), 'ride-two', when(11));
  assert.equal(finishRide(a, fix(12, 110), when(12), 'ride-one'), a);
  assert.equal(getActiveRide(a).id, 'ride-two');
});
test('legacy wallets migrate without losing balance; failed writes cannot debit', () => {
  const s = storage(), legacy = account(); delete legacy.rides;
  s.setItem(accountKey(user.id), JSON.stringify(legacy));
  const restored = readAccount(s, user);
  assert.equal(restored.balanceCents, 2000);
  assert.deepEqual(restored.rides, []);
  const active = begin(restored);
  s.setItem(accountKey(user.id), JSON.stringify(active));
  const completed = finishRide(active, fix(10, 100), when(10));
  assert.throws(() => saveAccount({ getItem: s.getItem, setItem: () => { throw new Error('Quota'); } }, completed));
  assert.equal(readAccount(s, user).balanceCents, 2000);
  assert.equal(readAccount(s, user).rides[0].status, 'active');
  const corrupt = { ...completed, rides: [{ ...completed.rides[0], amountCents: 0 }] };
  assert.throws(() => saveAccount(s, corrupt), /portfela/);
});