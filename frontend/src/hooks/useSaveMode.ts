import { useState, useRef, useCallback, useEffect } from 'react';

type SaveMode   = 'manual' | 'auto';
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface Options { autoSaveDelay?: number; onSave: (data: unknown) => Promise<void>; }

export function useSaveMode({ autoSaveDelay = 1500, onSave }: Options) {
  const [mode,    setMode]    = useState<SaveMode>('manual');
  const [status,  setStatus]  = useState<SaveStatus>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const pending = useRef<unknown>(null);
  const timer   = useRef<NodeJS.Timeout | null>(null);

  const markDirty = useCallback((data: unknown) => {
    pending.current = data;
    setIsDirty(true);
    setStatus('dirty');
    if (mode === 'auto') {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try { setStatus('saving'); await onSave(data); setStatus('saved'); setIsDirty(false); setTimeout(() => setStatus('idle'), 2000); }
        catch { setStatus('error'); }
      }, autoSaveDelay);
    }
  }, [mode, autoSaveDelay, onSave]);

  const save = useCallback(async () => {
    if (!isDirty || !pending.current) return;
    try { setStatus('saving'); await onSave(pending.current); setStatus('saved'); setIsDirty(false); setTimeout(() => setStatus('idle'), 2000); }
    catch { setStatus('error'); }
  }, [isDirty, onSave]);

  const discard = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setIsDirty(false); setStatus('idle'); pending.current = null;
  }, []);

  const toggleMode = useCallback(() => { setMode((m) => m === 'manual' ? 'auto' : 'manual'); discard(); }, [discard]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (isDirty && mode === 'manual') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty, mode]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { mode, status, isDirty, save, discard, toggleMode, markDirty };
}
