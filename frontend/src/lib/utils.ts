import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatCurrency = (amount: number | string) => {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('ar').format(n) + ' ر.ي';
};

export const formatNumber = (n: number | string) => {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('ar').format(num);
};

export const formatDate = (date: string | Date) => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date));
};

export const formatDateTime = (date: string | Date) => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
};

export const daysUntil = (date: string | Date) =>
  Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

export const isDatePast = (date: string | Date) => new Date(date) < new Date();

export const vehicleTypeLabel: Record<string, string> = {
  MOTORCYCLE: 'دراجة نارية', CAR: 'سيارة', TUKTUK: 'توك توك',
  TRICYCLE: 'ثلاثية العجلات', SPARE_PART: 'قطعة غيار', OTHER: 'أخرى',
};
export const vehicleTypeColor: Record<string, string> = {
  MOTORCYCLE: 'badge-cyan', CAR: 'badge-purple', TUKTUK: 'badge-amber',
  TRICYCLE: 'badge-green', SPARE_PART: 'badge-red', OTHER: '',
};
export const saleStatusLabel: Record<string, string> = {
  ACTIVE: 'نشط', COMPLETED: 'مكتمل', CANCELLED: 'ملغى', OVERDUE: 'متأخر',
};
export const saleTypeLabel: Record<string, string> = { CASH: 'كاش', INSTALLMENT: 'تقسيط' };
export const stockStatusLabel: Record<string, string> = {
  IN_STOCK: 'في المخزن', SOLD: 'مباع', RESERVED: 'محجوز', RETURNED: 'مرتجع',
};
export const roleLabel: Record<string, string> = {
  SUPER_ADMIN: 'مدير النظام', OWNER: 'صاحب المعرض', STAFF: 'موظف',
};
export const profitColor = (v: number) =>
  v > 0 ? 'text-matrix-green' : v < 0 ? 'text-matrix-red' : 'text-matrix-subtle';

export const truncate = (s: string, len = 30) =>
  s?.length > len ? s.slice(0, len) + '...' : s;
