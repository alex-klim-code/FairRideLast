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
const service = compile((await fs.readFile(new URL('../../../lib/fairride-core/src/passenger-account.ts', import.meta.url), 'utf8'))
  .replace("from './fare-policy'", `from ${JSON.stringify(policy)}`));
const { quoteRoute, priceForDistance } = await import(policy);
const { createAccount, readAccount, saveAccount, refillAccount, purchaseTicket, endTicket,
  getActiveTicket, parseRefillAmount, validateProfile, accountKey } = await import(service);
const user = { id: 'test-user', firstName: 'Test', lastName: 'Passenger', email: 'test@example.test', phone: '+48 123 456 789' };
const now = new Date('2026-10-03T12:00:00Z');
const route = {
  id: 'provider-route', distanceMeters: 4500, durationSeconds: 1200, transfers: 1, polyline: 'NEVER_PERSIST_THIS',
  steps: [
    { mode: 'WALK', distanceMeters: 500, durationSeconds: 300, instruction: 'Provider walking instruction' },
    { mode: 'TRANSIT', vehicleType: 'BUS', distanceMeters: 2000, durationSeconds: 300, instruction: '', lineShortName: 'provider-124' },
    { mode: 'TRANSIT', vehicleType: 'TRAM', distanceMeters: 2000, durationSeconds: 300, instruction: '', departureStop: 'Provider stop' },
  ],
};
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
test('missing route measures or unknown steps cannot become a fabricated free walking ticket', () => {
  for (const incomplete of [
    { ...route, distanceMeters: null },
    { ...route, steps: [] },
    { ...route, steps: [{ mode: 'OTHER', distanceMeters: 10, durationSeconds: 60 }] },
    { ...route, steps: [{ mode: 'TRANSIT', vehicleType: 'BUS', distanceMeters: null }] },
    { ...route, steps: [{ mode: 'WALK', distanceMeters: null }] },
  ]) assert.throws(() => quoteRoute(incomplete, 'normal'));
  const walk = quoteRoute({ ...route, steps: [{ mode: 'WALK', distanceMeters: 0 }] }, 'normal');
  assert.equal(walk.totalCents, 0);
  assert.equal(walk.walkingKm, 0);
});
test('route pricing charges every transit boarding but never walking, with integer-cents discounts', () => {
  const ordinary = quoteRoute(route, 'normal');
  assert.equal(ordinary.totalCents, 280); // (0.50 + 2*0.40) + (0.50 + 2*0.50)
  assert.equal(ordinary.startFeesCents, 100);
  assert.equal(ordinary.walkingKm, 0.5);
  assert.equal(quoteRoute(route, 'student').totalCents, 140);
  assert.equal(quoteRoute(route, 'senior').totalCents, 0);
  assert.equal(priceForDistance(2, 0.4, 'student'), 65);
  assert.equal(quoteRoute({ ...route, steps: [route.steps[0]] }, 'normal').totalCents, 0);
  assert.equal(quoteRoute({ ...route, steps: [{ ...route.steps[1], vehicleType: 'UNSPECIFIED' }] }, 'normal').totalCents, 150);
  assert.throws(() => quoteRoute({ ...route, distanceMeters: NaN }, 'normal'));
});
test('all three fake refill methods credit exactly once and survive reload', () => {
  for (const method of ['blik', 'google_pay', 'apple_pay']) {
    const storage = memory();
    const account = readAccount(storage, user);
    assert.equal(account.balanceCents, 0);
    const credited = refillAccount(account, 5000, method, 'same-operation', now);
    assert.equal(refillAccount(credited, 5000, method, 'same-operation', now), credited);
    saveAccount(storage, credited);
    assert.equal(readAccount(storage, user).balanceCents, 5000);
    assert.equal(readAccount(storage, user).transactions.length, 1);
  }
});
test('refill amount validation handles Polish commas and rejects invalid precision/ranges', () => {
  assert.equal(parseRefillAmount('12,34'), 1234);
  for (const amount of ['-10', '0', '0.50', '12.345', 'Infinity', 'NaN', '2000.01', '1e3', '']) {
    assert.throws(() => parseRefillAmount(amount));
  }
});
test('purchase atomically debits wallet, creates active receipt, and preserves its price after profile edits', () => {
  const storage = memory();
  let account = refillAccount(createAccount(user), 5000, 'blik', 'refill', now);
  account = purchaseTicket(account, quoteRoute(route, 'student'), 'Moja lokalizacja', 'Wybrany cel', 'purchase', now);
  assert.equal(account.balanceCents, 4860);
  assert.equal(account.tickets.length, 1);
  assert.equal(purchaseTicket(account, quoteRoute(route, 'student'), 'start', 'end', 'purchase', now), account);
  const active = getActiveTicket(account, now.getTime());
  assert.equal(active.amountCents, 140);
  assert.deepEqual(active.transports, ['BUS', 'TRAM']);
  assert.throws(() => purchaseTicket(account, quoteRoute(route, 'normal'), 'start', 'end', 'another', now), /aktywny/);
  account = { ...account, profile: { ...account.profile, discountId: 'normal' } };
  saveAccount(storage, account);
  const loaded = readAccount(storage, user);
  assert.equal(loaded.tickets[0].discountId, 'student');
  assert.equal(loaded.tickets[0].amountCents, 140);
  const serial = storage.getItem(accountKey(user.id));
  for (const forbidden of ['NEVER_PERSIST_THIS', 'provider-route', 'provider-124', 'Provider stop', 'Provider walking instruction']) {
    assert.equal(serial.includes(forbidden), false);
  }
  const ended = endTicket(loaded, active.id, now);
  assert.equal(getActiveTicket(ended, now.getTime()), null);
  assert.equal(ended.balanceCents, 4860); // no silent refund
  assert.equal(getActiveTicket(loaded, now.getTime() + 2 * 3600000), null);
});
test('insufficient balance and blocked storage cannot partially create or debit a ticket', () => {
  const empty = createAccount(user);
  assert.throws(() => purchaseTicket(empty, quoteRoute(route, 'normal'), 'start', 'end', 'buy', now), /Za mało/);
  assert.equal(empty.tickets.length, 0);
  const free = purchaseTicket(empty, quoteRoute(route, 'senior'), 'start', 'end', 'free', now);
  assert.equal(free.balanceCents, 0);
  const storage = memory();
  const funded = refillAccount(empty, 1000, 'apple_pay', 'fund', now);
  saveAccount(storage, funded);
  const next = purchaseTicket(funded, quoteRoute(route, 'normal'), 'start', 'end', 'buy', now);
  const blocked = { ...storage, setItem() { throw new Error('Quota'); } };
  assert.throws(() => saveAccount(blocked, next), /nie zostały zmienione/);
  assert.equal(readAccount(storage, user).balanceCents, 1000);
  assert.equal(readAccount(storage, user).tickets.length, 0);
});
test('profile, discount and local photo persist; corrupt ledgers are never silently reset', () => {
  const storage = memory();
  let account = createAccount(user);
  account.profile = validateProfile({ ...account.profile, firstName: 'Edited', discountId: 'pupil', photo: 'data:image/png;base64,YWJj' });
  saveAccount(storage, account);
  assert.equal(readAccount(storage, user).profile.discountId, 'pupil');
  assert.equal(readAccount(storage, user).profile.photo, account.profile.photo);
  assert.throws(() => validateProfile({ ...account.profile, photo: 'https://untrusted.example/avatar' }));
  assert.throws(() => validateProfile({ ...account.profile, email: 'not-an-email' }));
  storage.setItem(accountKey(user.id), JSON.stringify({ ...account, balanceCents: 99999 }));
  assert.throws(() => readAccount(storage, user), /Nie nadpisaliśmy/);
  assert.equal(JSON.parse(storage.getItem(accountKey(user.id))).balanceCents, 99999);
  assert.equal(readAccount(storage, { ...user, id: 'another-user' }).balanceCents, 0);
});