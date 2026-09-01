'use client';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KpiCardProps {
  title: string; value: string | number; subtitle?: string;
  change?: number; icon: React.ReactNode;
  color?: 'cyan' | 'green' | 'amber' | 'red' | 'purple';
  loading?: boolean; delay?: number;
}

const colorMap = {
  cyan:   { icon: 'text-matrix-cyan',   bg: 'bg-matrix-cyan/10',   border: 'hover:border-matrix-cyan' },
  green:  { icon: 'text-matrix-green',  bg: 'bg-matrix-green/10',  border: 'hover:border-matrix-green' },
  amber:  { icon: 'text-matrix-amber',  bg: 'bg-matrix-amber/10',  border: 'hover:border-matrix-amber' },
  red:    { icon: 'text-matrix-red',    bg: 'bg-matrix-red/10',    border: 'hover:border-matrix-red' },
  purple: { icon: 'text-matrix-purple', bg: 'bg-matrix-purple/10', border: 'hover:border-matrix-purple' },
};

export function KpiCard({ title, value, subtitle, change, icon, color = 'cyan', loading = false, delay = 0 }: KpiCardProps) {
  const c = colorMap[color];
  const TrendIcon = change === undefined ? null : change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendColor = change === undefined ? '' : change > 0 ? 'text-matrix-green' : change < 0 ? 'text-matrix-red' : 'text-matrix-subtle';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('kpi-card', c.border)}
    >
      {loading ? (
        <div className="space-y-3">
          <div className="flex justify-between"><div className="skeleton w-10 h-10 rounded-lg" /><div className="skeleton w-12 h-4 rounded" /></div>
          <div className="skeleton w-28 h-7 rounded" /><div className="skeleton w-20 h-4 rounded" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between mb-4">
            <div className={cn('flex items-center justify-center w-10 h-10 rounded-lg', c.bg)}>
              <span className={cn('w-5 h-5', c.icon)}>{icon}</span>
            </div>
            {TrendIcon && change !== undefined && (
              <span className={cn('flex items-center gap-1 text-xs font-mono', trendColor)}>
                <TrendIcon className="w-3 h-3" />{Math.abs(change)}%
              </span>
            )}
          </div>
          <p className={cn('font-mono text-2xl font-bold tracking-wide mb-1 truncate', c.icon)} title={String(value)}>{value}</p>
          <p className="text-sm font-body text-matrix-subtle truncate">{title}</p>
          {subtitle && <p className="text-xs font-mono text-matrix-subtle/70 mt-1 truncate">{subtitle}</p>}
        </>
      )}
    </motion.div>
  );
}
