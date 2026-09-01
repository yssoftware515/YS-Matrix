'use client';
import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Package, Loader2, Pencil, Trash2, AlertTriangle, Upload, X, CheckCircle2, XCircle, Archive } from 'lucide-react';
import toast from 'react-hot-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DataTable, Column } from '@/components/ui/DataTable';
import { KpiCard } from '@/components/ui/KpiCard';
import { Modal } from '@/components/ui/Modal';
import { ListError } from '@/components/ui/ListError';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  inventoryApi, suppliersApi,
  isApiRequestError,
  type InventoryItem as ApiInventoryItem,
  type VehicleType,
  type Payload,
} from '@/lib/api';
import { formatCurrency, vehicleTypeLabel, vehicleTypeColor, stockStatusLabel, formatDate, cn } from '@/lib/utils';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';

// ─── Types ─────────────────────────────────────────────────────────────────────
// NOTE: extends the shared lib/api.ts InventoryItem with the two relation
// fields this page's list/stats responses include (supplier join, optional
// min_price). Keeping this local interface — rather than only using the
// shared one — because `supplier` here is a partial join shape specific to
// this list view, not the full Supplier entity.
interface InventoryItem extends Omit<ApiInventoryItem, 'supplier_id'> {
  supplier?: { id: string; name: string };
  supplier_id?: string;
  part_number?: string;
}

interface InventoryStatsShape {
  totals?: {
    total?: number;
    in_stock?: number;
    sold?: number;
    low_stock?: number;
  };
}

const BLANK_FORM = {
  vehicle_type: 'MOTORCYCLE', brand: '', model: '', year: '', color: '',
  engine_cc: '', part_number: '', cost_price: '', selling_price: '',
  min_price: '', quantity: '1', supplier_id: '',
  // Phase C.1 (2) — vehicle identity fields, captured at sale time into
  // the SaleItem snapshot and printed on invoices/receipts.
  chassis_number: '', engine_number: '',
};

const TYPES    = ['MOTORCYCLE', 'CAR', 'TUKTUK', 'TRICYCLE', 'SPARE_PART', 'OTHER'];
const STATUSES = ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED'];

const IS_VEHICLE = (t: string) => ['MOTORCYCLE', 'CAR', 'TUKTUK', 'TRICYCLE'].includes(t);
const IS_SPARE   = (t: string) => t === 'SPARE_PART';

const VEHICLE_FIELDS = [
  { k: 'brand',         l: 'الماركة *',         p: 'باجاج',     type: 'text',   required: true  },
  { k: 'model',         l: 'الموديل *',          p: 'بوكسر 150', type: 'text',   required: true  },
  { k: 'year',          l: 'سنة الصنع',          p: '2024',      type: 'number', required: false },
  { k: 'color',         l: 'اللون',              p: 'أحمر',      type: 'text',   required: false },
  { k: 'engine_cc',     l: 'سعة المحرك (cc)',    p: '150',       type: 'number', required: false },
  // Phase C.1 (2) — chassis/engine numbers are the vehicle's unique
  // physical identity; they flow into the SaleItem snapshot at sale
  // time and print on the invoice. Typed once here at intake, they
  // make every subsequent sale unambiguous about WHICH unit sold.
  { k: 'chassis_number', l: 'رقم الهيكل (الشاصي)', p: 'MD6A1A2A2L4100001', type: 'text', required: false },
  { k: 'engine_number',  l: 'رقم المحرك',          p: '3B25-0012345',      type: 'text', required: false },
  { k: 'quantity',      l: 'الكمية *',           p: '1',         type: 'number', required: true  },
  { k: 'cost_price',    l: 'سعر التكلفة *',     p: '850000',    type: 'number', required: true  },
  { k: 'selling_price', l: 'سعر البيع *',       p: '1100000',   type: 'number', required: true  },
  // Phase C.4 (INV-4): the min-price floor was enforced server-side
  // (sales.service.js rejects any unit_price below it) and editable
  // via the API, but the form never exposed the field — the floor
  // could be set only through the bulk import. Now typed here too.
  { k: 'min_price',     l: 'أقل سعر بيع مسموح', p: '1000000',   type: 'number', required: false, hint: 'اختياري — لا تُباع الوحدة بأقل منه' },
];

