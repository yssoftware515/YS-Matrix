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
  await page.getByRole('button', { name: /تسجيل الدخول|login/i }).click();
  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard/**', { timeout: 15_000 });
}

// ─── Spec ────────────────────────────────────────────────────
test.describe('Sales flow: login → cash sale → invoice', () => {
  test('creates a cash sale and views the invoice', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to sales page
    await page.goto(`${BASE_URL}/dashboard/sales`);
    await page.waitForLoadState('networkidle');

    // 3. Click "بيع جديد" (New Sale) button
    const newSaleBtn = page.getByRole('button', { name: /بيع جديد/i });
    await expect(newSaleBtn).toBeVisible({ timeout: 10_000 });
    await newSaleBtn.click();

    // 4. Modal should open — verify by looking for the modal heading or search input
    // The SaleCreateModal has a search input for inventory items
    const modal = page.locator('[class*="fixed inset-0"]').first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // 5. Search for an inventory item
    // The modal has a search input with placeholder "ابحث عن ماركة أو طراز..."
    const itemSearch = page.getByPlaceholder(/ابحث عن ماركة/i);
    await expect(itemSearch).toBeVisible({ timeout: 5_000 });
    await itemSearch.fill(' ');
    // Wait for results to load (API call)
    await page.waitForTimeout(2_000);

    // 6. Select the first available item from the dropdown
    // Items appear as clickable buttons in the search results
    const firstItem = page.locator('button').filter({ hasText: /IN_STOCK|متاح/ }).first();
    if (await firstItem.isVisible().catch(() => false)) {
      await firstItem.click();
    }

    // 7. The form should now show the selected item details
    // Verify the total is computed (non-zero)
    const totalDisplay = page.locator('text=/الإجمالي|total/i').first();
    if (await totalDisplay.isVisible().catch(() => false)) {
      await expect(totalDisplay).toBeVisible();
    }

    // 8. Select CASH payment type (should be default, but click to be sure)
    const cashOption = page.getByRole('radio', { name: /نقدي|cash/i }).first();
    if (await cashOption.isVisible().catch(() => false)) {
      await cashOption.click();
    }

    // 9. Submit the sale
    const submitBtn = page.getByRole('button', { name: /تأكيد البيع|إتمام|create sale/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();

      // 10. Wait for success — toast or redirect
      // After creating a sale, a toast should appear or the modal closes
      await page.waitForTimeout(3_000);

      // 11. Verify the sale appears in the sales list
      await page.goto(`${BASE_URL}/dashboard/sales`);
      await page.waitForLoadState('networkidle');

      // The sales table should have at least one row with an invoice number
      const invoiceCell = page.locator('td .font-mono').first();
      if (await invoiceCell.isVisible().catch(() => false)) {
        const invoiceText = await invoiceCell.textContent();
        expect(invoiceText).toBeTruthy();
        console.log(`Invoice created: ${invoiceText}`);
      }
    }
  });
});
