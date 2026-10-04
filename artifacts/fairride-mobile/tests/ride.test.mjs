import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

const source = path => fs.readFile(new URL(path, import.meta.url), 'utf8');
const compile = code => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const pricing = compile(await source('../../../lib/fairride-core/src/pricing.ts'));
const policy = compile((await source('../../../lib/fairride-core/src/fare-policy.ts'))
  .replace("from './pricing'", `from ${JSON.stringify(pricing)}`));
const account = compile((await source('../../../lib/fairride-core/src/passenger-account.ts'))
  .replace("from './fare-policy'", `from ${JSON.stringify(policy)}`));
const ride = compile((await source('../../../lib/fairride-core/src/passenger-ride.ts'))
  .replace("from './fare-policy'", `from ${JSON.stringify(policy)}`)
  .replace("from './pricing'", `from ${JSON.stringify(pricing)}`));
const core = compile(`export * from ${JSON.stringify(account)}; export * from ${JSON.stringify(ride)}; export * from ${JSON.stringify(policy)};`);
const stateUrl = compile((await source('../services/ride-state.ts'))
  .replace("from '@workspace/fairride-core'", `from ${JSON.stringify(core)}`));
const state = await import(stateUrl);
const { getActiveRide, getUnpaidRide } = await import(core);
const time = Date.parse('2026-10-04T08:00:00Z');
const fix = (seconds = 0, metres = 0, accuracy = 3) => ({ lat: 50 + metres / 111195, lng: 19, accuracy, timestamp: time + seconds * 1000 });
const when = seconds => new Date(time + seconds * 1000);
const selection = { transport: 'BUS', lineName: '124', originName: 'Start', destinationName: 'Cel' };
function begin(balance = 2000) {
  let s = state.initialState();
  if (balance) s = state.topUp(s, balance, 'topup');
  s = state.board(s, selection, fix(), 'ride-one', when(0));
  return { ...s, tracking: 'running' };
}
test('locked-screen OS batches meter sample timestamps, not delivery time; replay is ignored', () => {
  let s = begin();
  s = state.collect(s, [fix(30, 300), fix(10, 100), fix(20, 200)], time + 120000);
  assert.ok(getActiveRide(s.account).distanceMeters > 299);
  assert.equal(s.account.balanceCents, 2000);
  assert.equal(s.samples.length, 4);
  const same = state.collect(s, [fix(10, 100), fix(20, 200)], time + 120000);
  assert.equal(same, s);
  s = state.checkout(s, 'ride-one', when(130));
  assert.equal(s.account.transactions.filter(tx => tx.kind === 'ride').length, 1);
  assert.equal(s.account.balanceCents, 1938);
  assert.deepEqual(s.samples, []);
  assert.equal(s.account.rides[0].lastFix, null);
  assert.equal(s.account.rides[0].anchorFix, null);
  assert.equal(state.checkout(s, 'ride-one', when(131)), s);
  assert.equal(state.collect(s, [fix(140, 10000)], time + 140000), s);
});
test('durable rehydration preserves active samples, distance, tariff and watermark', () => {
  let s = state.collect(begin(), [fix(10, 100)], time + 10000);
  s = state.setDiscount(s, 'senior');
  const restored = state.validateState(JSON.stringify(s));
  assert.deepEqual(restored, s);
  s = state.collect(restored, [fix(20, 200)], time + 20000);
  assert.ok(getActiveRide(s.account).distanceMeters > 199);
  assert.equal(getActiveRide(s.account).discountId, 'normal');
  assert.equal(getActiveRide(s.account).rateCentsPerKm, 40);
});
test('signal loss, bad accuracy, force-stop gaps and impossible jumps do not invent distance', () => {
  let s = state.collect(begin(), [fix(10, 100)], time + 10000);
  const distance = getActiveRide(s.account).distanceMeters;
  s = state.collect(s, [fix(20, 200, 80), fix(30, 300)], time + 30000);
  assert.equal(getActiveRide(s.account).distanceMeters, distance);
  s = state.pause(s, 'Proces zatrzymany');
  s = state.collect(s, [fix(100, 2000)], time + 100000);
  assert.equal(getActiveRide(s.account).distanceMeters, distance);
  s = state.collect(s, [fix(110, 2100), fix(111, 50000)], time + 111000);
  assert.ok(getActiveRide(s.account).distanceMeters < 201);
  s = state.collect(s, [fix(110, 90000)], time + 111000);
  assert.ok(getActiveRide(s.account).distanceMeters < 201);
});
test('long unobserved gap is not replaced by planned route distance', () => {
  let s = state.collect(begin(), [fix(10, 100), fix(100, 10000), fix(110, 10100)], time + 110000);
  assert.ok(getActiveRide(s.account).distanceMeters < 201);
  assert.equal(getActiveRide(s.account).gapCount, 1);
  assert.ok(!('polyline' in s.account.rides[0]));
});
test('insufficient funds still complete and purge GPS; subsequent settlement is idempotent', () => {
  let s = state.collect(begin(0), [fix(10, 100)], time + 10000);
  s = state.checkout(s, 'ride-one', when(20));
  assert.equal(getActiveRide(s.account), null);
  assert.ok(getUnpaidRide(s.account));
  assert.deepEqual(s.samples, []);
  assert.throws(() => state.pay(s, 'ride-one'), /Za mało/);
  s = state.topUp(s, 1000, 'refill-after');
  s = state.pay(s, 'ride-one');
  const balance = s.account.balanceCents;
  s = state.pay(s, 'ride-one');
  assert.equal(s.account.balanceCents, balance);
  assert.equal(s.account.transactions.filter(tx => tx.kind === 'ride').length, 1);
  assert.deepEqual(state.validateState(JSON.stringify(s)), s);
});
test('permission-quality failure cannot check in, debit, or replace stored data', () => {
  const s = state.initialState();
  assert.throws(() => state.board(s, selection, fix(0, 0, 100), 'bad', when(0)), /Check-in wymaga/);
  assert.equal(s.account.rides.length, 0);
  assert.equal(s.account.balanceCents, 0);
  assert.throws(() => state.validateState('broken'));
  assert.throws(() => state.validateState(JSON.stringify({ ...s, version: 99 })));
});
test('Chrome-parity profile save validates fields and leaves active ride pricing unchanged', () => {
  const s = begin();
  const changed = state.setProfile(s, { ...s.account.profile, firstName: 'Test', lastName: 'Passenger', discountId: 'student' });
  const restored = state.validateState(JSON.stringify(changed));
  assert.equal(restored.account.profile.discountId, 'student');
  assert.equal(getActiveRide(restored.account).discountId, 'normal');
  assert.equal(restored.account.balanceCents, s.account.balanceCents);
  assert.throws(() => state.setProfile(s, { ...s.account.profile, firstName: '' }));
  assert.throws(() => state.setProfile(s, { ...s.account.profile, email: 'not-an-email' }));
  assert.throws(() => state.setProfile(s, { ...s.account.profile, photo: 'https://remote.invalid/photo' }));
});
test('all Chrome refill methods remain local simulated and idempotent on mobile', () => {
  let s = state.initialState();
  for (const method of ['blik', 'google_pay', 'apple_pay']) {
    s = state.topUp(s, 1000, `refill-${method}`, method);
    s = state.topUp(s, 1000, `refill-${method}`, method);
    assert.equal(s.account.transactions[0].method, method);
  }
  assert.equal(s.account.balanceCents, 3000);
  assert.equal(s.account.transactions.length, 3);
  assert.deepEqual(state.validateState(JSON.stringify(s)), s);
});

