'use client';

// ============================================================
// YS-MATRIX ERP — GlobalSearch (Phase 3 Stage 1)
// Cmd+K / Ctrl+K shortcut + live results dropdown
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Loader2, Package, Users, Truck, ShoppingCart } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { searchApi, type GlobalSearchResponse } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────
interface SearchResult {
  entity:   'inventory' | 'customers' | 'suppliers' | 'sales';
  id:       string;
  title:    string;
  subtitle: string;
}

interface SearchResponse {
  inventory: SearchResult[];
  customers: SearchResult[];
  suppliers: SearchResult[];
  sales:     SearchResult[];
}

const ENTITY_CONFIG: Record<
  SearchResult['entity'],
  { icon: React.ElementType; label: string; color: string }
> = {
  inventory: { icon: Package,      label: 'المخزون',    color: 'text-matrix-cyan'   },
  customers: { icon: Users,        label: 'العملاء',    color: 'text-matrix-green'  },
  suppliers: { icon: Truck,        label: 'الموردون',   color: 'text-matrix-amber'  },
  sales:     { icon: ShoppingCart, label: 'المبيعات',   color: 'text-matrix-purple' },
};

// F6 — the detail routes (/dashboard/inventory/:id etc.) don't exist;
// list pages DO exist and all read `search` server-side. Results now
// deep-link into the list with the search term prefilled, so the user
// lands one keystroke away from the record instead of a 404.
const ROUTE_MAP: Record<SearchResult['entity'], string> = {
  inventory: '/dashboard/inventory',
  customers: '/dashboard/customers',
  suppliers: '/dashboard/suppliers',
  sales:     '/dashboard/sales',
};

