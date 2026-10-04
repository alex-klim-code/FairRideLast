import { test, expect } from '@playwright/test';

test('GPS ride survives navigation/reload; missing GPS ends ride, debt settles once', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    let lat = 50.0616, denied = false, next = 0;
    const watches = new Map<number, { ok: PositionCallback; fail: PositionErrorCallback }>();
    const position = () => ({ coords: { latitude: lat, longitude: 19.9383, accuracy: 3 }, timestamp: Date.now() }) as GeolocationPosition;
    const error = () => ({ code: 1, message: 'Denied' }) as GeolocationPositionError;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(ok: PositionCallback, fail: PositionErrorCallback) {
        const id = ++next; watches.set(id, { ok, fail }); queueMicrotask(() => denied ? fail(error()) : ok(position())); return id;
      },
      clearWatch(id: number) { watches.delete(id); },
      getCurrentPosition(ok: PositionCallback, fail: PositionErrorCallback) { queueMicrotask(() => denied ? fail(error()) : ok(position())); },
    } });
    (window as any).__gps = {
      move(metres: number) { lat += metres / 111195; watches.forEach(w => w.ok(position())); },
      deny() { denied = true; watches.forEach(w => w.fail(error())); },
    };
  });
  const collection = { provider: 'geoapify', features: [{ geometry: { type: 'Point', coordinates: [19.94, 50.07] }, properties: { name: 'Cel testowy', formatted: 'Cel testowy' } }] };
  await page.route('**/api/maps/config', r => r.fulfill({ status: 503, json: { error: 'Map disabled in GPS contract test' } }));
  await page.route('**/api/geocoding/search', r => r.fulfill({ json: collection }));
  await page.route('**/api/geocoding/reverse', r => r.fulfill({ json: collection }));
  let calls = 0;
  await page.route('**/api/transit/routes', r => {
    calls++;
    return r.fulfill({ json: { provider: 'google', requestedAt: new Date().toISOString(), routes: [{
      id: 'bus-test', polyline: '_p~iF~ps|U_ulLnnqC', distanceMeters: 1000, durationSeconds: 600, transfers: 0,
      steps: [{ mode: 'TRANSIT', vehicleType: 'BUS', lineShortName: '124', departureStop: 'Start', arrivalStop: 'Cel',
        instruction: 'Autobus 124', distanceMeters: 1000, durationSeconds: 600 }],
    }] } });
  });
  await page.goto('/login');
  await page.getByTestId('button-login-user').click();
  await page.getByTestId('input-search-destination').fill('Cel testowy');
  await page.getByTestId('button-search-destination').click();
  await page.getByTestId('destination-result-0').click();
  await page.getByTestId('button-real-route-0').click();
  await expect(page.getByTestId('list-real-routes')).not.toBeVisible();
  await expect(page.getByTestId('button-buy-ticket')).toHaveCount(0);
   await page.getByTestId('button-step-0').click();
   await expect(page.getByTestId('page-boarding')).toBeVisible();
   await expect(page.getByTestId('text-line-number')).toHaveText('124');
   await expect(page.getByTestId('text-checkin-state')).toHaveText('nie rozpoczęto');
   await expect(page.getByTestId('text-rate')).toContainText('0,40 PLN');
   await page.getByTestId('button-confirm-check-in').click();
   await expect(page.getByTestId('page-boarding-active')).toBeVisible();
  await page.clock.runFor(10000);
  await page.evaluate(() => (window as any).__gps.move(100));
  await page.getByTestId('link-nav-profile').click();
  await page.clock.runFor(10000);
  await page.evaluate(() => (window as any).__gps.move(100));
  await page.getByTestId('link-nav-bilet').click();
  await expect(page.getByTestId('active-ride')).toContainText('0.20 km');
  const wallet = () => page.evaluate(() => JSON.parse(Object.values(localStorage).find(v => {
    try { const a = JSON.parse(v); return a.version === 1 && Array.isArray(a.rides); } catch { return false; }
  })!));
  expect((await wallet()).balanceCents).toBe(0);
  expect(calls).toBe(1);
  await page.reload();
  await expect(page.getByTestId('active-ride')).toContainText('0.20 km');
  await page.evaluate(() => (window as any).__gps.deny());
  await page.getByTestId('button-check-out').click();
  await expect(page.getByTestId('unpaid-ride')).toBeVisible();
  let data = await wallet();
  expect(data.rides[0].status).toBe('completed');
  expect(data.rides[0].amountCents).toBe(58);
  expect(data.balanceCents).toBe(0);
  const distance = data.rides[0].distanceMeters;
  await page.clock.runFor(10000);
  await page.evaluate(() => (window as any).__gps.move(1000));
  expect((await wallet()).rides[0].distanceMeters).toBe(distance);
  await page.getByTestId('link-nav-profile').click();
  await page.getByTestId('link-nav-bills').click();
  await page.getByTestId('button-refill').click();
  await page.getByTestId('link-nav-bilet').click();
  await page.getByTestId('button-settle-ride').click();
  await expect(page.getByTestId('ride-receipt')).toBeVisible();
  data = await wallet();
  expect(data.balanceCents).toBe(1942);
  expect(data.transactions.filter((t: any) => t.kind === 'ride')).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('ride-receipt')).toBeVisible();
  expect((await wallet()).balanceCents).toBe(1942);
  expect(calls).toBe(1);
});