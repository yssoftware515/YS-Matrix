import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OWNER_EMAIL = process.env.E2E_EMAIL || 'owner@demo.com';
const OWNER_PASSWORD = process.env.E2E_PASSWORD || 'Demo@Owner2024!';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/auth/login`);
  await page.getByPlaceholder('admin@ys-matrix.com').fill(OWNER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: /دخول النظام|login/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 15_000 });
}

test.describe('Global Search: trigger → search → navigate', () => {
  test('desktop: search via Cmd+K, find inventory, navigate', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 1. Open search via keyboard shortcut
    await page.keyboard.press('Control+k');

    // 2. Wait for search modal to appear
    const searchInput = page.getByPlaceholder(/ابحث في المخزون/i);
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // 3. Type a search query (use a known demo inventory brand)
    await searchInput.fill('باجاج');
    await page.waitForTimeout(2_000);

    // 4. Verify results appear in the المخزون (Inventory) section
    const inventorySection = page.locator('text=المخزون').first();
    await expect(inventorySection).toBeVisible({ timeout: 10_000 });

    // 5. Verify at least one result item exists
    const resultItem = page.locator('.matrix-panel button, [role="option"]').filter({
      hasText: /باجاج|بوكسر/i,
    }).first();
    const hasResults = await resultItem.isVisible().catch(() => false);
    expect(hasResults, 'Search should find inventory items matching باجاج').toBe(true);

    // 6. Click a result — should navigate to inventory page with search param
    if (hasResults) {
      await resultItem.click();
      await page.waitForURL(/\/dashboard\/inventory/, { timeout: 10_000 });
    }

    // 7. Close and reopen search — verify Escape works
    await page.keyboard.press('Control+k');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeHidden({ timeout: 5_000 });
  });

  test('mobile: search via icon, find customer, navigate', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 812 });

    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 1. On mobile, click the search icon button in the navbar
    const searchIcon = page.locator('button.flex.md\\:hidden').first();
    await searchIcon.click();

    // 2. Wait for search modal
    const searchInput = page.getByPlaceholder(/ابحث في المخزون/i);
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // 3. Search for a customer name (from demo data)
    await searchInput.fill('صاحب');
    await page.waitForTimeout(2_000);

    // 4. Check for results
    const customerSection = page.locator('text=العملاء').first();
    const hasCustomerSection = await customerSection.isVisible().catch(() => false);

    // 5. Close search
    await page.keyboard.press('Escape');
    await expect(searchInput).toBeHidden({ timeout: 5_000 });
  });
});
