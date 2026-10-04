import { test, expect, type Page } from '@playwright/test';
import { DESTINATION_HISTORY_KEY } from '../../src/services/destination-history';

// Provider-contract fixtures only, never demo transit or billable provider calls.
const address = 'Bardzo długa nazwa miejsca docelowego przy ulicy Testowej 123, Stare Miasto, Kraków, Polska';
const collection = (name: string) => ({ provider: 'geoapify', features: [{
  geometry: { type: 'Point', coordinates: [19.9352, 50.0541] }, properties: { name, formatted: name },
}] });
const steps = (vehicleType: string, lineShortName: string, distance: number) => [
  { mode: 'WALK', instruction: 'Walk to stop', distanceMeters: 100, durationSeconds: 90 },
  { mode: 'TRANSIT', instruction: 'Board', distanceMeters: distance, durationSeconds: 700,
    vehicleType, lineShortName, departureStop: 'Start', arrivalStop: 'End' },
  { mode: 'WALK', instruction: 'Walk to destination', distanceMeters: 200, durationSeconds: 180 },
];
const routes = { provider: 'google', requestedAt: new Date().toISOString(), routes: [
  { id: 'bus', polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', distanceMeters: 3300, durationSeconds: 970, transfers: 0, steps: steps('BUS', '124', 3000) },
  { id: 'tram', polyline: '_p~iF~ps|U_ulLnnqC', distanceMeters: 2300, durationSeconds: 850, transfers: 0, steps: steps('TRAM', '52', 2000) },
] };

async function open(page: Page, denied = false) {
  let requests = 0;
  await page.route('**/api/maps/config', r => r.fulfill({ status: 503, json: { error: 'Map disabled in offline contract tests' } }));
  await page.route('**/api/geocoding/reverse', r => r.fulfill({ json: collection('Adres rzeczywistego startu, Kraków') }));
  await page.route('**/api/geocoding/search', r => r.fulfill({ json: collection(address) }));
  await page.route('**/api/transit/routes', r => { requests++; return r.fulfill({ json: routes }); });
  if (denied) await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(_ok: unknown, fail: (e: unknown) => void) { fail({ code: 1, message: 'Denied' }); return 1; },
      getCurrentPosition(_ok: unknown, fail: (e: unknown) => void) { fail({ code: 1, message: 'Denied' }); },
      clearWatch() {},
    } });
  });
  await page.goto('/login');
  await page.getByTestId('button-login-user').click();
  await expect(page.getByTestId('input-search-destination')).toBeVisible();
  return () => requests;
}
async function choose(page: Page) {
  await page.getByTestId('input-search-destination').fill('Test Kraków');
  await page.getByTestId('button-search-destination').click();
  await page.getByTestId('destination-result-0').click();
}

test('passenger header and three-tab footer stay fixed; Bills and Prices live in Profile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await open(page, true);
  const header = page.getByTestId('passenger-header');
  const footer = page.getByTestId('passenger-footer');
  await expect(footer.locator('a')).toHaveText(['Bilet', 'Go', 'Profile']);
  await expect(header.locator('nav, button')).toHaveCount(0);
  await expect(header.locator('.pz-avatar')).toBeVisible();
  await expect(header.locator('.pz-wordmark')).toBeVisible();
  await expect(header.locator('.pz-wordmark')).toHaveText('FairRide');
  await expect(page.getByTestId('link-nav-bills')).toHaveCount(0);
  await page.getByTestId('link-nav-profile').click();
  await expect(page.getByTestId('link-nav-bills')).toBeVisible();
  await expect(page.getByTestId('link-nav-prices')).toBeVisible();
  await expect(page.getByTestId('passenger-account-mode')).toHaveCount(0);
  await expect(page.locator('main.pz-main')).not.toContainText(/demo|simulat|virtual wallet|test mode/i);
  expect(await page.locator('main.pz-main').evaluate(el => getComputedStyle(el).fontSize)).toBe('13px');
  await page.getByTestId('input-profile-firstName').fill('Anna');
  await page.getByTestId('input-profile-lastName').fill('Testowa');
  await page.getByTestId('button-save-profile').click();
  await expect(page.getByTestId('header-passenger-name')).toHaveText('Anna Testowa');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    const initialHeader = await header.boundingBox();
    const initialFooter = await footer.boundingBox();
    await page.locator('main.pz-main').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.evaluate(() => window.scrollTo(0, 10000));
    expect((await header.boundingBox())!.y).toBe(initialHeader!.y);
    expect((await footer.boundingBox())!.y).toBe(initialFooter!.y);
    expect(initialHeader!.y).toBe(0);
    expect(initialFooter!.y + initialFooter!.height).toBe(640);
    await expect(header.locator('.pz-avatar')).toBeVisible();
    await expect(header.locator('.pz-wordmark')).toBeVisible();
    await expect(page.getByTestId('header-passenger-name')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: '/tmp/fairride-compact-profile.png' });
  }
  await page.getByTestId('link-nav-bills').click();
  await expect(page.getByTestId('button-refill')).toBeVisible();
  await expect(page.getByTestId('link-nav-profile')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('link-nav-profile').click();
  await page.getByTestId('link-nav-prices').click();
  await expect(page).toHaveURL(/\/prices$/);
  await expect(page.getByTestId('link-nav-profile')).toHaveAttribute('aria-current', 'page');
  await expect(footer.locator('a')).toHaveText(['Bilet', 'Go', 'Profile']);
});