const SPARE_FIELDS = [
  { k: 'brand',         l: 'اسم القطعة *',        p: 'فلتر زيت',  type: 'text',   required: true  },
  { k: 'model',         l: 'يناسب موديل *',       p: 'بوكسر 150', type: 'text',   required: true  },
  { k: 'part_number',   l: 'رقم القطعة / الباركود', p: 'OIL-2024', type: 'text',  required: false },
  { k: 'quantity',      l: 'الكمية *',            p: '10',        type: 'number', required: true  },
  { k: 'cost_price',    l: 'سعر التكلفة *',      p: '15000',     type: 'number', required: true  },
  { k: 'selling_price', l: 'سعر البيع *',        p: '25000',     type: 'number', required: true  },
  { k: 'min_price',     l: 'أقل سعر بيع مسموح',  p: '20000',     type: 'number', required: false, hint: 'اختياري — لا تُباع القطعة بأقل منه' },
];

const OTHER_FIELDS = [
  { k: 'brand',         l: 'الاسم *',             p: 'خوذة',      type: 'text',   required: true  },
  { k: 'model',         l: 'الوصف',              p: 'مقاس L',    type: 'text',   required: false },
  { k: 'quantity',      l: 'الكمية *',            p: '5',         type: 'number', required: true  },
  { k: 'cost_price',    l: 'سعر التكلفة *',      p: '10000',     type: 'number', required: true  },
  { k: 'selling_price', l: 'سعر البيع *',        p: '18000',     type: 'number', required: true  },
  { k: 'min_price',     l: 'أقل سعر بيع مسموح',  p: '15000',     type: 'number', required: false, hint: 'اختياري — لا يُباع المنتج بأقل منه' },
];

// ─── Bulk Import — row shape + parsing ──────────────────────────────────────────
// Each bulk row is intentionally simpler than the full add/edit form: brand,
// model, vehicle_type, cost_price, selling_price, quantity, color are the
// fields realistically filled in a fast multi-row import (matching the
// POST /inventory/bulk example payload in API-STEP3.md). Extra per-item detail
// (engine_cc, chassis/engine numbers, supplier) can still be added later via
// the normal edit modal — bulk import optimizes for speed, not completeness.
interface BulkRow {
  vehicle_type: string;
  brand: string;
  model: string;
  color: string;
  cost_price: string;
  selling_price: string;
  quantity: string;
}

const BLANK_BULK_ROW: BulkRow = {
  vehicle_type: 'MOTORCYCLE', brand: '', model: '', color: '',
  cost_price: '', selling_price: '', quantity: '1',
};

interface BulkRowError {
  index: number;
  messages: string[];
}

function validateBulkRows(rows: BulkRow[]): BulkRowError[] {
  const errors: BulkRowError[] = [];
  rows.forEach((row, index) => {
    const messages: string[] = [];
    if (!row.brand.trim())  messages.push('الماركة مطلوبة');
    if (!row.model.trim())  messages.push('الموديل مطلوب');
    const cost = parseFloat(row.cost_price);
    const sell = parseFloat(row.selling_price);
    const qty  = parseInt(row.quantity, 10);
    if (!row.cost_price || isNaN(cost) || cost < 0)   messages.push('سعر التكلفة غير صالح');
    if (!row.selling_price || isNaN(sell) || sell < 0) messages.push('سعر البيع غير صالح');
    if (!row.quantity || isNaN(qty) || qty < 1)         messages.push('الكمية يجب أن تكون 1 أو أكثر');
    if (!isNaN(cost) && !isNaN(sell) && sell < cost) {
      messages.push('سعر البيع أقل من سعر التكلفة — تأكد من الأرقام');
    }
    if (messages.length > 0) errors.push({ index, messages });
  });
  return errors;
}

function bulkRowsToPayload(rows: BulkRow[]): Payload[] {
  return rows.map((row) => ({
    vehicle_type:   row.vehicle_type,
    brand:          row.brand.trim(),
    model:          row.model.trim(),
    color:          row.color.trim() || undefined,
    cost_price:     parseFloat(row.cost_price),
    selling_price:  parseFloat(row.selling_price),
    quantity:       parseInt(row.quantity, 10),
  }));
}

// Threshold used for the low-stock alert section's "critical" styling.
// Mirrors the same <= 2 logic already used for the quantity column badge
// further down, kept as one named constant so both stay in sync.
const LOW_STOCK_CRITICAL_THRESHOLD = 2;