// Exercise the production repository and native coordinator with explicit OS adapters.
// This is not a physical-device test: lock-screen scheduling and notifications remain
// unverified until the native checklist is performed on an installed build.
const db = new DatabaseSync(':memory:');
globalThis.__fairrideTest = { db, failSave: false, running: false, failStop: false,
  foregroundGranted: true, backgroundGranted: true, notificationGranted: true,
  handlers: new Map(), starts: [], stops: 0 };
const platform = compile(`
  export const Platform = { OS: 'android', Version: 35 };
  export const PermissionsAndroid = { PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' }, RESULTS: { GRANTED: 'granted' },
    request: async () => globalThis.__fairrideTest.notificationGranted ? 'granted' : 'denied' };
`);
const sqlite = compile(`
  export const openDatabaseAsync = async () => ({
    execAsync: async sql => globalThis.__fairrideTest.db.exec(sql),
    withExclusiveTransactionAsync: async action => {
      const db = globalThis.__fairrideTest.db; db.exec('BEGIN');
      try { await action({
        execAsync: async sql => db.exec(sql),
        getFirstAsync: async sql => db.prepare(sql).get(),
        runAsync: async (sql, ...params) => {
          if (globalThis.__fairrideTest.failSave && sql.includes('ON CONFLICT')) throw Error('disk full');
          return db.prepare(sql).run(...params);
        }
      }); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
    }
  });
`);
const asyncStorage = compile('export default { getItem: async () => null, setItem: async () => {} };');
const storeUrl = compile((await source('../services/ride-store.ts'))
  .replace("from 'react-native'", `from ${JSON.stringify(platform)}`)
  .replace("from '@react-native-async-storage/async-storage'", `from ${JSON.stringify(asyncStorage)}`)
  .replace("from './ride-state'", `from ${JSON.stringify(stateUrl)}`)
  .replace("import('expo-sqlite')", `import(${JSON.stringify(sqlite)})`));
