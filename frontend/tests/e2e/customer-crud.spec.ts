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

test.describe('Customer CRUD: create → edit → deactivate → reactivate', () => {
  const customerName = `E2E Customer ${Date.now()}`;
  const editedName = `${customerName} (edited)`;
  const customerPhone = '+967700000001';

  test('full customer lifecycle', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Login
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to customers
    await page.goto(`${BASE_URL}/dashboard/customers`);
    await page.waitForLoadState('networkidle');

    // 3. Click "إضافة عميل" (Add customer)
    const addBtn = page.getByRole('button', { name: /إضافة عميل/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // 4. Wait for modal
    const modalTitle = page.locator('span').filter({ hasText: /^إضافة عميل جديد$/ }).first();
    await expect(modalTitle).toBeVisible({ timeout: 5_000 });

    // 5. Fill form
    await page.getByPlaceholder('اسم العميل').fill(customerName);
    await page.getByPlaceholder('رقم الهاتف').fill(customerPhone);

    // 6. Submit
    const saveBtn = page.getByRole('button', { name: /حفظ$/i });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // 7. Wait for success
    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تمت الإضافة|تم الإنشاء/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 8. Verify customer appears in the list
    await page.waitForLoadState('networkidle');
    const row = page.locator('tr').filter({ hasText: customerName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 9. Edit the customer
    const editBtn = row.getByRole('button').filter({ hasText: /تعديل/ }).first();
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    const editModal = page.locator('span').filter({ hasText: /^تعديل بيانات العميل$/ }).first();
    await expect(editModal).toBeVisible({ timeout: 5_000 });

    const nameInput = page.locator('input').filter({ hasText: customerName }).first();
    await nameInput.clear();
    await nameInput.fill(editedName);

    const saveEditBtn = page.getByRole('button', { name: /حفظ التعديلات/i });
    await expect(saveEditBtn).toBeVisible({ timeout: 5_000 });
    await saveEditBtn.click();

    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم التعديل/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 10. Verify edited name appears
    await page.waitForLoadState('networkidle');
    const editedRow = page.locator('tr').filter({ hasText: editedName }).first();
    await expect(editedRow).toBeVisible({ timeout: 10_000 });

    // 11. Deactivate the customer
    const deactivateBtn = editedRow.locator('button[title*="تعطيل"]').first();
    await expect(deactivateBtn).toBeVisible({ timeout: 5_000 });
    await deactivateBtn.click();

    const deactivateModal = page.locator('span').filter({ hasText: /^تعطيل العميل$/ }).first();
    await expect(deactivateModal).toBeVisible({ timeout: 5_000 });

    const confirmDeactivate = page.getByRole('button', { name: /نعم، تعطيل العميل/i });
    await expect(confirmDeactivate).toBeVisible({ timeout: 5_000 });
    await confirmDeactivate.click();

    await expect(
      page.locator('.toast, [role="status"]').filter({ hasText: /تم التعطيل|تم الحذف/ }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 12. Verify customer is no longer in the active list
    await page.waitForLoadState('networkidle');
    await expect(page.locator('tr').filter({ hasText: editedName })).toHaveCount(0, { timeout: 10_000 });
  });
});
