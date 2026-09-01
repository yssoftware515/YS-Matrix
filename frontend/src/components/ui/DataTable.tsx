'use client';
import { ReactNode, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string; header: string; render?: (row: T) => ReactNode;
  width?: string; align?: 'left' | 'right' | 'center';
  /** MOB-01: hide this column below the `sm` breakpoint (320-480px) —
   *  use for secondary columns (IDs, timestamps, counts) so the
   *  primary columns + actions have room to breathe on a phone. */
  hideOnMobile?: boolean;
}

interface Pagination { page: number; pages: number; total: number; limit: number; onPage: (p: number) => void; }

interface DataTableProps<T> {
  data: T[]; columns: Column<T>[]; loading?: boolean;
  searchable?: boolean; searchPlaceholder?: string; onSearch?: (q: string) => void;
  actions?: ReactNode; rowKey: (row: T) => string; onRowClick?: (row: T) => void;
  emptyText?: string; pagination?: Pagination;
}

// MOB-05: the old pager always rendered a fixed window of [1..5]
// regardless of the current page — past page 5 of any list, none of
// the numbered buttons pointed at your actual page. This centers a
// window of `size` page numbers on the current page instead, clamped
// to [1, totalPages].
function getPageWindow(current: number, total: number, size: number): number[] {
  if (total <= size) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(size / 2));
  const end = Math.min(total, start + size - 1);
  start = Math.max(1, end - size + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function DataTable<T>({ data, columns, loading, searchable, searchPlaceholder = 'بحث...', onSearch, actions, rowKey, onRowClick, emptyText = 'لا توجد بيانات', pagination }: DataTableProps<T>) {
  const [search,  setSearch]  = useState('');

  const handleSearch = (v: string) => { setSearch(v); onSearch?.(v); };

  // MOB-01: fade the scroll container's edges only while it is
  // ACTUALLY horizontally scrollable — a static mask would clip the
  // first/last column's content even when everything already fits.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, columns]);

  const fadeStyle = scrollable
    ? {
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
        maskImage:       'linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)',
      }
    : undefined;

  return (
    <div className="matrix-panel flex flex-col overflow-hidden">
      {(searchable || actions) && (
        <div className="flex items-center justify-between gap-4 p-4 border-b border-matrix-border">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-matrix-subtle" />
              <input type="text" value={search} onChange={(e) => handleSearch(e.target.value)} placeholder={searchPlaceholder} className="matrix-input pr-10 py-2 text-sm" />
            </div>
          )}
          {actions && <div className="flex items-center gap-2 mr-auto">{actions}</div>}
        </div>
      )}

      {/* MOB-01: no min-width meant the table just squished on a phone
          instead of triggering real horizontal scroll. min-w-[560px]
          forces genuine overflow so overflow-x-auto has something to do. */}
      <div ref={scrollRef} className="overflow-x-auto flex-1" style={fadeStyle}>
        <table className="matrix-table w-full min-w-[560px]">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width }}
                  className={cn(
                    col.align === 'center' && 'text-center', col.align === 'left' && 'text-left',
                    col.hideOnMobile && 'hidden sm:table-cell',
                  )}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{columns.map((col) => <td key={col.key} className={cn(col.hideOnMobile && 'hidden sm:table-cell')}><div className="skeleton h-4 rounded w-3/4" /></td>)}</tr>
                  ))
                : data.length === 0
                ? <tr><td colSpan={columns.length}><div className="flex flex-col items-center justify-center py-16 text-matrix-subtle"><Inbox className="w-10 h-10 mb-3 opacity-40" /><p className="font-body text-sm">{emptyText}</p></div></td></tr>
                : data.map((row, idx) => (
                    <motion.tr key={rowKey(row)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.025 }}
                      className={cn(onRowClick && 'cursor-pointer')} onClick={() => onRowClick?.(row)}>
                      {columns.map((col) => (
                        <td key={col.key} className={cn(col.align === 'center' && 'text-center', col.align === 'left' && 'text-left', col.hideOnMobile && 'hidden sm:table-cell')}>
                          {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                        </td>
                      ))}
                    </motion.tr>
                  ))
              }
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-matrix-border">
          <p className="hidden sm:block text-xs font-mono text-matrix-subtle shrink-0">
            {pagination.total} سجل | صفحة {pagination.page} من {pagination.pages}
          </p>

          <div className="flex items-center gap-1 mx-auto sm:mx-0">
            {/* MOB-05: bumped to h-11 (44px) below `sm` — Apple HIG
                minimum touch target — back to the original h-8 (32px)
                from `sm` upward, where precision-pointer input (mouse)
                is the norm rather than a fingertip. */}
            <button disabled={pagination.page === 1} onClick={() => pagination.onPage(pagination.page - 1)}
              className={cn('px-3 h-11 sm:h-8 rounded text-xs font-mono border transition-all shrink-0', pagination.page === 1 ? 'border-matrix-border text-matrix-subtle/40 cursor-not-allowed' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan')}>
              السابق
            </button>

            {/* Numbered quick-jump — hidden below `sm`: at 320-480px
                there isn't room to fit 5 tappable 44px targets plus
                prev/next without clipping (MOB-05). The compact "X / Y"
                indicator below covers that case instead. */}
            <div className="hidden sm:flex items-center gap-1">
              {getPageWindow(pagination.page, pagination.pages, 5).map((p) => (
                <button key={p} onClick={() => pagination.onPage(p)}
                  className={cn('w-8 h-8 rounded text-xs font-mono border transition-all', pagination.page === p ? 'border-matrix-cyan bg-matrix-cyan/10 text-matrix-cyan' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan')}>
                  {p}
                </button>
              ))}
            </div>

            <span className="sm:hidden text-xs font-mono text-matrix-subtle px-2 whitespace-nowrap">
              {pagination.page} / {pagination.pages}
            </span>

            <button disabled={pagination.page === pagination.pages} onClick={() => pagination.onPage(pagination.page + 1)}
              className={cn('px-3 h-11 sm:h-8 rounded text-xs font-mono border transition-all shrink-0', pagination.page === pagination.pages ? 'border-matrix-border text-matrix-subtle/40 cursor-not-allowed' : 'border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan')}>
              التالي
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
