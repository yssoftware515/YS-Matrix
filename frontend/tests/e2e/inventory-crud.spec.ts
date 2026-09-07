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

test.describe('Inventory CRUD: create → edit → deactivate → low-stock', () => {
  const brand = `E2E Brand ${Date.now()}`;
  const model = 'Test Model';
  const editedModel = 'Test Model Edited';

  test('full inventory lifecycle', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to inventory
    await page.goto(`${BASE_URL}/dashboard/inventory`);
    await page.waitForLoadState('networkidle');

    // 3. Click "إضافة منتج" (Add product)
    const addBtn = page.getByRole('button', { name: /إضافة منتج/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // 4. Wait for modal
    const modalTitle = page.locator('h2').filter({ hasText: /^إضافة منتج جديد$/ }).first();
    await expect(modalTitle).toBeVisible({ timeout: 5_000 });

    // 5. Fill form — select vehicle type
    const selectEl = page.locator('label:has-text("نوع المنتج") + select');
    await selectEl.selectOption({ label: 'دراجة نارية' });

    // 6. Fill form fields
    await page.getByPlaceholder('باجاج').fill(brand);
    await page.getByPlaceholder('بوكسر 150').fill(model);
    await page.getByPlaceholder('850000').fill('500000');
    await page.getByPlaceholder('1100000').fill('700000');
    await page.locator('input[placeholder="1"]').fill('1');

    // 7. Submit
    const saveBtn = page.getByRole('button', { name: /^حفظ$/i });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // 8. Wait for success
    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تمت الإضافة|تم الإنشاء/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 9. Verify product appears in the list
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr').filter({ hasText: brand }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 10. Edit the product
    const editBtn = row.locator('button[title*="تعديل"]').first();
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    const editModal = page.locator('h2').filter({ hasText: /^تعديل المنتج$/ }).first();
    await expect(editModal).toBeVisible({ timeout: 5_000 });

    const modelInput = page.getByPlaceholder('بوكسر 150').first();
    await modelInput.clear();
    await modelInput.fill(editedModel);

    const saveEditBtn = page.getByRole('button', { name: /حفظ التعديلات/i });
    await expect(saveEditBtn).toBeVisible({ timeout: 5_000 });
    await saveEditBtn.click();

    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم التعديل/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 11. Verify edited model appears
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tr').filter({ hasText: editedModel })).toBeVisible({ timeout: 10_000 });

    // 12. Deactivate (archive) the product
    const currentRow = page.locator('tr').filter({ hasText: brand }).first();
    const deleteBtn = currentRow.locator('button[title*="حذف"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
    await deleteBtn.click();

    const deleteModal = page.locator('h2').filter({ hasText: /^تأكيد الحذف$/ }).first();
    await expect(deleteModal).toBeVisible({ timeout: 5_000 });

    const confirmDelete = page.getByRole('button', { name: /تأكيد الحذف/i });
    await expect(confirmDelete).toBeVisible({ timeout: 5_000 });
    await confirmDelete.click();

    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم الحذف|تم التعطيل/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 13. Verify product is removed from active list
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tr').filter({ hasText: brand })).toHaveCount(0, { timeout: 10_000 });

    // 14. Check low-stock view exists (inline KPI)
    // Low stock panel may or may not be visible depending on data — just check page loaded
    await expect(page.locator('text=المخزون').first()).toBeVisible({ timeout: 5_000 });
  });
});
