'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { Printer, ArrowRight } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { api } from '@/lib/api';
import { useAuthStore, isOwnerPlus } from '@/lib/auth';
import { openPrintHTML } from '@/lib/print';
import { formatCurrency, formatDate, formatDateTime, saleTypeLabel, saleStatusLabel, vehicleTypeLabel, cn } from '@/lib/utils';

interface InvoiceData {
  id: string; invoice_number: string; sale_type: string; status: string;
  subtotal: number; discount: number; total: number; profit: number;
  sold_at: string; notes?: string; down_payment?: number; monthly_amount?: number; installment_months?: number;
  customer?: { name: string; phone?: string; national_id?: string; address?: string };
  user?: { name: string };
  showroom: { name: string; phone?: string; address?: string };
  items: { id: string; quantity: number; unit_price: number; total_price: number; profit: number; inventory?: { brand: string; model: string; vehicle_type: string; color?: string; chassis_number?: string; engine_number?: string; engine_cc?: number } }[];
  installments: { id: string; amount: number; due_date: string; is_paid: boolean }[];
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const canViewNationalId = isOwnerPlus(user?.role);

  const { data: invoice, isLoading, isError } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data.data as InvoiceData),
    enabled: !!id,
  });

  if (isLoading) return (
    <DashboardLayout title="الفاتورة">
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-matrix-cyan border-t-transparent rounded-full animate-spin" />
          <p className="font-mono text-xs text-matrix-subtle tracking-widest">LOADING INVOICE...</p>
        </div>
      </div>
    </DashboardLayout>
  );

  if (isError || !invoice) return (
    <DashboardLayout title="الفاتورة">
      <div className="text-center py-20">
        <p className="text-matrix-red font-mono mb-4">فاتورة غير موجودة</p>
        <button onClick={() => router.back()} className="btn-secondary py-2 px-6">رجوع</button>
      </div>
    </DashboardLayout>
  );

  const paidCount = invoice.installments.filter((i) => i.is_paid).length;

  return (
    <DashboardLayout title={'فاتورة: ' + invoice.invoice_number}>
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-matrix-subtle hover:text-matrix-cyan transition-colors text-sm font-mono">
            <ArrowRight className="w-4 h-4" />رجوع للمبيعات
          </button>
          <div className="flex gap-3">
            <button onClick={() => openPrintHTML(`/invoices/${id}/print`).catch(() => toast.error('تعذر فتح الفاتورة للطباعة'))} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-matrix-cyan text-matrix-cyan text-sm font-mono hover:bg-matrix-cyan/10 transition-all">
              <Printer className="w-4 h-4" />طباعة / PDF
            </button>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="matrix-panel overflow-hidden">
          <div className="bg-matrix-dark border-b border-matrix-border px-6 py-5 flex items-start justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-matrix-cyan tracking-widest">YS-MATRIX</h1>
              <p className="font-mono text-xs text-matrix-subtle mt-1">ERP SYSTEM</p>
              <div className="mt-3 space-y-1 text-sm text-matrix-subtle">
                <p>{invoice.showroom.name}</p>
                {invoice.showroom.phone && <p>{invoice.showroom.phone}</p>}
                {invoice.showroom.address && <p>{invoice.showroom.address}</p>}
              </div>
            </div>
            <div className="text-left">
              <p className="font-display text-xl font-bold text-matrix-green">{invoice.invoice_number}</p>
              <p className="font-mono text-xs text-matrix-subtle mt-1">{formatDateTime(invoice.sold_at)}</p>
              <div className="flex flex-col items-end gap-2 mt-3">
                <span className={invoice.sale_type === 'CASH' ? 'badge-green' : 'badge-purple'}>{saleTypeLabel[invoice.sale_type]}</span>
                <span className={invoice.status === 'ACTIVE' ? 'badge-cyan' : invoice.status === 'COMPLETED' ? 'badge-green' : 'badge-red'}>{saleStatusLabel[invoice.status] || invoice.status}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-matrix-border">
            <div className="bg-matrix-panel p-5">
              <p className="section-title">بيانات العميل</p>
              <div className="space-y-2 text-sm">
                {[['الاسم', invoice.customer?.name || 'بدون عميل'], ['الهاتف', invoice.customer?.phone || '—'], ...(canViewNationalId ? [['الهوية', invoice.customer?.national_id || '—']] : []), ['العنوان', invoice.customer?.address || '—']].map(([l, v]) => (
                  <div key={l} className="flex justify-between"><span className="text-matrix-subtle">{l}</span><span className="font-mono">{v}</span></div>
                ))}
              </div>
            </div>
            <div className="bg-matrix-panel p-5">
              <p className="section-title">بيانات الفاتورة</p>
              <div className="space-y-2 text-sm">
                {[['رقم الفاتورة', invoice.invoice_number], ['التاريخ', formatDate(invoice.sold_at)], ['الموظف', invoice.user?.name || '—'], ['نوع البيع', saleTypeLabel[invoice.sale_type]], ...(invoice.sale_type === 'INSTALLMENT' ? [['الدفعة الأولى', formatCurrency(invoice.down_payment || 0)], ['القسط الشهري', formatCurrency(invoice.monthly_amount || 0)], ['عدد الأشهر', `${invoice.installment_months} شهر`]] : [])].map(([l, v]) => (
                  <div key={l} className="flex justify-between"><span className="text-matrix-subtle">{l}</span><span className="font-mono">{v}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-5">
            <p className="section-title">المنتجات</p>
            <div className="overflow-x-auto">
              <table className="matrix-table min-w-[560px] w-full text-sm">
                <thead><tr><th>#</th><th>المنتج</th><th>النوع</th><th>اللون</th><th>رقم الهيكل</th><th>رقم المحرك</th><th className="text-center">الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>
                  {invoice.items.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="font-mono text-xs text-matrix-subtle">{idx + 1}</td>
                      <td><p>{item.inventory?.brand} {item.inventory?.model}</p>{item.inventory?.engine_cc && <p className="text-xs text-matrix-subtle">{item.inventory.engine_cc}cc</p>}</td>
                      <td><span className="badge-cyan text-xs">{vehicleTypeLabel[item.inventory?.vehicle_type || ''] || '—'}</span></td>
                      <td className="text-matrix-subtle">{item.inventory?.color || '—'}</td>
                      <td className="font-mono text-xs text-matrix-subtle">{item.inventory?.chassis_number || '—'}</td>
                      <td className="font-mono text-xs text-matrix-subtle">{item.inventory?.engine_number || '—'}</td>
                      <td className="text-center font-mono font-bold text-matrix-cyan">{item.quantity}</td>
                      <td className="font-mono">{formatCurrency(item.unit_price)}</td>
                      <td className="font-mono font-bold text-matrix-green">{formatCurrency(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end p-5 border-t border-matrix-border">
            <div className="space-y-2 min-w-56">
              <div className="flex justify-between text-sm"><span className="text-matrix-subtle">المجموع الفرعي:</span><span className="font-mono">{formatCurrency(invoice.subtotal)}</span></div>
              {parseFloat(String(invoice.discount)) > 0 && <div className="flex justify-between text-sm"><span className="text-matrix-subtle">الخصم:</span><span className="font-mono text-matrix-amber">- {formatCurrency(invoice.discount)}</span></div>}
              <div className="flex justify-between text-base font-bold border-t border-matrix-border pt-2"><span>الإجمالي:</span><span className="font-mono text-matrix-green text-lg">{formatCurrency(invoice.total)}</span></div>
            </div>
          </div>
        </motion.div>

        {invoice.installments.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="matrix-panel p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="section-title mb-0">جدول الأقساط</p>
              <span className="badge-cyan">{paidCount}/{invoice.installments.length} مدفوع</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {invoice.installments.map((inst, idx) => (
                <div key={inst.id} className={cn('p-3 rounded-lg border text-sm', inst.is_paid ? 'border-matrix-green/20 bg-matrix-green/5' : new Date(inst.due_date) < new Date() ? 'border-matrix-red/20 bg-matrix-red/5' : 'border-matrix-border bg-matrix-dark')}>
                  <div className="flex justify-between">
                    <div><p className="font-mono text-xs text-matrix-subtle">قسط #{idx + 1}</p><p className={cn('text-xs font-mono mt-1', inst.is_paid ? 'text-matrix-green' : new Date(inst.due_date) < new Date() ? 'text-matrix-red' : 'text-matrix-subtle')}>{formatDate(inst.due_date)}</p></div>
                    <div className="text-right"><p className="font-mono font-bold text-matrix-amber">{formatCurrency(inst.amount)}</p><p className={cn('text-xs mt-1', inst.is_paid ? 'text-matrix-green' : 'text-matrix-subtle')}>{inst.is_paid ? '✓ مدفوع' : '○ معلق'}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {invoice.notes && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="matrix-panel p-5">
            <p className="section-title">ملاحظات</p>
            <p className="text-sm text-matrix-subtle">{invoice.notes}</p>
          </motion.div>
        )}
      </div>
    </DashboardLayout>
  );
}
