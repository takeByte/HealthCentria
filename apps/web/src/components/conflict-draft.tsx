import { useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { ApiError } from '../lib/api';

/**
 * "Keep my draft" conflict handling for clinical forms.
 *
 * When someone else saved first, the server refuses the save (409) and sends back the
 * latest copy of the record. These pieces make sure nothing the user typed is lost:
 *
 *  1. The form is NOT touched. The user's text stays on screen.
 *  2. <ConflictNotice> explains what happened. Saving is paused until the user chooses
 *     "Load latest version", so they can never overwrite the other person's work by accident.
 *  3. After "Load latest version" the form shows the latest data and <LostDraft> keeps the
 *     user's own text next to it (with Copy buttons) so they can re-apply what they need.
 */

export interface DraftItem {
  label: string;
  value: string;
}

/** The latest copy the server sent with a 409, or null when this error is not a conflict. */
export function conflictLatest<T>(err: unknown): { latest: T; version?: number; message: string } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const current = err.data?.current;
  if (!current || typeof current !== 'object') return null;
  const version = typeof err.data?.currentVersion === 'number' ? err.data.currentVersion : undefined;
  return { latest: current as T, version, message: err.message };
}

/** Keeps only the fields the user actually typed something into. */
export function nonEmptyDraft(items: DraftItem[]): DraftItem[] {
  return items.filter((item) => item.value.trim() !== '');
}

export function ConflictNotice({
  version,
  updatedBy,
  onLoadLatest,
}: {
  version?: number;
  updatedBy?: string;
  onLoadLatest: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20"
    >
      <span>
        {updatedBy ? `${updatedBy} saved` : 'Someone else saved'} a newer version
        {version !== undefined ? ` (now v${version})` : ''} first. <strong>Your changes were not saved</strong> and are
        still on screen. Saving is paused so nothing gets overwritten.
      </span>
      <button
        type="button"
        onClick={onLoadLatest}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/30 transition-colors hover:bg-amber-100"
      >
        <RefreshCw size={14} aria-hidden /> Load latest version
      </button>
    </div>
  );
}

/** The user's own unsaved text, kept after "Load latest version" so they can copy from it. */
export function LostDraft({ items, onDismiss }: { items: DraftItem[]; onDismiss: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(item: DraftItem) {
    try {
      await navigator.clipboard.writeText(item.value);
      setCopied(item.label);
      window.setTimeout(() => setCopied((c) => (c === item.label ? null : c)), 1500);
    } catch {
      // Clipboard blocked: the text is still selectable on screen.
    }
  }

  if (items.length === 0) return null;
  return (
    <section
      aria-label="Your unsaved text"
      className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] leading-5 text-slate-800 ring-1 ring-inset ring-slate-300/70"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">Your unsaved text (not part of the latest version)</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss your unsaved text"
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <dl className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500">{item.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words select-text">{item.value}</dd>
            </div>
            <button
              type="button"
              onClick={() => void copy(item)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
            >
              <Copy size={12} aria-hidden /> {copied === item.label ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </dl>
    </section>
  );
}
