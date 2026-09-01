'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { KpiCard } from '@/components/ui/KpiCard';
import { analyticsApi, type TopSellingItem } from '@/lib/api';
import { formatCurrency, vehicleTypeLabel, cn } from '@/lib/utils';
import { TrendingUp, DollarSign, Package } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

type RangeType = 'today' | 'week' | 'month' | 'year';

const RANGES = [{ value: 'today', label: 'اليوم' }, { value: 'week', label: 'الأسبوع' }, { value: 'month', label: 'الشهر' }, { value: 'year', label: 'السنة' }];
const COLORS = ['#00D4FF','#00FF88','#FFB800','#9B5DE5','#FF2D55','#0066FF'];

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeType>('month');

  // ── Queries ─────────────────────────────────────────────────────────────────
  // V2 SHAPE: every analyticsApi method already resolves directly to its
  // typed payload (DashboardKPIs, RevenueChartResponse, etc. — see api.ts).
  // The previous `.then((r) => r.data.data)` reached two levels too deep:
  // first assuming a raw AxiosResponse (api.ts already unwraps that), then
  // unwrapping a second `.data` layer that doesn't exist on these shapes.
  // That's why `revenue?.data` below used to silently resolve to undefined
  // — `revenue` was already the chart array at that point, and arrays
  // don't have a `.data` property.
  const { data: kpis, isLoading } = useQuery({ queryKey: ['kpis', range], queryFn: () => analyticsApi.getDashboard({ range }) });
  const { data: revenue } = useQuery({ queryKey: ['revenue', range], queryFn: () => analyticsApi.getRevenue({ range }) });
  const { data: monthly } = useQuery({ queryKey: ['monthly'], queryFn: () => analyticsApi.getMonthly({ months: 12 }) });
  const { data: topItems } = useQuery({ queryKey: ['top-items', range], queryFn: () => analyticsApi.getTopItems({ range, limit: 5 }) });
  const { data: profitBD } = useQuery({ queryKey: ['profit-bd', range], queryFn: () => analyticsApi.getProfitBreakdown({ range }) });
  const { data: netProfit } = useQuery({ queryKey: ['net-profit', range], queryFn: () => analyticsApi.getNetProfit({ range }) });

  const Tip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return <div className="matrix-panel px-3 py-2 text-xs font-mono"><p className="text-matrix-subtle mb-1">{label}</p>{payload.map((p, i) => <p key={i} className="text-matrix-green">{formatCurrency(p.value)}</p>)}</div>;
  };

  return (
    <DashboardLayout title="التحليلات">
      <div className="space-y-6">
        <div className="flex gap-2">
          {RANGES.map((opt) => <button key={opt.value} onClick={() => setRange(opt.value as RangeType)} className={cn('px-4 py-1.5 rounded-lg text-xs font-mono border transition-all', range === opt.value ? 'border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan')}>{opt.label}</button>)}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="الإيرادات" value={formatCurrency(kpis?.sales?.revenue || 0)} icon={<DollarSign className="w-5 h-5" />} color="green" loading={isLoading} delay={0} change={kpis?.sales?.revenue_change || 0} />
          <KpiCard title="الربح الإجمالي" value={formatCurrency(kpis?.sales?.profit || 0)} icon={<TrendingUp className="w-5 h-5" />} color="cyan" loading={isLoading} delay={0.08} change={kpis?.sales?.profit_change || 0} />
          <KpiCard title="الربح الصافي" value={formatCurrency(netProfit?.net_profit || 0)} subtitle={'هامش ' + (netProfit?.net_margin || 0) + '%'} icon={<TrendingUp className="w-5 h-5" />} color="purple" loading={isLoading} delay={0.16} />
          <KpiCard title="المخزون المباع" value={kpis?.inventory?.sold || 0} icon={<Package className="w-5 h-5" />} color="amber" loading={isLoading} delay={0.24} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="matrix-panel p-5">
            <p className="section-title">الإيرادات اليومية</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenue?.data || []} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="rg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00FF88" stopOpacity={0.2} /><stop offset="95%" stopColor="#00FF88" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,33,55,0.8)" />
                <XAxis dataKey="date" tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <YAxis tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <Tooltip content={<Tip />} />
                <Area type="monotone" dataKey="revenue" stroke="#00FF88" strokeWidth={2} fill="url(#rg2)" />
                <Area type="monotone" dataKey="profit" stroke="#00D4FF" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="matrix-panel p-5">
            <p className="section-title">المقارنة الشهرية</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={(monthly || []).slice(-6)} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,33,55,0.8)" />
                <XAxis dataKey="month" tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <YAxis tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
                <Tooltip content={<Tip />} />
                <Bar dataKey="revenue" fill="#00D4FF" fillOpacity={0.7} radius={[4,4,0,0]} />
                <Bar dataKey="profit" fill="#00FF88" fillOpacity={0.7} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="matrix-panel p-5">
            <p className="section-title">أكثر المنتجات مبيعاً</p>
            <div className="space-y-3">
              {(topItems || []).slice(0, 5).map((item: TopSellingItem, idx: number) => (
                <div key={idx} className="flex items-center gap-3 p-3 rounded-lg border border-matrix-border bg-matrix-dark">
                  <span className="font-display text-xs text-matrix-subtle w-5">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.inventory?.brand} {item.inventory?.model}</p>
                    <p className="text-xs text-matrix-subtle">{vehicleTypeLabel[item.inventory?.vehicle_type || '']}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-matrix-green">{formatCurrency(item.total_revenue)}</p>
                    <p className="text-xs text-matrix-subtle">{item.total_sold} وحدة</p>
                  </div>
                </div>
              ))}
              {!(topItems?.length) && <p className="text-center text-sm text-matrix-subtle py-4">لا توجد بيانات</p>}
            </div>
          </div>
          <div className="matrix-panel p-5">
            <p className="section-title">توزيع الربح حسب النوع</p>
            {(profitBD || []).length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={profitBD || []} dataKey="profit" nameKey="type" cx="50%" cy="50%" outerRadius={80}>
                    {(profitBD || []).map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(typeof v === 'number' ? v : 0)} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-sm text-matrix-subtle py-16">لا توجد بيانات</p>}
          </div>
        </div>

        {netProfit && (
          <div className="matrix-panel p-5">
            <p className="section-title">ملخص الربح الصافي</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[['إجمالي الإيراد', netProfit.total_revenue, 'text-matrix-text'], ['الربح الإجمالي', netProfit.gross_profit, 'text-matrix-green'], ['إجمالي المصاريف', netProfit.total_expenses, 'text-matrix-red'], ['الربح الصافي', netProfit.net_profit, 'text-matrix-cyan']].map(([l, v, c]) => (
                <div key={String(l)} className="p-4 rounded-lg border border-matrix-border bg-matrix-dark text-center">
                  <p className="text-xs text-matrix-subtle mb-2">{l}</p>
                  <p className={cn('font-mono text-lg font-bold', String(c))}>{formatCurrency(Number(v))}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
