// Boot + auth-gate regression tests. Runs against a mocked PocketBase, so it
// never touches live training data.
//
// Case (b) is the 2026-07-07 Vessel regression: an expired token used to fail
// silently (empty lists, 400 on save, no login prompt). restoreSession() must
// see the 401 from auth-refresh and fall back to the login screen.
//
//   npx playwright test
import { test, expect } from '@playwright/test';

const PB = 'https://pb.aetheriumforge.cloud';

/** Intercept every PocketBase call. `authRefresh` decides the token's fate. */
async function mockPB(page, { authRefresh = 200 } = {}) {
  await page.route(`${PB}/**`, async (route) => {
    const url = route.request().url();

    if (url.includes('/auth-refresh')) {
      if (authRefresh !== 200) {
        return route.fulfill({ status: authRefresh, contentType: 'application/json',
          body: JSON.stringify({ message: 'The request requires valid record authorization token.' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ token: 'fresh-token', record: { id: 'u1' } }) });
    }

    if (url.includes('/auth-with-password')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ token: 'fresh-token', record: { id: 'u1' } }) });
    }

    // Any records list: empty page.
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }) });
  });
}

/** Fail the test on any uncaught page error or console error. */
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('no token shows the login screen', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);
  await page.goto('/');

  await expect(page.locator('#auth-screen')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  expect(errors).toEqual([]);
});

test('expired token falls back to the login screen (2026-07-07 regression)', async ({ page }) => {
  await mockPB(page, { authRefresh: 401 });
  const errors = trackErrors(page);

  await page.addInitScript(() => localStorage.setItem('anvil_token', 'stale-token'));
  await page.goto('/');

  await expect(page.locator('#auth-screen')).toBeVisible();
  // The dead token must be cleared, or the next boot repeats the failure.
  expect(await page.evaluate(() => localStorage.getItem('anvil_token'))).toBeNull();
  // The 401 itself is the point of this test; Chrome logs it either way.
  expect(errors.filter(e => !e.includes('401'))).toEqual([]);
});

test('good token boots straight into the app', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);

  await page.addInitScript(() => localStorage.setItem('anvil_token', 'good-token'));
  await page.goto('/');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#auth-screen')).toBeHidden();
  await expect(page.locator('.view-title')).toHaveText('Anvil');
  expect(errors).toEqual([]);
});

test('logging in reveals the app', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);
  await page.goto('/');

  await page.fill('#login-email', 'svendoldenburg@gmail.com');
  await page.fill('#login-password', 'hunter2');
  await page.click('#login-btn');

  await expect(page.locator('#app')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?preview bypasses auth', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);
  await page.goto('/?preview');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#auth-screen')).toBeHidden();
  expect(errors).toEqual([]);
});

test('all eight nav destinations render', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);
  await page.goto('/?preview');

  const hashes = ['#home', '#workout', '#rower', '#kettlebell',
                  '#body', '#barbell', '#dumbbell', '#history'];
  for (const hash of hashes) {
    await page.goto(`/?preview${hash}`);
    await expect(page.locator('#view .view')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('sign out returns to the login screen and clears the token', async ({ page }) => {
  await mockPB(page);
  const errors = trackErrors(page);

  await page.addInitScript(() => localStorage.setItem('anvil_token', 'good-token'));
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  await page.click('#signOut');
  await expect(page.locator('#auth-screen')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('anvil_token'))).toBeNull();
  expect(errors).toEqual([]);
});

test('manifest is valid and declares the installability icons', async ({ page }) => {
  await page.goto('/?preview');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').getAttribute('href');
    return (await fetch(href)).json();
  });

  expect(manifest.name).toBe('Anvil');
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('./');
  const sizes = manifest.icons.map(i => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);

  // Every declared icon must actually resolve, or Chrome drops installability.
  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.status(), `${icon.src} should exist`).toBe(200);
  }
});
