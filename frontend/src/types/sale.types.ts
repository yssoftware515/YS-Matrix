// ============================================================
// YS-MATRIX ERP — Sales Types (Phase 3 Stage 1, V2)
//
// CORRECTED vs original sale.types.ts: field names now match what
// sales.service.js actually creates/returns on the `sale` Prisma model,
// not an assumed shape. Specifically:
//   - `total_price` did not exist on the real model → renamed to `total`
//   - `remaining_amount` did not exist anywhere in sales.service.js →
//     removed. The closest real equivalent is computed client-side from
//     `installment_summary` (see getRemainingAmount() below), since the
//     backend doesn't pre-compute a single remaining-amount number.
//   - added subtotal/discount/profit/sale_type/down_payment/
//     monthly_amount/installment_months/next_due_date — all real fields
//     on the model that the original types file omitted entirely.
// ============================================================

export type SaleType   = 'CASH' | 'INSTALLMENT';
// Matrix Audit (Phase 2): OVERDUE existed in the backend's SaleStatus
// enum (schema.prisma) since the original schema design, but was
// missing here entirely — meaning even once the backend started
// actually SETTING this status (see sales.service.js / notification.
// service.js), TypeScript would have silently allowed it to slip
// through as an unrecognized string everywhere this type is used.
export type SaleStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'OVERDUE';

export interface Installment {
  id:          string;
  sale_id:     string;
  amount:      number;
  due_date:    string;
  paid_at:     string | null;
  is_paid:     boolean;
  note:        string | null;
  // FIX: was missing entirely. sales.service.js's getOverdueInstallments
  // and getUpcomingInstallments both `include: { sale: {...} } }`,
  // enriching each row with a trimmed sale relation — confirmed against
  // the real include/select clauses. Optional because the base
  // Installment row (e.g. inside Sale.installments[]) never has it.
  // monthly_amount is only present on the getUpcomingInstallments
  // variant specifically (confirmed — getOverdueInstallments' select
  // omits it), hence optional here too.
  sale?: {
    id:             string;
    invoice_number: string;
    monthly_amount?: number;
    customer?: { name: string; phone: string | null } | null;
  };
}

export interface InstallmentSummary {
  total:   number;
  paid:    number;
  pending: number;
  overdue: number;
}

export interface SaleItem {
  id:             string;
  inventory_id:   string;
  quantity:       number;
  unit_price:     number;
  cost_price:     number;
  total_price:    number;
  profit:         number;
  chassis_number: string | null;
  engine_number:  string | null;
  color:          string | null;
  vehicle_model:  string;
  inventory?: {
    id:            string;
    brand:         string;
    model:         string;
    vehicle_type:  string;
    color:         string | null;
  };
}

export interface Sale {
  id:                  string;
  invoice_number:      string;
  sale_type:           SaleType;
  status:              SaleStatus;
  subtotal:            number;
  discount:            number;
  total:               number;
  profit:              number;
  notes:               string | null;
  sold_at:             string;
  created_at:          string;
  // Installment-only fields — present (non-null) only when sale_type === 'INSTALLMENT'
  down_payment:        number | null;
  monthly_amount:      number | null;
  installment_months:  number | null;
  next_due_date:       string | null;
  customer?: {
    id:    string;
    name:  string;
    phone: string | null;
  } | null;
  items?: SaleItem[];
  installments?: Installment[];
  installment_summary?: InstallmentSummary; // present on getSale (single), not on listSales rows
  _count?: { installments: number };         // present on listSales rows instead
  // Phase C.4 (FIN-1): server-computed remaining installment balance
  // (sum of unpaid installment amounts, exact decimal math done by the
  // database) — present on listSales rows. 0 for CASH sales and
  // fully-paid sales. When present it is authoritative; the
  // getRemainingInstallmentAmount() helper below remains only as a
  // client-side fallback for shapes that never carry the field.
  remaining_amount?: number;
}

export interface CreateSaleItemPayload {
  inventory_id: string;
  quantity?:    number;
  unit_price?:  number;
}

export interface CreateSalePayload {
  customer_id?:          string;
  sale_type:             SaleType;
  items:                 CreateSaleItemPayload[];
  discount?:              number;
  notes?:                 string;
  // Required when sale_type === 'INSTALLMENT' (enforced server-side too)
  down_payment?:          number;
  monthly_amount?:        number;
  installment_months?:    number;
  first_due_date?:        string;
}

export interface SalesSummary {
  period:         string;
  total_sales:    number;
  total_revenue:  number;
  total_profit:   number;
  total_discount: number;
  avg_sale:       number;
  by_type:        { sale_type: SaleType; _count: number; _sum: { total: number | null; profit: number | null } }[];
  by_status:      { status: SaleStatus; _count: number }[];
}

// ── Derived helper — fallback only ─────────────────────────────────
// Phase C.4 (FIN-1): listSales rows now carry `remaining_amount`,
// computed server-side by the database (authoritative). This helper
// remains for shapes that never include the field (e.g. a Sale object
// built from getSale or local state): it sums the unpaid installment
// amounts client-side, and returns 0 for CASH sales (no installments).
export function getRemainingInstallmentAmount(sale: Sale): number {
  if (sale.sale_type !== 'INSTALLMENT' || !sale.installments) return 0;
  return sale.installments
    .filter((i) => !i.is_paid)
    .reduce((sum, i) => sum + i.amount, 0);
}

export const SALE_STATUS_CONFIG: Record<SaleStatus, { label: string; colorClass: string; badgeClass: string }> = {
  ACTIVE:    { label: 'نشطة',    colorClass: 'text-matrix-cyan',  badgeClass: 'badge-cyan'  },
  COMPLETED: { label: 'مكتملة',  colorClass: 'text-matrix-green', badgeClass: 'badge-green' },
  CANCELLED: { label: 'ملغية',   colorClass: 'text-matrix-red',   badgeClass: 'badge-red'   },
  OVERDUE:   { label: 'متأخرة',  colorClass: 'text-matrix-red',   badgeClass: 'badge-red'   },
};

export const PAYMENT_TYPE_CONFIG: Record<SaleType, { label: string; icon: string }> = {
  CASH:        { label: 'نقداً', icon: '💵' },
  INSTALLMENT: { label: 'أقساط', icon: '📅' },
};
