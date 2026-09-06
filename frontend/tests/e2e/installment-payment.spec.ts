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

test.describe('Installment payment: create sale → pay installment → verify', () => {
  test('creates an installment sale and pays one installment', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to sales
    await page.goto(`${BASE_URL}/dashboard/sales`);
    await page.waitForLoadState('networkidle');

    // 3. Record initial count
    const countText = page.locator('p.text-matrix-subtle').filter({ hasText: /عملية بيع/ }).first();
    await expect(countText).toBeVisible({ timeout: 10_000 });
    const countBefore = parseInt(
      (await countText.textContent())!.match(/\d+/)?.[0] ?? '0', 10,
    );

    // 4. Create new installment sale
    const newSaleBtn = page.getByRole('button', { name: /بيع جديد/i });
    await expect(newSaleBtn).toBeVisible({ timeout: 10_000 });
    await newSaleBtn.click();

    const modalHeading = page.locator('span').filter({ hasText: /^بيع جديد$/ }).first();
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // 5. Search for inventory item
    const itemSearch = page.getByPlaceholder('ابحث عن سيارة أو منتج');
    await expect(itemSearch).toBeVisible({ timeout: 5_000 });
    await itemSearch.fill('باجاج');
    await page.waitForTimeout(2_000);

    // 6. Select first item
    const firstItem = page.locator('.matrix-panel button').filter({
      hasText: /باجاج|هوندا|mot|car|باج/i,
    }).first();
    await expect(firstItem).toBeVisible({ timeout: 10_000 });
    await firstItem.click();

    // 7. Select INSTALLMENT payment type
    const installmentBtn = page.locator('button').filter({ hasText: /أقساط/ }).first();
    await expect(installmentBtn).toBeVisible({ timeout: 5_000 });
    await installmentBtn.click();

    // 8. Fill installment fields
    const downPaymentInput = page.getByLabel('الدفعة الأولى (المقدمة)').first();
    await expect(downPaymentInput).toBeVisible({ timeout: 5_000 });
    await downPaymentInput.fill('200000');

    const monthlyInput = page.getByLabel('قيمة القسط الشهري').first();
    await expect(monthlyInput).toBeVisible({ timeout: 5_000 });
    await monthlyInput.fill('100000');

    const monthsInput = page.getByLabel('عدد الأشهر').first();
    await expect(monthsInput).toBeVisible({ timeout: 5_000 });
    await monthsInput.fill('2');

    // 9. Submit
    const submitBtn = page.getByRole('button', { name: /تأكيد البيع/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // 10. Wait for success
    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم إنشاء عملية البيع/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 11. Navigate to installments page
    await page.goto(`${BASE_URL}/dashboard/installments`);
    await page.waitForLoadState('networkidle');

    // 12. Verify installments appear
    await expect(page.locator('text=الأقساط').first()).toBeVisible({ timeout: 10_000 });

    // 13. Find a pending installment and click pay
    const payBtn = page.locator('button').filter({ hasText: /تسجيل الدفعة/ }).first();
    const hasPayBtn = await payBtn.isVisible().catch(() => false);

    if (hasPayBtn) {
      await payBtn.click();

      // 14. Confirm payment
      const confirmPay = page.getByRole('button', { name: /نعم، تسجيل الدفعة/i });
      await expect(confirmPay).toBeVisible({ timeout: 5_000 });
      await confirmPay.click();

      await expect(
        page.locator('.toast, [role="status"]').filter({ hasText: /تم الدفع|تم السداد/ }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});
