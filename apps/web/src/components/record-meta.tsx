import { Clock3, History } from 'lucide-react';
import { cn } from '../lib/utils';

/** One date format for every record, so timestamps never drift between screens. */
export function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Short form for dense tables: no time when it is the same calendar day. */
export function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** True once a record has actually been edited after it was created. */
function wasEdited(createdAt?: string | null, updatedAt?: string | null): boolean {
  if (!createdAt || !updatedAt) return false;
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  // A couple of seconds of write skew is not an edit.
  return updated - created > 2000;
}

/**
 * "Created … · Updated … by …" for any record.
 *
 * Staff and admin screens pass the editor's name; patient-facing screens pass
 * only timestamps because the editor is always center staff.
 */
export function RecordMeta({
  createdAt,
  updatedAt,
  updatedByName,
  className,
  icon: Icon = Clock3,
}: {
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
  className?: string;
  icon?: typeof Clock3;
}) {
  const created = formatDateTime(createdAt);
  const updated = formatDateTime(updatedAt);
  const edited = wasEdited(createdAt, updatedAt);
  if (!created && !updated) return null;

  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] leading-5 text-slate-500',
        className,
      )}
    >
      <Icon size={12} aria-hidden className="shrink-0 text-slate-400" />
      {created && <span>Created {created}</span>}
      {created && edited && <span aria-hidden className="text-slate-300">·</span>}
      {edited && (
        <span>
          Updated {updated}
          {updatedByName ? ` by ${updatedByName}` : ''}
        </span>
      )}
    </p>
  );
}

/** The compact badge used in headers where only "last touched" matters. */
export function UpdatedStamp({
  updatedAt,
  updatedByName,
  className,
}: {
  updatedAt?: string | null;
  updatedByName?: string | null;
  className?: string;
}) {
  const updated = formatDateTime(updatedAt);
  if (!updated) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600',
        className,
      )}
    >
      <History size={11} aria-hidden />
      {updatedByName ? `${updatedByName} · ${updated}` : updated}
    </span>
  );
}