const store = await import(storeUrl);
const location = compile(`
  export const Accuracy = { Highest: 6, BestForNavigation: 6 };
  export const ActivityType = { AutomotiveNavigation: 1 };
  export const requestForegroundPermissionsAsync = async () => ({ granted: globalThis.__fairrideTest.foregroundGranted });
  export const requestBackgroundPermissionsAsync = async () => ({ granted: globalThis.__fairrideTest.backgroundGranted });
  export const getBackgroundPermissionsAsync = requestBackgroundPermissionsAsync;
  export const getForegroundPermissionsAsync = async () => ({ granted: true, android: {accuracy:'fine'} });
  export const hasServicesEnabledAsync = async () => true;
  export const getCurrentPositionAsync = async () => ({ coords: {latitude:50, longitude:19, accuracy:3}, timestamp:Date.now() });
  export const hasStartedLocationUpdatesAsync = async () => globalThis.__fairrideTest.running;
  export const startLocationUpdatesAsync = async (name, options) => { globalThis.__fairrideTest.starts.push(options); globalThis.__fairrideTest.running = true; };
  export const stopLocationUpdatesAsync = async () => { const t = globalThis.__fairrideTest; t.stops++; if(t.failStop) throw Error('OS refused'); t.running = false; };
`);
const taskManager = compile(`
  export const isTaskDefined = name => globalThis.__fairrideTest.handlers.has(name);
  export const defineTask = (name, handler) => globalThis.__fairrideTest.handlers.set(name,handler);
  export const isAvailableAsync = async () => true;
`);
const constants = compile("export default { executionEnvironment: 'standalone' };");
const nativeUrl = compile((await source('../services/native-tracking.ts'))
  .replace("from 'react-native'", `from ${JSON.stringify(platform)}`)
  .replace("from 'expo-location'", `from ${JSON.stringify(location)}`)
  .replace("from 'expo-task-manager'", `from ${JSON.stringify(taskManager)}`)
  .replace("from 'expo-constants'", `from ${JSON.stringify(constants)}`)
  .replace("from '@workspace/fairride-core'", `from ${JSON.stringify(core)}`)
  .replace("from './ride-state'", `from ${JSON.stringify(stateUrl)}`)
  .replace("from './ride-store'", `from ${JSON.stringify(storeUrl)}`));
