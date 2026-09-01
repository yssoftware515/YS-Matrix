'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const sizeMap = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' };

interface ModalProps {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-50 bg-matrix-black/80 backdrop-blur-sm" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={cn('relative w-full matrix-panel overflow-hidden', sizeMap[size])}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-0 start-0 w-6 h-6 border-t border-s border-matrix-cyan/40 rounded-ss-panel pointer-events-none" />
              <div className="absolute top-0 end-0 w-6 h-6 border-t border-e border-matrix-cyan/40 rounded-se-panel pointer-events-none" />
              <div className="absolute bottom-0 start-0 w-6 h-6 border-b border-s border-matrix-cyan/40 rounded-es-panel pointer-events-none" />
              <div className="absolute bottom-0 end-0 w-6 h-6 border-b border-e border-matrix-cyan/40 rounded-ee-panel pointer-events-none" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-matrix-border">
                <h2 className="font-display text-sm font-semibold tracking-widest text-matrix-text uppercase">{title}</h2>
                <button onClick={onClose} className="flex items-center justify-center w-7 h-7 rounded-lg border border-matrix-border text-matrix-subtle hover:text-matrix-red hover:border-matrix-red transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-5 overflow-y-auto max-h-[70vh]">{children}</div>
              {footer && <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-matrix-border">{footer}</div>}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
