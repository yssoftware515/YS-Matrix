'use client';

// Phase C.1 (5A) — a shared error state for list pages.
//
// Before this existed, every list page handled query failure differently
// (or not at all — several pages rendered an empty state for what was
// actually a crashed query, which reads as "no data" instead of "the
// server didn't answer"). This clones the dashboard's SectionError
// pattern into one reusable component: distinct error icon + message +
// retry button wired to the page's refetch.
import { ShieldAlert, RefreshCw } from 'lucide-react';

export function ListError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="matrix-panel flex flex-col items-center justify-center gap-3 py-14 text-center">
      <ShieldAlert className="w-8 h-8 text-matrix-red/70" />
      <p className="text-sm text-matrix-subtle">{message || 'تعذر تحميل البيانات'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg border border-matrix-border text-xs font-mono text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}