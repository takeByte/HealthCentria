import type { ComponentType, ReactNode } from 'react';
import type { Appointment } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Shared building blocks for the signed-in app — patient, staff and admin.
 *
 * Everything here is deliberately tiny: the point is that spacing, radii, type
 * and colour are decided once, so thirteen screens can't drift apart.
 */

/** The surface every page is built from: translucent white, hairline edge. */
export const panel = 'app-card p-5 sm:p-6';

/** Full-width gradient action — one per screen, same shape as the login button. */
export const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-blue-600 px-5 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(13,148,136,0.7)] transition-transform active:scale-[0.97] disabled:opacity-60';

/** The quieter companion action: white surface, hairline border. */
export const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60';

/** Small pill action used inside cards and rows. */
export const chipButton =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]';

/** Destructive twin of the chip button — cancels, declines, deactivates. */
export const dangerChipButton =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[13px] font-semibold text-destructive transition-colors hover:border-red-300 hover:bg-red-50 active:scale-[0.97] disabled:opacity-60';

export const cardPadding = 'p-5 sm:p-6';

/* ---------------------------------------------------------------- forms --- */

export const fieldLabel = 'mb-1.5 block text-[12.5px] font-semibold text-slate-700';

export const inputClass =
  'h-11 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-[13.5px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25';

export const selectClass = inputClass;

export const textareaClass =
  'w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-[13.5px] leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25';

/* ----------------------------------------------------------- status pills --- */

const STATUS_STYLE: Record<Appointment['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  declined: 'bg-red-50 text-red-700 ring-red-600/20',
  completed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
};

export function StatusChip({ status, className }: { status: Appointment['status']; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ring-1 ring-inset',
        STATUS_STYLE[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

const TONE_STYLE = {
  teal: 'bg-teal-600/10 text-teal-800 ring-teal-600/20',
  sky: 'bg-sky-600/10 text-sky-800 ring-sky-600/20',
  amber: 'bg-amber-500/10 text-amber-800 ring-amber-600/25',
  red: 'bg-red-500/10 text-red-700 ring-red-600/20',
  slate: 'bg-slate-500/10 text-slate-600 ring-slate-500/20',
} as const;

export type PillTone = keyof typeof TONE_STYLE;

/** Neutral-ish capsule for states that aren't appointment statuses (active, admin, …). */
export function StatusPill({
  tone = 'slate',
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ring-1 ring-inset',
        TONE_STYLE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- structure --- */

/**
 * The page-level lead used on the dashboards. It mirrors the patient greeting
 * card: one warm surface, an eyebrow naming today's context, a clear headline
 * and a single primary next step.
 */
export function PageHero({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="page-hero-title"
      className={cn('app-card relative isolate overflow-hidden p-5 sm:p-7', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 -z-10 size-64 rounded-full bg-teal-300/15 blur-3xl"
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-teal-700">{eyebrow}</p>
          )}
          <h2
            id="page-hero-title"
            className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-[-0.025em] text-slate-900 sm:text-[30px]"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-6 text-slate-600">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function CardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-5 text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A number, a label and one line of context. Used in a row of three or four. */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'teal',
}: {
  icon: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'teal' | 'amber' | 'slate' | 'sky';
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-700'
      : tone === 'slate'
        ? 'bg-slate-100 text-slate-600'
        : tone === 'sky'
          ? 'bg-sky-50 text-sky-700'
          : 'bg-teal-600/10 text-teal-700';

  return (
    <div className="app-card flex items-center gap-3.5 p-4">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', toneClass)}>
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <p className="font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-slate-900">
          {value}
        </p>
        {hint && <p className="mt-0.5 truncate text-[11.5px] text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

/** iOS-style segmented control: one quiet track, the selected item lifted. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ key: T; label: string; icon?: ComponentType<{ size?: number | string }> }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex shrink-0 rounded-xl bg-slate-100/80 p-1', className)}
    >
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={value === o.key}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold transition-all duration-150 active:scale-[0.97]',
              value === o.key
                ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,60,90,0.12)]'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {Icon && <Icon size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Empty and loading copy share one shape so a page never jumps when data lands. */
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'rounded-xl border border-dashed border-slate-300/70 bg-white/40 px-4 py-3.5 text-[13px] leading-5 text-slate-600',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function InlineNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn('rounded-xl bg-destructive/10 px-4 py-3 text-[13px] font-medium text-destructive', className)}
    >
      {children}
    </p>
  );
}

/** Teal confirmation, the counterpart to InlineNotice. */
export function SuccessNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl bg-teal-600/8 px-4 py-3 text-[13px] leading-5 text-teal-900 ring-1 ring-inset ring-teal-600/15',
        className,
      )}
    >
      {children}
    </div>
  );
}
