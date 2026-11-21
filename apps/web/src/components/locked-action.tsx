import { Lock } from 'lucide-react';

/**
 * An action button whose record is held by another editor.
 *
 * Deliberately focusable: a native `disabled` button cannot receive focus, so
 * keyboard and screen-reader users would never hear why it does not open. The
 * visible lock notice is the description; the click is inert because there is
 * nothing safe to do.
 */
export function LockedActionButton({
  label,
  className,
  describedBy,
  heldBy,
  mine,
}: {
  label: string;
  className: string;
  describedBy: string;
  heldBy: string;
  mine: boolean;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-describedby={describedBy}
      title={mine ? 'Already open in another tab' : `Locked by ${heldBy}`}
      className={`${className} cursor-not-allowed opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-deep)]/30`}
    >
      <Lock size={14} aria-hidden />
      {label}
    </button>
  );
}