test('suggests matching places while typing without Search and supports keyboard selection', async ({ page }) => {
  const routeRequests = await open(page, true);
  const queries: string[] = [];
  await page.route('**/api/geocoding/search', async route => {
    queries.push(route.request().postDataJSON().query);
    await route.fulfill({ json: collection('TAURON Arena Kraków, Stanisława Lema 7') });
  });
  const input = page.getByTestId('input-search-destination');
  await input.fill('Ta');
  await expect(page.getByTestId('destination-suggestions')).toContainText('co najmniej 3');
  expect(queries).toEqual([]);
  await input.pressSequentially('uron Arena', { delay: 40 });
  await expect(page.getByTestId('destination-result-0')).toContainText('TAURON Arena');
  expect(queries).toEqual(['Tauron Arena']);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByTestId('text-selected-destination')).toContainText('TAURON Arena');
  await expect(page.getByTestId('destination-suggestions')).toHaveCount(0);
  expect(queries).toHaveLength(1);
  expect(routeRequests()).toBe(0);
});
async function history(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), DESTINATION_HISTORY_KEY);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const section of ['bilet', 'go', 'profile']) {
    const link = page.getByTestId(`link-nav-${section}`);
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  }
}

test('compact screens preserve selected routes, wallet navigation and boarding without duplicate routes', async ({ page }, info) => {
  const calls = await open(page);
  await expect(page.getByTestId('text-selected-destination')).toHaveCount(0);
  expect(calls()).toBe(0);
  await choose(page);
  await expect(page.getByTestId('list-real-routes')).toBeVisible();
  await expect(page.getByTestId('text-location-source')).toContainText('Adres rzeczywistego startu');
  await expect(page.getByTestId('text-location-source')).not.toContainText('Geoapify');
  await expect(page.getByTestId('text-search-attribution')).toHaveText('Geoapify · © OpenStreetMap');
  await expect(page.getByTestId('link-search-privacy')).toHaveCount(0);
  expect(calls()).toBe(1);
  const firstFare = await page.getByTestId('text-route-fare-0').innerText();
  const secondFare = await page.getByTestId('text-route-fare-1').innerText();
  await page.getByTestId('button-route-details-1').click();
  await expect(page.getByTestId('button-route-details-1')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.walking-summary')).toContainText('Dojście do celu');
  await expect(page.getByTestId('list-real-routes')).not.toContainText('Walk to stop');
  await expect(page.getByTestId('list-real-routes')).not.toContainText('Walk to destination');
  await page.getByTestId('button-real-route-1').click();
  await expect(page.getByTestId('button-real-route-1')).toHaveAttribute('aria-pressed', 'true');
  expect(secondFare).not.toEqual(firstFare);
  await expect(page.getByTestId('list-real-routes')).not.toBeVisible();
  await expect(page.getByTestId('text-route-summary')).toBeVisible();
  await expect(page.getByTestId('text-walking-time')).toContainText('Pieszo:');
  await expect(page.getByTestId('button-buy-ticket')).toHaveCount(0);
  for (const width of [320, 360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await noOverflow(page);
    if (width < 951) {
      expect((await page.getByTestId('button-back-to-map').boundingBox())!.height).toBeLessThanOrEqual(32);
      await page.getByTestId('button-back-to-map').click();
      await expect(page.getByTestId('button-reopen-results')).toBeFocused();
      await page.getByTestId('input-search-destination').focus();
      await page.setViewportSize({ width, height: 360 }); // constrained visual viewport, like a keyboard
      await expect(page.getByTestId('button-search-destination')).toBeVisible();
      await noOverflow(page);
      await page.getByTestId('input-search-destination').press('Escape');
      await page.setViewportSize({ width, height: 800 });
      await page.getByTestId('button-reopen-results').click();
    } else {
      const map = await page.getByTestId('map-frame-google').boundingBox();
      const panel = await page.getByTestId('text-selected-destination').boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(map!.x + map!.width);
    }
  }
  await page.getByTestId('link-nav-profile').click();
  await page.getByTestId('link-nav-bills').click();
  await page.getByTestId('button-refill').click();
  await expect(page.getByRole('status')).toContainText('Refill of');
  const balanceAfterRefill = await page.getByTestId('text-balance').innerText();
  await page.getByTestId('button-close-refill-message').click();
  await expect(page.getByTestId('button-close-refill-message')).toHaveCount(0);
  await expect(page.getByTestId('button-refill')).toBeFocused();
  await expect(page.getByTestId('text-balance')).toHaveText(balanceAfterRefill);
  await page.getByTestId('link-nav-profile').click();
  await expect(page.getByTestId('input-profile-firstName')).toBeVisible();
  await page.getByTestId('link-nav-go').click();
  await expect(page.getByTestId('button-real-route-1')).toHaveAttribute('aria-pressed', 'true');
  expect(calls()).toBe(1);
  await page.getByTestId('button-check-in').click();
  await expect(page.getByTestId('status-live-ride')).toBeVisible();
  await page.getByTestId('link-nav-bilet').click();
  await expect(page.getByTestId('active-ride')).toContainText('Tramwaj');
  await page.getByTestId('button-check-out').click();
  await expect(page.getByTestId('ride-receipt')).toBeVisible();
  await info.attach('compact-ride-receipt', { body: await page.screenshot(), contentType: 'image/png' });
  expect(calls()).toBe(1);
});

test('history survives reload, can be reselected and removed without a search call', async ({ page }) => {
  await open(page);
  await choose(page);
  await expect.poll(() => history(page)).toEqual([{ name: address, lat: 50.0541, lng: 19.9352 }]);
  await page.reload();
  await expect(page.getByTestId('text-selected-destination')).toHaveCount(0);
  await page.getByTestId('input-search-destination').click();
  await page.route('**/api/geocoding/search', r => r.abort());
  await page.getByTestId('button-recent-destination-0').click();
  await expect(page.getByTestId('text-selected-destination')).toContainText(address);
  await page.getByTestId('input-search-destination').click();
  await page.getByTestId('button-remove-recent-destination-0').click();
  await expect.poll(() => history(page)).toEqual([]);
  await expect(page.getByTestId('text-selected-destination')).toContainText(address);
  await page.reload();
  await page.getByTestId('input-search-destination').click();
  await expect(page.getByTestId('section-recent-destinations')).toHaveCount(0);
});

test('denied GPS never requests a substitute route; address failure never blocks real GPS', async ({ page }) => {
  const calls = await open(page, true);
  await choose(page);
  await expect(page.getByTestId('status-transit-needs-location')).toBeVisible();
  expect(calls()).toBe(0);
});

test('reverse failure falls back to genuine coordinates while transport still plans', async ({ page }) => {
  const calls = await open(page);
  await page.route('**/api/geocoding/reverse', r => r.fulfill({ status: 429, json: { error: 'Capacity exhausted' } }));
  await choose(page);
  await expect(page.getByTestId('list-real-routes')).toBeVisible();
  await expect(page.getByTestId('text-location-source')).toContainText('Twoja lokalizacja');
  await expect(page.getByTestId('text-location-source')).not.toContainText('50.06160');
  expect(calls()).toBe(1);
});