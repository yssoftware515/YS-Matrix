import { test, expect } from '@playwright/test';

// ─── Config ──────────────────────────────────────────────────
const BASE_URL  = process.env.BASE_URL  || 'http://localhost:3000';
const API_URL   = process.env.API_URL   || 'http://localhost:5000/api/v1';
const OWNER_EMAIL    = process.env.E2E_EMAIL    || 'owner@demo.com';
const OWNER_PASSWORD = process.env.E2E_PASSWORD || 'Demo@Owner2024!';

// ─── Helpers ─────────────────────────────────────────────────
async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/auth/login`);
  await page.getByPlaceholder('admin@ys-matrix.com').fill(OWNER_EMAIL);
  await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: /دخول النظام|login/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 15_000 });
}

// ─── Spec ────────────────────────────────────────────────────
test.describe('Sales flow: login → cash sale → invoice', () => {
  test('creates a cash sale and verifies the new invoice', async ({ page }) => {
    test.setTimeout(90_000);

    // THROWAWAY: deliberately fail to verify CI catches regressions
    expect(false, 'Deliberate failure for CI verification').toBe(true);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to sales page
    await page.goto(`${BASE_URL}/dashboard/sales`);
    await page.waitForLoadState('networkidle');

    // 3. Capture the sales count BEFORE creating the sale.
    //    The count is rendered as "{pagination.total} عملية بيع"
    const countText = page.locator('p.text-matrix-subtle').filter({ hasText: /عملية بيع/ }).first();
    await expect(countText).toBeVisible({ timeout: 10_000 });
    const countBefore = parseInt(
      (await countText.textContent())!.match(/\d+/)?.[0] ?? '0',
      10,
    );

    // 4. Click "بيع جديد" (New Sale) button
    const newSaleBtn = page.getByRole('button', { name: /بيع جديد/i });
    await expect(newSaleBtn).toBeVisible({ timeout: 10_000 });
    await newSaleBtn.click();

    // 5. Modal opens — wait for the modal heading "بيع جديد" (span, not button)
    const modalHeading = page.locator('span').filter({ hasText: /^بيع جديد$/ }).first();
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // 6. Search for an inventory item
    //    Placeholder: "ابحث عن سيارة أو منتج..."
    const itemSearch = page.getByPlaceholder('ابحث عن سيارة أو منتج');
    await expect(itemSearch).toBeVisible({ timeout: 5_000 });
    await itemSearch.fill('باجاج');
    await page.waitForTimeout(2_000);

    // 7. Select the first available item from the dropdown results.
    //    Items appear as <button> elements inside a dropdown panel,
    //    containing brand + model text (e.g. "Toyota Camry").
    //    Hard assert: the result MUST appear — if nothing shows, the test
    //    fails here instead of silently skipping the rest of the flow.
    const firstItem = page.locator('.matrix-panel button').filter({ hasText: /باجاج|هوندا|باج|mot|car|toy|honda|nissan|suzuki|hyundai|kia|mg|chery|byd|fiat|seat|toyota|camry|corolla/i }).first();
    const noResult = page.locator('p').filter({ hasText: /^لا نتائج$/ });

    // Wait for either results or empty state
    await expect(async () => {
      const hasResults = await firstItem.count() > 0;
      const hasEmpty = await noResult.count() > 0;
      expect(hasResults || hasEmpty).toBeTruthy();
    }).toPass({ timeout: 10_000 });

    // If "لا نتائج" (no results) is showing, the seed data is empty — this
    // is a legitimate test failure (the DB needs seeding).
    const hasNoResults = await noResult.isVisible().catch(() => false);
    expect(hasNoResults, 'No inventory items found — ensure the test DB is seeded').toBe(false);

    // Click the first result button (hard: it MUST be visible)
    await expect(firstItem).toBeVisible({ timeout: 5_000 });
    await firstItem.click();

    // 8. The form should now show the selected item details.
    //    Verify the computed total is visible (label: "الإجمالي المحسوب")
    const totalLabel = page.locator('span').filter({ hasText: 'الإجمالي المحسوب' }).first();
    await expect(totalLabel).toBeVisible({ timeout: 5_000 });

    // 9. Select CASH payment type (button with text "💵 نقداً")
    const cashBtn = page.locator('button').filter({ hasText: /نقداً/ }).first();
    await expect(cashBtn).toBeVisible({ timeout: 5_000 });
    await cashBtn.click();

    // 10. Submit the sale — button with text "تأكيد البيع"
    const submitBtn = page.getByRole('button', { name: /تأكيد البيع/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // 11. Wait for success — toast "تم إنشاء عملية البيع بنجاح"
    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم إنشاء عملية البيع/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 12. Navigate back to sales list
    await page.goto(`${BASE_URL}/dashboard/sales`);
    await page.waitForLoadState('networkidle');

    // 13. Verify the sales count increased by exactly 1
    await expect(countText).toBeVisible({ timeout: 10_000 });
    const countAfter = parseInt(
      (await countText.textContent())!.match(/\d+/)?.[0] ?? '0',
      10,
    );
    expect(countAfter, 'Sales count should increase by 1 after creating a sale').toBe(countBefore + 1);

    // 14. Verify the newest invoice row is visible with INV- prefix
    //     Invoice number format: INV-{SHORT_CODE}-{YEAR}-{SEQUENCE}
    const newestInvoice = page.locator('table tbody tr').first().locator('td').first().locator('span');
    await expect(newestInvoice).toBeVisible({ timeout: 5_000 });
    const invoiceText = await newestInvoice.textContent();
    expect(invoiceText, 'New invoice must start with INV- prefix').toMatch(/^INV-/);
  });
});