// ─── Component ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const qc = useQueryClient();
  // Phase C.6 (P1): delete/archive is ownerOnly on the backend
  // (inventory.routes.js) — create/edit/bulk stay available to STAFF.
  // Same customers-page pattern; backend stays authoritative.
  const { user } = useAuthStore();
  const canManage = isOwnerPlus(user?.role);
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatus]   = useState('');

  // F6 — GlobalSearch deep-links land here as ?search= — prefill the
  // list search so the result row is on screen immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) setSearch(q);
  }, []);

  // ── Modal state ──────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]       = useState(false);
  const [editItem, setEditItem]     = useState<InventoryItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null);
  const [form, setForm]             = useState(BLANK_FORM);

  // ── Low-stock alert panel state ─────────────────────────────────────────────
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);

  // ── Bulk import state ────────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen]         = useState(false);
  const [bulkRows, setBulkRows]         = useState<BulkRow[]>([{ ...BLANK_BULK_ROW }]);
  const [bulkErrors, setBulkErrors]     = useState<BulkRowError[]>([]);
  const [bulkResult, setBulkResult]     = useState<{ created: number; failed: number } | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────
  // Phase C.1 (5B): the DataTable search box fires onSearch per
  // keystroke — the query now reads the debounced value so a full
  // request only goes out after typing settles.
  const debouncedSearch = useDebouncedValue(search);

  // V2 API SHAPE: inventoryApi.getAll now resolves directly to
  // { data: InventoryItem[], pagination } — no more r.data / r.data.data
  // chaining. The envelope unwrapping happens inside lib/api.ts itself.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory', { page, search: debouncedSearch, vehicle_type: typeFilter, status: statusFilter }],
    queryFn: () =>
      inventoryApi.getAll({ page, limit: 15, search: debouncedSearch, vehicle_type: typeFilter, status: statusFilter }),
  });

  const { data: stats } = useQuery({
    queryKey: ['inv-stats'],
    queryFn: () => inventoryApi.getStats(),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => suppliersApi.getAll({ limit: 100 }),
    select: (res) => res.data, // Paginated<Supplier> → Supplier[]
  });

  // GAP FIX #1 — Low-Stock Alerts.
  // inventoryApi.getLowStock() existed in lib/api.ts but was never called
  // anywhere on this page. Runs as its own query (not derived from the
  // paginated table data) because low stock must reflect the FULL
  // inventory regardless of which page/filter the table is currently on.
  const { data: lowStockItems, isLoading: lowStockLoading } = useQuery({
    queryKey: ['inv-low-stock'],
    queryFn: () => inventoryApi.getLowStock(),
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (payload: Payload) => inventoryApi.create(payload),
    onSuccess: () => {
      toast.success('تمت الإضافة بنجاح');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      setAddOpen(false);
      setForm(BLANK_FORM);
    },
    onError: (e: unknown) =>
      toast.error(isApiRequestError(e) ? e.message : 'فشل الإضافة'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Payload }) => inventoryApi.update(id, payload),
    onSuccess: () => {
      toast.success('تم التعديل بنجاح');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      setEditItem(null);
      setForm(BLANK_FORM);
    },
    onError: (e: unknown) =>
      toast.error(isApiRequestError(e) ? e.message : 'فشل التعديل'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => inventoryApi.remove(id),
    onSuccess: () => {
      toast.success('تم الحذف بنجاح');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      setDeleteItem(null);
    },
    onError: (e: unknown) =>
      toast.error(isApiRequestError(e) ? e.message : 'فشل الحذف'),
  });

  // GAP FIX #2 — Bulk Import.
  // inventoryApi.bulkCreate() existed in lib/api.ts but was never called.
  // IMPORTANT: bulkCreate can partially fail (e.g. row 3 of 10 has a
  // duplicate chassis_number). We don't assume all-or-nothing — the
  // result is read defensively and the user sees an explicit count of
  // what succeeded vs failed, not just a single generic toast.
  const bulkCreateMut = useMutation({
    mutationFn: (payload: Payload[]) => inventoryApi.bulkCreate({ items: payload }),
    onSuccess: (res) => {
      // Phase C.6 (P1): the backend bulk endpoint resolves to
      // { count } (see lib/api.ts bulkCreate typing) — the number of
      // rows actually created, not the rows themselves. Previously the
      // success path measured `created.length` off an array that never
      // exists, so every import reported "0 of N" even on full success.
      const createdCount = typeof res?.count === 'number' ? res.count : 0;
      const submittedCount = bulkRows.length;
      const failedCount = Math.max(0, submittedCount - createdCount);

      setBulkResult({ created: createdCount, failed: failedCount });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inv-stats'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });

      if (failedCount === 0) {
        toast.success(`تم استيراد ${createdCount} منتج بنجاح`);
      } else {
        toast.error(`تم استيراد ${createdCount} من ${submittedCount} — فشل ${failedCount}`);
      }
    },
    onError: (e: unknown) => {
      setBulkResult({ created: 0, failed: bulkRows.length });
      toast.error(isApiRequestError(e) ? e.message : 'فشل الاستيراد الجماعي');
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const openEdit = (item: InventoryItem) => {
    setForm({
      vehicle_type:   item.vehicle_type,
      brand:          item.brand,
      model:          item.model,
      year:           item.year?.toString() || '',
      color:          item.color || '',
      engine_cc:      item.engine_cc?.toString() || '',
      // Phase C.1 (2): part_number was always reset to '' on edit —
      // editing ANY item silently wiped its part number on save. Now
      // mapped from the row like every other field.
      part_number:    item.part_number || '',
      cost_price:     item.cost_price.toString(),
      selling_price:  item.selling_price.toString(),
      min_price:      item.min_price?.toString() || '',
      quantity:       item.quantity.toString(),
      supplier_id:    item.supplier?.id || '',
      chassis_number: item.chassis_number || '',
      engine_number:  item.engine_number || '',
    });
    setEditItem(item);
  };

  const handleSubmit = () => {
    if (createMut.isPending) return;
    if (!form.brand || !form.model || !form.cost_price || !form.selling_price) {
      toast.error('يرجى ملء الحقول المطلوبة');
      return;
    }
    // Phase C.4 (INV-4): the min-price floor must be a valid
    // non-negative number if provided — mirrors the backend's
    // parseOptionalPrice contract so the error surfaces here, in the
    // form, instead of a generic save failure.
    if (form.min_price && (isNaN(parseFloat(form.min_price)) || parseFloat(form.min_price) < 0)) {
      toast.error('أقل سعر بيع مسموح يجب أن يكون رقماً غير سالب');
      return;
    }
    createMut.mutate({
      ...form,
      year:          form.year       ? parseInt(form.year)        : undefined,
      engine_cc:     form.engine_cc  ? parseInt(form.engine_cc)   : undefined,
      part_number:   form.part_number || undefined,
      chassis_number: form.chassis_number.trim() || undefined,
      engine_number:  form.engine_number.trim()  || undefined,
      cost_price:    parseFloat(form.cost_price),
      selling_price: parseFloat(form.selling_price),
      min_price:     form.min_price  ? parseFloat(form.min_price) : undefined,
      quantity:      parseInt(form.quantity) || 1,
      supplier_id:   form.supplier_id || undefined,
    });
  };

  const handleUpdate = () => {
    if (updateMut.isPending || !editItem) return;
    if (!form.brand || !form.model || !form.cost_price || !form.selling_price) {
      toast.error('يرجى ملء الحقول المطلوبة');
      return;
    }
    if (form.min_price && (isNaN(parseFloat(form.min_price)) || parseFloat(form.min_price) < 0)) {
      toast.error('أقل سعر بيع مسموح يجب أن يكون رقماً غير سالب');
      return;
    }
    updateMut.mutate({
      id: editItem.id,
      payload: {
        ...form,
        year:          form.year       ? parseInt(form.year)        : undefined,
        engine_cc:     form.engine_cc  ? parseInt(form.engine_cc)   : undefined,
        part_number:   form.part_number || undefined,
        chassis_number: form.chassis_number.trim() || undefined,
        engine_number:  form.engine_number.trim()  || undefined,
        cost_price:    parseFloat(form.cost_price),
        selling_price: parseFloat(form.selling_price),
        min_price:     form.min_price  ? parseFloat(form.min_price) : undefined,
        quantity:      parseInt(form.quantity) || 1,
        supplier_id:   form.supplier_id || undefined,
      },
    });
  };

  const handleDelete = () => {
    if (deleteMut.isPending || !deleteItem) return;
    deleteMut.mutate(deleteItem.id);
  };

  // ── Bulk import helpers ──────────────────────────────────────────────────────
  const updateBulkRow = (index: number, patch: Partial<BulkRow>) => {
    setBulkRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addBulkRow = () => {
    if (bulkRows.length >= 100) {
      toast.error('الحد الأقصى 100 منتج لكل استيراد');
      return;
    }
    setBulkRows((rows) => [...rows, { ...BLANK_BULK_ROW }]);
  };

  const removeBulkRow = (index: number) => {
    setBulkRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  };

  const resetBulkState = () => {
    setBulkRows([{ ...BLANK_BULK_ROW }]);
    setBulkErrors([]);
    setBulkResult(null);
  };

  const handleBulkSubmit = () => {
    if (bulkCreateMut.isPending) return;

    const errors = validateBulkRows(bulkRows);
    setBulkErrors(errors);
    if (errors.length > 0) {
      toast.error(`يوجد ${errors.length} صف يحتوي على أخطاء — راجع الحقول المحددة`);
      return;
    }

    setBulkResult(null);
    bulkCreateMut.mutate(bulkRowsToPayload(bulkRows));
  };

  const rowHasError = (index: number) => bulkErrors.some((e) => e.index === index);
  const rowErrorMessages = (index: number) => bulkErrors.find((e) => e.index === index)?.messages || [];

  // ── Dynamic field set ─────────────────────────────────────────────────────────
  const activeFields = useMemo(() => {
    if (IS_SPARE(form.vehicle_type))   return SPARE_FIELDS;
    if (IS_VEHICLE(form.vehicle_type)) return VEHICLE_FIELDS;
    return OTHER_FIELDS;
  }, [form.vehicle_type]);

  // ── Form JSX (shared between add + edit) ─────────────────────────────────────
  const FormBody = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">
          نوع المنتج *
        </label>
        <select
          value={form.vehicle_type}
          onChange={(e) => setForm({ ...BLANK_FORM, vehicle_type: e.target.value })}
          className="matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/50"
        >
          {TYPES.map((t) => <option key={t} value={t}>{vehicleTypeLabel[t]}</option>)}
        </select>
      </div>

      {activeFields.map(({ k, l, p, type, hint }) => (
        <div key={k} className={k === 'part_number' ? 'col-span-2' : ''}>
          <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">{l}</label>
          <input
            type={type}
            value={(form as Record<string, string>)[k] ?? ''}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            placeholder={p}
            className="matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/40"
            dir="ltr"
          />
          {hint && (
            <p className="text-[10px] font-mono text-matrix-subtle mt-1">{hint}</p>
          )}
        </div>
      ))}

      <div className="col-span-2">
        <label className="block text-xs font-mono uppercase tracking-widest text-matrix-subtle mb-1">المورد</label>
        <select
          value={form.supplier_id}
          onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
          className="matrix-input border-matrix-cyan/20 focus:border-matrix-cyan/50"
        >
          <option value="">بدون مورد</option>
          {(suppliers || []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
    </div>
  );

  // ── Columns ───────────────────────────────────────────────────────────────────
  const columns: Column<InventoryItem>[] = [
    {
      key: 'vehicle_type', header: 'النوع',
      render: (r) => (
        <span className={vehicleTypeColor[r.vehicle_type]}>
          {vehicleTypeLabel[r.vehicle_type] || r.vehicle_type}
        </span>
      ),
    },
    {
      key: 'brand', header: 'الماركة/الموديل',
      render: (r) => (
        <div>
          <p>{r.brand}</p>
          <p className="text-xs text-matrix-subtle font-mono">
            {r.model}{r.year ? ` • ${r.year}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'color',         header: 'اللون',      render: (r) => <span className="text-matrix-subtle">{r.color || '—'}</span> },
    { key: 'chassis',       header: 'رقم الهيكل', render: (r) => <span className="font-mono text-[10px] text-matrix-subtle">{r.chassis_number || '—'}</span> },
    { key: 'cost_price',    header: 'التكلفة',    render: (r) => <span className="font-mono text-xs text-matrix-subtle">{formatCurrency(r.cost_price)}</span> },
    { key: 'selling_price', header: 'سعر البيع',  render: (r) => <span className="font-mono font-bold text-matrix-green">{formatCurrency(r.selling_price)}</span> },
    {
      key: 'quantity', header: 'الكمية', align: 'center',
      render: (r) => (
        <span className={cn('font-mono font-bold',
          r.quantity === 0 ? 'text-matrix-red' : r.quantity <= LOW_STOCK_CRITICAL_THRESHOLD ? 'text-matrix-amber' : 'text-matrix-cyan'
        )}>
          {r.quantity}
        </span>
      ),
    },
    {
      key: 'status', header: 'الحالة',
      render: (r) => {
        const cls = r.status === 'IN_STOCK' ? 'badge-green' : r.status === 'SOLD' ? 'badge-red' : r.status === 'RESERVED' ? 'badge-amber' : '';
        return <span className={cls}>{stockStatusLabel[r.status] || r.status}</span>;
      },
    },
    { key: 'supplier',   header: 'المورد',  render: (r) => <span className="text-xs text-matrix-subtle">{r.supplier?.name || '—'}</span> },
    { key: 'created_at', header: 'التاريخ', render: (r) => <span className="text-xs font-mono text-matrix-subtle">{formatDate(r.created_at)}</span> },
    {
      key: 'id', header: 'إجراءات', align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-2">
          {/* Edit */}
          <button onClick={() => openEdit(r)} className="icon-btn" title="تعديل">
            <Pencil className="w-3.5 h-3.5"/>
          </button>
          {/* Delete — OWNER+ only (backend ownerOnly); only if not SOLD */}
          {canManage && r.status !== 'SOLD' && (
            <button onClick={() => setDeleteItem(r)} className="icon-btn icon-btn-danger" title="حذف">
              <Trash2 className="w-3.5 h-3.5"/>
            </button>
          )}
        </div>
      ),
    },
  ];

  const lowStockCount = lowStockItems?.length || 0;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout title="المخزون">
      <div className="space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="الإجمالي"       value={stats?.totals?.total     || 0} icon={<Package className="w-5 h-5"/>} color="cyan"   delay={0}    />
          <KpiCard title="في المخزن"      value={stats?.totals?.in_stock  || 0} icon={<Package className="w-5 h-5"/>} color="green"  delay={0.08} />
          <KpiCard title="مباع"           value={stats?.totals?.sold      || 0} icon={<Package className="w-5 h-5"/>} color="purple" delay={0.16} />
          <button
            type="button"
            onClick={() => setShowLowStockPanel((v) => !v)}
            className="text-left"
          >
            <KpiCard
              title="منخفض المخزون"
              value={stats?.totals?.low_stock || lowStockCount || 0}
              icon={<AlertTriangle className="w-5 h-5"/>}
              color="red"
              delay={0.24}
            />
          </button>
        </div>

        {/* ── GAP FIX #1 — Low-Stock Alerts Panel ──────────────────────────────
            Toggled by clicking the "منخفض المخزون" KPI card above. Shows the
            FULL low-stock list (via inventoryApi.getLowStock — independent of
            table pagination/filters), grouped so vehicles and spare parts are
            visually distinguishable since their "low" thresholds mean
            different things operationally (a showroom missing its last
            motorcycle vs. missing spare oil filters are different urgencies). */}
        {showLowStockPanel && (
          <div className="matrix-panel border border-matrix-red/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-matrix-red" />
                <h3 className="text-sm font-bold text-matrix-red">تنبيهات انخفاض المخزون</h3>
              </div>
              <button onClick={() => setShowLowStockPanel(false)} className="text-matrix-subtle hover:text-matrix-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            {lowStockLoading ? (
              <div className="flex items-center gap-2 text-matrix-subtle text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> جاري التحقق من المخزون...
              </div>
            ) : lowStockCount === 0 ? (
              <p className="text-sm text-matrix-subtle py-2">لا توجد عناصر منخفضة المخزون حالياً. 👍</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(lowStockItems || []).map((item) => {
                  const isCritical = item.quantity === 0;
                  const isSparePart = item.vehicle_type === 'SPARE_PART';
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-lg border p-3 flex items-start justify-between gap-2',
                        isCritical ? 'border-matrix-red/40 bg-matrix-red/5' : 'border-matrix-amber/30 bg-matrix-amber/5'
                      )}
                    >
                      <div>
                        <p className="text-sm font-bold">{item.brand} <span className="text-matrix-subtle">{item.model}</span></p>
                        <p className="text-xs text-matrix-subtle font-mono">
                          {isSparePart ? 'قطعة غيار' : vehicleTypeLabel[item.vehicle_type] || item.vehicle_type}
                        </p>
                      </div>
                      <span className={cn(
                        'font-mono font-bold text-sm px-2 py-0.5 rounded',
                        isCritical ? 'text-matrix-red bg-matrix-red/10' : 'text-matrix-amber bg-matrix-amber/10'
                      )}>
                        {isCritical ? 'نفذت الكمية' : `متبقي ${item.quantity}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Filters — consolidated into one compact bar (was two loose
            full-width selects stacked on their own row) so they read as
            a single control cluster and don't eat vertical real estate. */}
        <div className="filter-bar w-fit">
          <span className="px-2 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle/70">
            تصفية
          </span>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="filter-select min-w-[130px]"
          >
            <option value="">كل الأنواع</option>
            {TYPES.map((t) => <option key={t} value={t}>{vehicleTypeLabel[t]}</option>)}
          </select>

          <div className="w-px h-5 bg-matrix-border" />

          <select
            value={statusFilter}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="filter-select min-w-[120px]"
          >
            <option value="">كل الحالات</option>
            {STATUSES.map((s) => <option key={s} value={s}>{stockStatusLabel[s]}</option>)}
          </select>
        </div>

        {/* Data Table — V2 SHAPE: data?.data / data?.pagination directly, no
            nested .data.data; this matches Paginated<T> from lib/api.ts. */}
        {/* Phase C.1 (5A): a failed query must read as an error, not
            as an empty table. */}
        {isError ? (
          <ListError message="تعذر تحميل المخزون" onRetry={() => refetch()} />
        ) : (
        <DataTable
          data={data?.data || []}
          columns={columns}
          loading={isLoading}
          searchable
          searchPlaceholder="بحث بالماركة أو الموديل..."
          onSearch={(q) => { setSearch(q); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا توجد منتجات"
          pagination={data?.pagination ? {
            page: data.pagination.page, pages: data.pagination.pages,
            total: data.pagination.total, limit: data.pagination.limit,
            onPage: setPage,
          } : undefined}
          actions={
            <div className="flex items-center gap-2">
              {/* FP-01: backend has had PATCH /inventory/:id/reactivate
                  (ownerOnly) with no way to reach it from the UI — deleted
                  items were effectively gone forever. Mirrors the existing
                  customers/inactive and suppliers/inactive pattern. */}
              <Link
                href="/dashboard/inventory/inactive"
                className="btn-secondary flex items-center gap-2 py-2"
              >
                <Archive className="w-4 h-4"/>المنتجات المعطلة
              </Link>
              <button
                onClick={() => { resetBulkState(); setBulkOpen(true); }}
                className="btn-secondary flex items-center gap-2 py-2"
              >
                <Upload className="w-4 h-4"/>استيراد جماعي
              </button>
              <button onClick={() => setAddOpen(true)} className="btn-primary flex items-center gap-2 py-2">
                <Plus className="w-4 h-4"/>إضافة منتج
              </button>
            </div>
          }
        />
        )}

        {/* ── ADD MODAL ──────────────────────────────────────────────────────── */}
        <Modal
          open={addOpen}
          onClose={() => { if (!createMut.isPending) setAddOpen(false); }}
          title="إضافة منتج جديد"
          size="lg"
          footer={
            <>
              <button
                onClick={() => { setAddOpen(false); setForm(BLANK_FORM); }}
                disabled={createMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMut.isPending}
                className={cn(
                  'btn-primary py-2 flex items-center gap-2 min-w-[160px] justify-center',
                  'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200',
                )}
              >
                {createMut.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin shrink-0"/><span>جاري الحفظ...</span></>
                ) : 'حفظ'}
              </button>
            </>
          }
        >
          {FormBody}
        </Modal>

        {/* ── EDIT MODAL ─────────────────────────────────────────────────────── */}
        <Modal
          open={!!editItem}
          onClose={() => { if (!updateMut.isPending) { setEditItem(null); setForm(BLANK_FORM); } }}
          title="تعديل المنتج"
          size="lg"
          footer={
            <>
              <button
                onClick={() => { setEditItem(null); setForm(BLANK_FORM); }}
                disabled={updateMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleUpdate}
                disabled={updateMut.isPending}
                className={cn(
                  'btn-primary py-2 flex items-center gap-2 min-w-[160px] justify-center',
                  'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200',
                )}
              >
                {updateMut.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin shrink-0"/><span>جاري التعديل...</span></>
                ) : 'حفظ التعديلات'}
              </button>
            </>
          }
        >
          {FormBody}
        </Modal>

        {/* ── DELETE CONFIRM MODAL ───────────────────────────────────────────── */}
        <Modal
          open={!!deleteItem}
          onClose={() => { if (!deleteMut.isPending) setDeleteItem(null); }}
          title="تأكيد الحذف"
          size="sm"
          footer={
            <>
              <button
                onClick={() => setDeleteItem(null)}
                disabled={deleteMut.isPending}
                className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                إلغاء
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMut.isPending}
                className={cn(
                  'btn-danger py-2 flex items-center gap-2 min-w-[140px] justify-center',
                  'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200',
                )}
              >
                {deleteMut.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin shrink-0"/><span>جاري الحذف...</span></>
                ) : (
                  <><Trash2 className="w-4 h-4"/>تأكيد الحذف</>
                )}
              </button>
            </>
          }
        >
          <div className="text-center space-y-3 py-2">
            <div className="w-14 h-14 rounded-full bg-matrix-red/10 border border-matrix-red/20 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6 text-matrix-red"/>
            </div>
            <p className="text-matrix-text">
              هل أنت متأكد من حذف
              <span className="text-matrix-red font-bold mx-1">
                {deleteItem?.brand} {deleteItem?.model}
              </span>
              ؟
            </p>
            {/* FP-02: this used to claim the action was irreversible, which
                is false — DELETE only sets is_active: false (soft delete),
                and the item can be restored from "المنتجات المعطلة". */}
            <p className="text-xs text-matrix-subtle">
              سيتم أرشفة المنتج ونقله لقائمة{' '}
              <span className="text-matrix-cyan">المنتجات المعطلة</span>، ويمكن إعادة تفعيله من هناك لاحقاً.
            </p>
          </div>
        </Modal>

        {/* ── GAP FIX #2 — BULK IMPORT MODAL ───────────────────────────────────
            Repeatable-row UI rather than raw CSV paste: avoids a whole class
            of encoding/delimiter bugs with Arabic brand/model text, and lets
            each row get inline validation before anything is sent. Caps at
            100 rows to match the backend's documented bulk limit. */}
        <Modal
          open={bulkOpen}
          onClose={() => { if (!bulkCreateMut.isPending) { setBulkOpen(false); resetBulkState(); } }}
          title="استيراد جماعي للمخزون"
          size="xl"
          footer={
            bulkResult ? (
              <button
                onClick={() => { setBulkOpen(false); resetBulkState(); }}
                className="btn-primary py-2"
              >
                تم
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setBulkOpen(false); resetBulkState(); }}
                  disabled={bulkCreateMut.isPending}
                  className="btn-secondary py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleBulkSubmit}
                  disabled={bulkCreateMut.isPending || bulkRows.length === 0}
                  className={cn(
                    'btn-primary py-2 flex items-center gap-2 min-w-[180px] justify-center',
                    'disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200',
                  )}
                >
                  {bulkCreateMut.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin shrink-0"/><span>جاري الاستيراد...</span></>
                  ) : (
                    <><Upload className="w-4 h-4"/>استيراد {bulkRows.length} منتج</>
                  )}
                </button>
              </>
            )
          }
        >
          {bulkResult ? (
            // ── Result summary — shown after submit instead of the form ──────
            <div className="text-center space-y-3 py-4">
              {bulkResult.failed === 0 ? (
                <CheckCircle2 className="w-12 h-12 text-matrix-green mx-auto" />
              ) : (
                <AlertTriangle className="w-12 h-12 text-matrix-amber mx-auto" />
              )}
              <p className="text-lg font-bold">
                تم استيراد <span className="text-matrix-green">{bulkResult.created}</span> منتج بنجاح
              </p>
              {bulkResult.failed > 0 && (
                <p className="text-sm text-matrix-red">
                  فشل استيراد {bulkResult.failed} منتج — راجع البيانات وحاول مجدداً للعناصر المتبقية
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              <p className="text-xs text-matrix-subtle">
                أضف حتى 100 منتج دفعة واحدة. الحقول الأساسية فقط — يمكنك إضافة التفاصيل (سعة المحرك، المورد، إلخ) لاحقاً من خلال التعديل.
              </p>

              {bulkRows.map((row, index) => {
                const hasError = rowHasError(index);
                return (
                  <div
                    key={index}
                    className={cn(
                      'rounded-lg border p-3 grid grid-cols-12 gap-2 items-start',
                      hasError ? 'border-matrix-red/40 bg-matrix-red/5' : 'border-matrix-cyan/15'
                    )}
                  >
                    <div className="col-span-12 flex items-center justify-between">
                      <span className="text-xs font-mono text-matrix-subtle">صف #{index + 1}</span>
                      {bulkRows.length > 1 && (
                        <button
                          onClick={() => removeBulkRow(index)}
                          className="text-matrix-red/70 hover:text-matrix-red"
                          title="حذف الصف"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <select
                      value={row.vehicle_type}
                      onChange={(e) => updateBulkRow(index, { vehicle_type: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-2 border-matrix-cyan/20"
                    >
                      {TYPES.map((t) => <option key={t} value={t}>{vehicleTypeLabel[t]}</option>)}
                    </select>
                    <input
                      placeholder="الماركة"
                      value={row.brand}
                      onChange={(e) => updateBulkRow(index, { brand: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-2 border-matrix-cyan/20"
                    />
                    <input
                      placeholder="الموديل"
                      value={row.model}
                      onChange={(e) => updateBulkRow(index, { model: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-2 border-matrix-cyan/20"
                    />
                    <input
                      placeholder="اللون"
                      value={row.color}
                      onChange={(e) => updateBulkRow(index, { color: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-1 border-matrix-cyan/20"
                    />
                    <input
                      placeholder="التكلفة"
                      type="number"
                      dir="ltr"
                      value={row.cost_price}
                      onChange={(e) => updateBulkRow(index, { cost_price: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-2 border-matrix-cyan/20"
                    />
                    <input
                      placeholder="سعر البيع"
                      type="number"
                      dir="ltr"
                      value={row.selling_price}
                      onChange={(e) => updateBulkRow(index, { selling_price: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-2 border-matrix-cyan/20"
                    />
                    <input
                      placeholder="الكمية"
                      type="number"
                      dir="ltr"
                      value={row.quantity}
                      onChange={(e) => updateBulkRow(index, { quantity: e.target.value })}
                      className="matrix-input py-1.5 text-sm col-span-1 border-matrix-cyan/20"
                    />

                    {hasError && (
                      <div className="col-span-12 flex items-start gap-1.5 text-xs text-matrix-red pt-1">
                        <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{rowErrorMessages(index).join(' • ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={addBulkRow}
                disabled={bulkRows.length >= 100}
                className="btn-secondary w-full py-2 flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" /> إضافة صف
              </button>
            </div>
          )}
        </Modal>

      </div>
    </DashboardLayout>
  );
}
