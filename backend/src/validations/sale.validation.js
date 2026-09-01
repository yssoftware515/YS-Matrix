// ============================================================
// YS-MATRIX ERP - Sale Validation Schemas
// Author: Yahya Al-Sulami 🦅
// v1.1 — Includes immutable invoice snapshot fields
// ============================================================

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────

// Positive decimal — accepts string or number, coerces to number
const positiveDecimal = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .pipe(
      z.number({
        invalid_type_error: `${label} يجب أن يكون رقماً`,
      })
      .positive(`${label} يجب أن يكون أكبر من صفر`)
      .finite(`${label} قيمة غير صالحة`)
    );

const nonNegativeDecimal = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => parseFloat(String(v)))
    .pipe(
      z.number({
        invalid_type_error: `${label} يجب أن يكون رقماً`,
      })
      .min(0, `${label} لا يمكن أن يكون سالباً`)
      .finite(`${label} قيمة غير صالحة`)
    );

const positiveInt = (label) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => parseInt(String(v), 10))
    .pipe(
      z.number()
        .int(`${label} يجب أن يكون عدداً صحيحاً`)
        .positive(`${label} يجب أن يكون أكبر من صفر`)
    );

// ─────────────────────────────────────────────────────────────
// saleItemSchema
//
// Validates each line item in the sale.
// Includes v1.1 snapshot fields captured at purchase time.
// ─────────────────────────────────────────────────────────────
const saleItemSchema = z.object({
  // Live reference to inventory record
  inventory_id: z
    .string({ required_error: 'inventory_id مطلوب لكل منتج' })
    .cuid('inventory_id غير صالح'),

  quantity:   positiveInt('الكمية'),
  unit_price: positiveDecimal('سعر الوحدة'),

  // ── v1.1 Immutable Snapshot Fields ────────────────────────
  // Captured from inventory at sale creation time.
  // These values are written once and never change,
  // ensuring historic invoices always print correctly
  // even if the original inventory record is later
  // modified or deleted.
  chassis_number: z
    .string()
    .max(50, 'رقم الهيكل طويل جداً')
    .trim()
    .optional()
    .nullable(),

  engine_number: z
    .string()
    .max(50, 'رقم المحرك طويل جداً')
    .trim()
    .optional()
    .nullable(),

  color: z
    .string()
    .max(30, 'اللون طويل جداً')
    .trim()
    .optional()
    .nullable(),

  vehicle_model: z
    .string()
    .max(100, 'اسم الموديل طويل جداً')
    .trim()
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────────────────────
// installmentFieldsSchema
//
// Required when sale_type === 'INSTALLMENT'.
// Validated conditionally inside createSaleSchema via .refine()
// ─────────────────────────────────────────────────────────────
const installmentFieldsSchema = z.object({
  down_payment: positiveDecimal('الدفعة الأولى'),

  monthly_amount: positiveDecimal('القسط الشهري'),

  installment_months: positiveInt('عدد الأشهر').pipe(
    z.number().max(120, 'عدد الأشهر لا يمكن أن يتجاوز 120 شهراً')
  ),

  first_due_date: z
    .string({ required_error: 'تاريخ أول قسط مطلوب' })
    .datetime({ message: 'تاريخ أول قسط غير صالح — استخدم ISO 8601' })
    .refine(
      (d) => new Date(d) > new Date(),
      'تاريخ أول قسط يجب أن يكون في المستقبل'
    ),
});

// ─────────────────────────────────────────────────────────────
// createSaleSchema
// POST /api/v1/sales
// ─────────────────────────────────────────────────────────────
const createSaleSchema = z
  .object({
    customer_id: z
      .string()
      .cuid('customer_id غير صالح')
      .optional()
      .nullable(),

    sale_type: z.enum(['CASH', 'INSTALLMENT'], {
      required_error: 'نوع البيع مطلوب',
      invalid_type_error: 'نوع البيع يجب أن يكون CASH أو INSTALLMENT',
    }),

    items: z
      .array(saleItemSchema, { required_error: 'قائمة المنتجات مطلوبة' })
      .min(1, 'يجب إضافة منتج واحد على الأقل')
      .max(50, 'لا يمكن إضافة أكثر من 50 منتجاً في فاتورة واحدة'),

    subtotal: positiveDecimal('المجموع الفرعي').optional(),

    discount: nonNegativeDecimal('الخصم').optional().default(0),

    total: positiveDecimal('الإجمالي').optional(),

    notes: z
      .string()
      .max(500, 'الملاحظات طويلة جداً')
      .trim()
      .optional()
      .nullable(),

    // Installment fields — optional at schema level,
    // conditionally required in .superRefine() below
    down_payment:       positiveDecimal('الدفعة الأولى').optional(),
    monthly_amount:     positiveDecimal('القسط الشهري').optional(),
    installment_months: positiveInt('عدد الأشهر').optional(),
    first_due_date: z
      .string()
      .datetime({ message: 'تاريخ أول قسط غير صالح — استخدم ISO 8601' })
      .optional(),
  })

  // ── Cross-field validation ──────────────────────────────
  .superRefine((data, ctx) => {

    // subtotal/total محسوبان في الباك اند — لا يحتاجان validation هنا

    // 3. Installment fields are required when sale_type === INSTALLMENT
    if (data.sale_type === 'INSTALLMENT') {
      const required = [
        ['down_payment',       'الدفعة الأولى'],
        ['monthly_amount',     'القسط الشهري'],
        ['installment_months', 'عدد الأشهر'],
        ['first_due_date',     'تاريخ أول قسط'],
      ];

      for (const [field, label] of required) {
        if (data[field] === undefined || data[field] === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${label} مطلوب عند اختيار بيع التقسيط`,
          });
        }
      }

      // down_payment must be less than total
      if (
        data.down_payment !== undefined &&
        data.total !== undefined &&
        data.down_payment >= data.total
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['down_payment'],
          message: 'الدفعة الأولى يجب أن تكون أقل من الإجمالي',
        });
      }

      // Phase C.1 (1A) — installment arithmetic must reconcile with the
      // invoice total. The app itself never sends `total` (the service
      // computes it server-side), so this refine only guards API clients
      // that DO send one; the authoritative check for app traffic lives
      // in sales.service.js:createSale() right after the total is
      // computed. Integer "cents" math (hundredths of the currency
      // unit) keeps the comparison exact — no float drift. Tolerance:
      // ±0.01.
      if (
        data.total !== undefined &&
        data.down_payment !== undefined &&
        data.monthly_amount !== undefined &&
        data.installment_months !== undefined
      ) {
        const cents = (n) => Math.round(parseFloat(n) * 100);
        const collectible = cents(data.down_payment)
          + cents(data.monthly_amount) * parseInt(data.installment_months, 10);
        if (Math.abs(collectible - cents(data.total)) > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['monthly_amount'],
            message: 'مجموع الدفعة الأولى والأقساط يجب أن يساوي إجمالي الفاتورة',
          });
        }
      }

      // first_due_date must be in the future
      if (data.first_due_date && new Date(data.first_due_date) <= new Date()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['first_due_date'],
          message: 'تاريخ أول قسط يجب أن يكون في المستقبل',
        });
      }
    }

    // 4. Duplicate inventory_id check within items array
    const ids = data.items?.map((i) => i.inventory_id) ?? [];
    const seen = new Set();
    ids.forEach((id, idx) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', idx, 'inventory_id'],
          message: 'هذا المنتج مضاف مسبقاً في الفاتورة',
        });
      }
      seen.add(id);
    });
  });

// ─────────────────────────────────────────────────────────────
// payInstallmentSchema
// PATCH /api/v1/sales/installments/:id/pay
// ─────────────────────────────────────────────────────────────
const payInstallmentSchema = z.object({
  note: z
    .string()
    .max(300, 'الملاحظة طويلة جداً')
    .trim()
    .optional()
    .nullable(),
});

// ─────────────────────────────────────────────────────────────
// salesQuerySchema
// GET /api/v1/sales
// ─────────────────────────────────────────────────────────────
const salesQuerySchema = z.object({
  page:      z.coerce.number().int().positive().optional().default(1),
  limit:     z.coerce.number().int().min(1).max(100).optional().default(15),
  search:    z.string().trim().optional(),
  sale_type: z.enum(['CASH', 'INSTALLMENT']).optional().or(z.literal('')).transform(v => v || undefined),
  status:    z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'OVERDUE']).optional().or(z.literal('')).transform(v => v || undefined),
  range:     z.enum(['today', 'week', 'month', 'last_month', 'year', 'custom']).optional().or(z.literal('')).transform(v => v || undefined),
  date_from: z.string().datetime().optional(),
  date_to:   z.string().datetime().optional(),
});

module.exports = {
  createSaleSchema,
  payInstallmentSchema,
  salesQuerySchema,
  saleItemSchema,
};