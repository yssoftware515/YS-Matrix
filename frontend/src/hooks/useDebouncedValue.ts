'use client';

// Phase C.1 (5B) — the shared debounce primitive for search inputs.
// Every list page's search box was issuing a query per keystroke;
// 250ms is short enough to feel instant, long enough to absorb a
// typing burst.
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}