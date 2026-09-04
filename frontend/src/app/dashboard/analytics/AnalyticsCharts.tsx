'use client';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';

const COLORS = ['#00D4FF','#00FF88','#FFB800','#9B5DE5','#FF2D55','#0066FF'];

type TipProps = { active?: boolean; payload?: { value: number }[]; label?: string };

const Tip = ({ active, payload, label }: TipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="matrix-panel px-3 py-2 text-xs font-mono">
      <p className="text-matrix-subtle mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="text-matrix-green">{formatCurrency(p.value)}</p>)}
    </div>
  );
};

export function RevenueAreaChart({ data }: { data: { date: string; revenue: number; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
  );
}

export function MonthlyBarChart({ data }: { data: { month: string; revenue: number; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(13,33,55,0.8)" />
        <XAxis dataKey="month" tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
        <YAxis tick={{ fill: '#4A7A9B', fontSize: 9, fontFamily: 'JetBrains Mono' }} />
        <Tooltip content={<Tip />} />
        <Bar dataKey="revenue" fill="#00D4FF" fillOpacity={0.7} radius={[4,4,0,0]} />
        <Bar dataKey="profit" fill="#00FF88" fillOpacity={0.7} radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProfitPieChart({ data }: { data: { type: string; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} dataKey="profit" nameKey="type" cx="50%" cy="50%" outerRadius={80}>
          {data.map((_: unknown, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />)}
        </Pie>
        <Tooltip formatter={(v) => formatCurrency(typeof v === 'number' ? v : 0)} />
      </PieChart>
    </ResponsiveContainer>
  );
}
