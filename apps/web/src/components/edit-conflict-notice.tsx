import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';
import { onEditConflict, type EditConflict } from '../lib/edit-conflict';

/**
 * Shown when the server refused a save because the record changed while this
 * screen was open. Reloading is the only safe move: the draft on screen was
 * written against a version that no longer exists.
 *
 * Mounted once in the root layout, so every form gets it without wiring.
 */
export function EditConflictNotice() {
  const [conflict, setConflict] = useState<EditConflict | null>(null);

  useEffect(() => onEditConflict(setConflict), []);

  useEffect(() => {
    if (!conflict) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConflict(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [conflict]);

  return (
    <AnimatePresence>
      {conflict && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          role="alert"
          aria-live="assertive"
          className="fixed bottom-4 left-4 right-4 z-[70] flex flex-col gap-3 rounded-xl border border-[var(--palette-line)] bg-white p-4 shadow-[0_16px_40px_-20px_rgba(15,60,90,0.5)] sm:left-auto sm:right-4 sm:w-[380px]"
        >
          <div className="flex items-start gap-2.5">
            <p className="flex-1 text-[13px] leading-5 text-[#0f172a]">{conflict.message}</p>
            <button
              type="button"
              onClick={() => setConflict(null)}
              aria-label="Dismiss"
              className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#475569] transition-colors hover:bg-[var(--palette-veil)]"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand-deep-strong)] px-4 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 active:scale-[0.98]"
            >
              <RefreshCw size={15} aria-hidden />
              Reload latest
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