const native = await import(nativeUrl);
beforeEach(async () => {
  db.exec('CREATE TABLE IF NOT EXISTS ride_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); DELETE FROM ride_state;');
  Object.assign(globalThis.__fairrideTest, { failSave: false, running: false, failStop: false,
    foregroundGranted: true, backgroundGranted: true, notificationGranted: true, starts: [], stops: 0 });
});
test('SQLite serializes concurrent callbacks/checkouts and commits one debit + GPS purge', async () => {
  await store.updateState(() => begin());
  await Promise.all([
    store.updateState(s => state.collect(s, [fix(10, 100)], time + 10000)),
    store.updateState(s => state.checkout(s, 'ride-one', when(20))),
    store.updateState(s => state.checkout(s, 'ride-one', when(20))),
    store.updateState(s => state.collect(s, [fix(30, 300)], time + 30000)),
  ]);
  const restored = await store.loadState();
  assert.equal(restored.account.transactions.filter(tx => tx.kind === 'ride').length, 1);
  assert.equal(restored.account.balanceCents, 1946);
  assert.deepEqual(restored.samples, []);
  assert.equal(getActiveRide(restored.account), null);
});
test('SQLite write failure rolls back completion, balance and sample purge; retry succeeds', async () => {
  const original = begin();
  await store.updateState(() => original);
  globalThis.__fairrideTest.failSave = true;
  await assert.rejects(store.updateState(s => state.checkout(s, 'ride-one', when(20))), /disk full/);
  const raw = db.prepare('SELECT payload FROM ride_state').get().payload;
  assert.deepEqual(state.validateState(raw), original);
  globalThis.__fairrideTest.failSave = false;
  const restored = await store.updateState(s => state.checkout(s, 'ride-one', when(20)));
  assert.equal(restored.account.rides[0].settled, true);
});
test('native permission/notification denial does not board or launch location task', async () => {
  for (const flag of ['foregroundGranted', 'backgroundGranted', 'notificationGranted']) {
    globalThis.__fairrideTest[flag] = false;
    await assert.rejects(native.checkIn(selection));
    assert.equal(getActiveRide((await store.loadState()).account), null);
    assert.equal(globalThis.__fairrideTest.starts.length, 0);
    globalThis.__fairrideTest[flag] = true;
  }
});
test('native registration, service notification and repeated checkout operate once', async () => {
  await store.updateState(s => state.topUp(s, 2000, 'refill'));
  const started = await native.checkIn(selection);
  assert.equal(started.account.balanceCents, 2000);
  assert.equal(globalThis.__fairrideTest.running, true);
  assert.ok(globalThis.__fairrideTest.handlers.has(native.LOCATION_TASK));
  assert.equal(globalThis.__fairrideTest.starts[0].foregroundService.notificationTitle, 'FairRide — aktywny przejazd');
  const rideId = getActiveRide(started.account).id;
  await Promise.all([native.checkOut(rideId), native.checkOut(rideId)]);
  const ended = await store.loadState();
  assert.equal(globalThis.__fairrideTest.running, false);
  assert.equal(ended.account.balanceCents, 1950);
  assert.equal(ended.account.transactions.filter(tx => tx.kind === 'ride').length, 1);
  assert.deepEqual(ended.samples, []);
});
test('OS stop failure is visible, ignores late callbacks and retries without rebilling', async () => {
  const started = await native.checkIn(selection);
  globalThis.__fairrideTest.failStop = true;
  let ended = await native.checkOut(getActiveRide(started.account).id);
  assert.equal(getActiveRide(ended.account), null);
  assert.equal(ended.tracking, 'stopping');
  assert.ok(ended.issue);
  await globalThis.__fairrideTest.handlers.get(native.LOCATION_TASK)({
    data: {locations: [{coords: {latitude: 51, longitude:19, accuracy:3}, timestamp:Date.now()}]}
  });
  ended = await store.loadState();
  assert.deepEqual(ended.samples, []);
  globalThis.__fairrideTest.failStop = false;
  ended = await native.reconcileTracking();
  assert.equal(ended.tracking, 'off');
  assert.equal(globalThis.__fairrideTest.running, false);
});
test('native checkout attempts OS stop even when completion cannot be saved', async () => {
  const started = await native.checkIn(selection);
  globalThis.__fairrideTest.failSave = true;
  await assert.rejects(native.checkOut(getActiveRide(started.account).id));
  assert.equal(globalThis.__fairrideTest.running, false);
  assert.equal(globalThis.__fairrideTest.stops, 1);
  globalThis.__fairrideTest.failSave = false;
  assert.ok(getActiveRide((await store.loadState()).account));
  await native.checkOut(getActiveRide(started.account).id);
  assert.equal(getActiveRide((await store.loadState()).account), null);
});
test('process termination is detected on resume, preserves ride and demands explicit restart', async () => {
  const started = await native.checkIn(selection);
  globalThis.__fairrideTest.running = false;
  const restored = await native.reconcileTracking();
  assert.equal(getActiveRide(restored.account).id, getActiveRide(started.account).id);
  assert.equal(restored.tracking, 'interrupted');
  assert.ok(restored.issue.includes('proces'));
  const resumed = await native.resumeTracking();
  assert.equal(resumed.tracking, 'running');
  assert.equal(getActiveRide(resumed.account).anchorFix, null);
});
test('stale checkout of an earlier ride cannot stop a new ride', async () => {
  const started = await native.checkIn(selection);
  await native.checkOut('earlier-ride');
  assert.equal(globalThis.__fairrideTest.running, true);
  assert.equal(getActiveRide((await store.loadState()).account).id, getActiveRide(started.account).id);
});