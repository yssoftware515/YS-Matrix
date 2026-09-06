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

test.describe('Invoice view: navigate → verify fields → print button', () => {
  test('views an existing invoice and verifies key fields', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to sales to find an invoice
    await page.goto(`${BASE_URL}/dashboard/sales`);
    await page.waitForLoadState('networkidle');

    // 3. Find first invoice link in the table
    const invoiceLink = page.locator('table tbody tr td span').filter({ hasText: /^INV-/ }).first();
    const hasInvoice = await invoiceLink.isVisible().catch(() => false);

    if (!hasInvoice) {
      // No invoices exist yet — create one first via the sale flow
      const newSaleBtn = page.getByRole('button', { name: /بيع جديد/i });
      await expect(newSaleBtn).toBeVisible({ timeout: 10_000 });
      await newSaleBtn.click();

      const modalHeading = page.locator('span').filter({ hasText: /^بيع جديد$/ }).first();
      await expect(modalHeading).toBeVisible({ timeout: 5_000 });

      const itemSearch = page.getByPlaceholder('ابحث عن سيارة أو منتج');
      await itemSearch.fill('باجاج');
      await page.waitForTimeout(2_000);

      const firstItem = page.locator('.matrix-panel button').filter({
        hasText: /باجاج|هوندا|mot|car|باج/i,
      }).first();
      await expect(firstItem).toBeVisible({ timeout: 10_000 });
      await firstItem.click();

      const cashBtn = page.locator('button').filter({ hasText: /نقداً/ }).first();
      await expect(cashBtn).toBeVisible({ timeout: 5_000 });
      await cashBtn.click();

      const submitBtn = page.getByRole('button', { name: /تأكيد البيع/i });
      await submitBtn.click();

      await expect(
        page.locator('.toast, [role="status"]').filter({ hasText: /تم إنشاء عملية البيع/ }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Navigate back to sales
      await page.goto(`${BASE_URL}/dashboard/sales`);
      await page.waitForLoadState('networkidle');
    }

    // 4. Click the first invoice to view details
    const invoiceNum = page.locator('table tbody tr td span').filter({ hasText: /^INV-/ }).first();
    await expect(invoiceNum).toBeVisible({ timeout: 10_000 });
    const invoiceText = await invoiceNum.textContent();
    await invoiceNum.click();

    // 5. Verify we're on the invoice detail page
    await page.waitForURL(/\/dashboard\/invoices\//, { timeout: 10_000 });

    // 6. Verify key invoice fields are displayed
    // Invoice number
    await expect(page.locator('text=بيانات الفاتورة').first()).toBeVisible({ timeout: 10_000 });

    // Customer section
    await expect(page.locator('text=بيانات العميل').first()).toBeVisible({ timeout: 5_000 });

    // Products table
    await expect(page.locator('text=المنتجات').first()).toBeVisible({ timeout: 5_000 });

    // Totals — look for الإجمالي
    await expect(page.locator('text=الإجمالي').first()).toBeVisible({ timeout: 5_000 });

    // Verify the invoice number appears on the page
    await expect(page.locator(`text=${invoiceText}`).first()).toBeVisible({ timeout: 5_000 });

    // 7. Verify print button exists
    const printBtn = page.getByRole('button', { name: /طباعة|print/i });
    await expect(printBtn).toBeVisible({ timeout: 5_000 });

    // 8. Verify back button exists
    const backBtn = page.getByRole('link', { name: /رجوع/i }).first();
    const hasBackBtn = await backBtn.isVisible().catch(() => false);
    expect(hasBackBtn, 'Back button should be visible').toBe(true);
  });
});
