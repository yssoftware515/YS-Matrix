'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, RefreshCw, CheckCircle, AlertCircle, Loader2, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  mode: 'manual' | 'auto'; status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  isDirty: boolean; onSave: () => void; onDiscard: () => void; onToggle: () => void;
}

export function SaveModeBar({ mode, status, isDirty, onSave, onDiscard, onToggle }: Props) {
  const cfg = {
    idle:   { icon: null, color: '', text: '' },
    dirty:  { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-matrix-amber', text: 'تغييرات غير محفوظة' },
    saving: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: 'text-matrix-cyan', text: 'جاري الحفظ...' },
    saved:  { icon: <CheckCircle className="w-3.5 h-3.5" />, color: 'text-matrix-green', text: 'تم الحفظ ✓' },
    error:  { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-matrix-red', text: 'فشل الحفظ' },
  }[status];

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between px-4 py-2.5 mb-4 rounded-lg border border-matrix-border bg-matrix-dark">
      <div className="flex items-center gap-3">
        <AnimatePresence mode="wait">
          {status !== 'idle' && (
            <motion.div key={status} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              className={cn('flex items-center gap-1.5 text-xs font-mono', cfg.color)}>
              {cfg.icon}<span>{cfg.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onToggle}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-all', mode === 'auto' ? 'border-matrix-cyan/40 bg-matrix-cyan/10 text-matrix-cyan' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan')}>
          {mode === 'auto' ? <><Zap className="w-3 h-3" />تلقائي</> : <><Clock className="w-3 h-3" />يدوي</>}
        </button>
        {isDirty && mode === 'manual' && (
          <button onClick={onDiscard} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border border-matrix-border text-matrix-subtle hover:border-matrix-red hover:text-matrix-red transition-all">
            <RefreshCw className="w-3 h-3" />تراجع
          </button>
        )}
        {mode === 'manual' && (
          <button onClick={onSave} disabled={!isDirty || status === 'saving'}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-mono border transition-all', isDirty && status !== 'saving' ? 'border-matrix-green bg-matrix-green/10 text-matrix-green hover:bg-matrix-green/20' : 'border-matrix-border text-matrix-subtle/40 cursor-not-allowed')}>
            <Save className="w-3 h-3" />حفظ
          </button>
        )}
      </div>
    </motion.div>
  );
}
