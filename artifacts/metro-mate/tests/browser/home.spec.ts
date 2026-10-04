import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Entry navigation must not load a paid map or request a real route.
  await page.route('**/api/maps/config', route => route.fulfill({
    status: 503, json: { error: 'Map disabled in entry navigation tests' },
  }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(_ok: unknown, fail: (e: unknown) => void) {
        fail({ code: 1, message: 'Denied' }); return 1;
      },
      clearWatch() {},
    } });
  });
});

test('home explains the product at phone and desktop widths without starting providers', async ({ page }) => {
  let providerRequests = 0;
  await page.route(/\/api\/(?:geocoding|transit)\//, route => {
    providerRequests++;
    return route.abort();
  });
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText(/GPS/);
  await expect(page.locator('main')).toContainText(/FairRide/);
  await expect(page.locator('main')).not.toContainText(/demo|testow|symul|prototyp/i);
  await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(providerRequests).toBe(0);
});

test('root opens view selection, then Go for a saved passenger; home stays public', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(?:login)?$/);
  await expect(page.getByTestId('button-login-user')).toBeVisible();
  await expect(page.getByTestId('button-login-conductor')).toBeVisible();
  await expect(page.getByTestId('button-login-admin')).toBeVisible();
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByTestId('button-login-user').click();
  await expect(page).toHaveURL(/\/user\/map$/);
  await expect(page.getByTestId('input-search-destination')).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/user\/map$/);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('a[href="/user/map"]').first().click();
  await expect(page.getByTestId('input-search-destination')).toBeVisible();
  await page.getByTestId('link-nav-profile').click();
  await page.getByTestId('button-sign-out').click();
  await page.goto('/');
  await expect(page).toHaveURL(/\/(?:login)?$/);
});