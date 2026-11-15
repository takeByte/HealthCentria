import { RefreshCw } from 'lucide-react';

/**
 * Shown on a screen where someone may be typing, when the server says the record
 * was changed elsewhere. It never replaces what is on screen by itself: the person
 * decides when to reload.
 */
export function LiveBanner({ stale, onReload }: { stale: boolean; onReload: () => void }) {
  if (!stale) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20"
    >
      <span>
        This record was updated by someone else. Nothing you are typing has been changed. Reload to see the latest.
      </span>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/30 transition-colors hover:bg-amber-100"
      >
        <RefreshCw size={14} aria-hidden /> Reload
      </button>
    </div>
  );
}
