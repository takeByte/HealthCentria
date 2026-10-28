import { useEffect } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { cn } from '../lib/utils';

export type ToastMessage = { tone: 'success' | 'error'; message: string };

/** The app's single transient notification, used by settings and profile flows. */
export function Toast({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] font-medium shadow-[0_16px_40px_-20px_rgba(15,60,90,0.5)] ring-1 ring-inset',
        toast.tone === 'success'
          ? 'bg-teal-50 text-teal-900 ring-teal-600/20'
          : 'bg-red-50 text-red-800 ring-red-600/20',
      )}
    >
      {toast.tone === 'success' ? (
        <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-teal-700" aria-hidden />
      ) : (
        <ShieldAlert size={17} className="mt-0.5 shrink-0 text-red-700" aria-hidden />
      )}
      <span className="leading-5">{toast.message}</span>
      <button
        type="button"
        onClick={onDone}
        aria-label="Dismiss notification"
        className="-mr-1 ml-1 rounded-md p-0.5 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100"
      >
        <X size={14} aria-hidden />
      </button>
    </motion.div>
  );
}