// ─── Result Group ────────────────────────────────────────────
function ResultGroup({
  entity,
  items,
  activeIndex,
  globalOffset,
  onSelect,
}: {
  entity:      SearchResult['entity'];
  items:       SearchResult[];
  activeIndex: number;
  globalOffset: number;
  onSelect:    (item: SearchResult) => void;
}) {
  if (!items.length) return null;
  const cfg = ENTITY_CONFIG[entity];
  const Icon = cfg.icon;

  return (
    <div>
      <p className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-matrix-subtle/60 flex items-center gap-1.5">
        <Icon className={cn('w-3 h-3', cfg.color)} />
        {cfg.label}
      </p>
      {items.map((item, idx) => {
        const isActive = activeIndex === globalOffset + idx;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={cn(
              'w-full text-right px-3 py-2.5 flex items-center gap-3 transition-colors duration-100',
              isActive
                ? 'bg-matrix-cyan/10 text-matrix-cyan'
                : 'hover:bg-matrix-border/30 text-matrix-text',
            )}
          >
            <Icon className={cn('w-3.5 h-3.5 shrink-0', cfg.color)} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{item.title}</p>
              <p className="text-[10px] font-mono text-matrix-subtle truncate mt-0.5">{item.subtitle}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────
export function GlobalSearch() {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // ── Keyboard shortcut ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // FIX: searchApi.globalSearch() already returns the unwrapped envelope
  // data directly (request<T> in api.ts unwraps internally) — the old
  // `.then((r) => r.data.data)` had no `.data` to read on the result at
  // all, throwing a TypeError on every keystroke past 2 characters.
  //
  // Beyond that: the real shape (GlobalSearchResponse — confirmed against
  // search.service.js) groups raw Prisma records under `results.X.items`
  // with entity-specific fields (brand/model for inventory, name/phone
  // for customers, etc.) — it was never going to match this component's
  // SearchResponse (flat SearchResult[] per entity with unified
  // title/subtitle/href). There is no display-ready shape on the wire;
  // the `data` block right below builds one from the raw records.
  // Phase C.1 (5B): the query now runs against the debounced term —
  // a full global search per keystroke is expensive (4 entity
  // lookups server-side) and the old live wiring issued them with
  // zero backpressure.
  const debouncedQuery = useDebouncedValue(query);

  const { data: raw, isLoading } = useQuery<GlobalSearchResponse>({
    queryKey:  ['global-search', debouncedQuery],
    queryFn:   () => searchApi.globalSearch(debouncedQuery),
    enabled:   open && debouncedQuery.trim().length >= 2,
    staleTime: 10_000,
  });

  const data = useMemo<SearchResponse | undefined>(
    () => raw && {
      inventory: raw.results.inventory.items.map((i) => ({
        entity:   'inventory' as const,
        id:       i.id,
        title:    [i.brand, i.model].filter(Boolean).join(' ') || 'بدون اسم',
        subtitle: [i.vehicle_type, i.color].filter(Boolean).join(' • '),
      })),
      customers: raw.results.customers.items.map((c) => ({
        entity:   'customers' as const,
        id:       c.id,
        title:    c.name,
        subtitle: c.phone || c.national_id || '',
      })),
      suppliers: raw.results.suppliers.items.map((s) => ({
        entity:   'suppliers' as const,
        id:       s.id,
        title:    s.name,
        subtitle: s.phone || s.email || '',
      })),
      sales: raw.results.sales.items.map((s) => ({
        entity:   'sales' as const,
        id:       s.id,
        title:    s.invoice_number,
        subtitle: s.customer?.name || 'بدون عميل',
      })),
    },
    [raw]
  );

  const allResults = useMemo<SearchResult[]>(
    () => [
      ...(data?.inventory ?? []),
      ...(data?.customers ?? []),
      ...(data?.suppliers ?? []),
      ...(data?.sales     ?? []),
    ],
    [data]
  );

  // F6 — deep-link into the matching list page with the query prefilled.
  const hrefFor = useCallback(
    (entity: SearchResult['entity']) =>
      `${ROUTE_MAP[entity]}?search=${encodeURIComponent(query.trim())}`,
    [query]
  );

  const handleItemSelect = useCallback(
    (item: SearchResult) => {
      router.push(hrefFor(item.entity));
      setOpen(false);
      setQuery('');
    },
    [router, hrefFor]
  );

  // ── Arrow key navigation ─────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!allResults.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allResults.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && allResults[activeIndex]) {
        handleItemSelect(allResults[activeIndex]);
      }
    },
    [allResults, activeIndex, handleItemSelect],
  );

  // ── Offsets per group for active index tracking ──────────
  const invLen  = data?.inventory?.length ?? 0;
  const custLen = data?.customers?.length ?? 0;
  const suppLen = data?.suppliers?.length ?? 0;

  const hasResults = allResults.length > 0;
  const showEmpty  = open && query.trim().length >= 2 && !isLoading && !hasResults;

  return (
    <>
      {/* ── Trigger Button ─────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg',
          'border border-matrix-border/70 bg-matrix-dark/50',
          'text-matrix-subtle hover:border-matrix-cyan/40 hover:text-matrix-cyan',
          'transition-all duration-200 text-xs font-mono',
        )}
        title="Ctrl+K"
      >
        <Search className="w-3.5 h-3.5" />
        <span>بحث سريع</span>
        <kbd className="mr-1 px-1 py-0.5 rounded text-[9px] bg-matrix-border/60 text-matrix-subtle/60">
          ⌘K
        </kbd>
      </button>

      {/* Mobile icon only */}
      <button
        onClick={() => setOpen(true)}
        className="flex md:hidden items-center justify-center w-8 h-8 rounded-lg border border-matrix-border text-matrix-subtle hover:border-matrix-cyan hover:text-matrix-cyan transition-all"
      >
        <Search className="w-4 h-4" />
      </button>

      {/* ── Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{   opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0,   scale: 1    }}
              exit={{   opacity: 0, y: -20, scale: 0.97  }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'fixed top-20 left-1/2 -translate-x-1/2 z-50',
                'w-full max-w-lg matrix-panel border border-matrix-border',
                'shadow-[0_16px_60px_rgba(0,0,0,0.7)]',
                'overflow-hidden',
              )}
            >
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-matrix-border">
                {isLoading
                  ? <Loader2 className="w-4 h-4 text-matrix-cyan animate-spin shrink-0" />
                  : <Search  className="w-4 h-4 text-matrix-subtle shrink-0" />}
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="ابحث في المخزون، العملاء، الموردين، المبيعات..."
                  className="flex-1 bg-transparent text-sm text-matrix-text placeholder-matrix-subtle/60 outline-none font-body"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="text-matrix-subtle hover:text-matrix-red transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Results */}
              <div className="max-h-96 overflow-y-auto">
                {query.trim().length < 2 ? (
                  <p className="text-center text-[10px] font-mono text-matrix-subtle/50 py-8">
                    اكتب حرفين على الأقل للبحث
                  </p>
                ) : showEmpty ? (
                  <p className="text-center text-[10px] font-mono text-matrix-subtle/50 py-8">
                    لا نتائج لـ &quot;{query}&quot;
                  </p>
                ) : (
                  <>
                    <ResultGroup entity="inventory" items={data?.inventory ?? []}
                      activeIndex={activeIndex} globalOffset={0}
                      onSelect={handleItemSelect} />
                    <ResultGroup entity="customers" items={data?.customers ?? []}
                      activeIndex={activeIndex} globalOffset={invLen}
                      onSelect={handleItemSelect} />
                    <ResultGroup entity="suppliers" items={data?.suppliers ?? []}
                      activeIndex={activeIndex} globalOffset={invLen + custLen}
                      onSelect={handleItemSelect} />
                    <ResultGroup entity="sales"     items={data?.sales ?? []}
                      activeIndex={activeIndex} globalOffset={invLen + custLen + suppLen}
                      onSelect={handleItemSelect} />
                  </>
                )}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2 border-t border-matrix-border/50 flex items-center gap-4 text-[9px] font-mono text-matrix-subtle/40">
                <span>↑↓ تنقل</span>
                <span>↵ فتح</span>
                <span>Esc إغلاق</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
