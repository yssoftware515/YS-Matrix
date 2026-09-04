'use client';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '@/lib/utils';

type ChartDataPoint = { date: string; revenue: number; profit: number };

const Tip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="matrix-panel px-3 py-2 text-xs font-mono">
      <p className="text-matrix-subtle mb-1">{label}</p>
      <p className="text-matrix-green">{formatCurrency(payload[0]?.value || 0)}</p>
    </div>
  );
};

export default function RevenueChart({ data }: { data: ChartDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00FF88" stopOpacity={0.2} /><stop offset="95%" stopColor="#00FF88" stopOpacity={0} /></linearGradient>
          <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00D4FF" stopOpacity={0.2} /><stop offset="95%" stopColor="#00D4FF" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,33,55,0.8)" />
        <XAxis dataKey="date" tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
        <YAxis tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
        <Tooltip content={<Tip />} />
        <Area type="monotone" dataKey="revenue" stroke="#00FF88" strokeWidth={2} fill="url(#rg)" />
        <Area type="monotone" dataKey="profit" stroke="#00D4FF" strokeWidth={2} fill="url(#pg)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
