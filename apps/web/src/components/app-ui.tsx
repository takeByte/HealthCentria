import type { ComponentType, ReactNode } from 'react';
import type { Appointment } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Shared building blocks for the signed-in app — patient, staff and admin.
 *
 * Everything here is deliberately tiny: the point is that spacing, radii, type
 * and colour are decided once, so thirteen screens can't drift apart.
 *
 * The system is a quiet clinic editorial: paper-white cards on a misty page,
 * blue actions, one display face for headings, Geist for everything else.
 */

/** The surface every page is built from: white paper, hairline cool edge. */
export const panel = 'app-card p-5 sm:p-6';

/** Full-width action — brand blue, soft lift, one per screen. */
export const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[var(--brand-bright)] to-[var(--brand-deep-strong)] px-5 text-sm font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_10px_22px_-12px_rgba(31,85,168,0.65)] transition-[transform,filter] hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-60';

/** The quieter companion action: paper surface, hairline edge. */
export const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#dde8f0] bg-white px-5 text-sm font-semibold text-[#1e293b] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#c6d8e4] hover:bg-[#f6fafd] active:scale-[0.98] disabled:opacity-60';

/** Small pill action used inside cards and rows. */
export const chipButton =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#dde8f0] bg-white px-3 text-[13px] font-semibold text-[#1e293b] transition-colors hover:border-[#c6d8e4] hover:bg-[#f6fafd] active:scale-[0.97]';

/** Destructive twin of the chip button — cancels, declines, deactivates. */
export const dangerChipButton =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-[13px] font-semibold text-destructive transition-colors hover:border-red-300 hover:bg-red-50 active:scale-[0.97] disabled:opacity-60';

export const cardPadding = 'p-5 sm:p-6';

/* ---------------------------------------------------------------- forms --- */

export const fieldLabel = 'mb-1.5 block text-[12.5px] font-semibold text-[#334155]';

export const inputClass =
  'h-11 w-full rounded-xl border border-[#dde8f0] bg-white px-3 text-[13.5px] text-[#0f172a] outline-none transition-colors placeholder:text-[#94a3b8] hover:border-[#cbd9e5] focus:border-[var(--brand-deep)] focus:ring-2 focus:ring-[var(--brand-deep)]/20';

export const selectClass = inputClass;

export const textareaClass =
  'w-full rounded-xl border border-[#dde8f0] bg-white px-3 py-2.5 text-[13.5px] leading-6 text-[#0f172a] outline-none transition-colors placeholder:text-[#94a3b8] hover:border-[#cbd9e5] focus:border-[var(--brand-deep)] focus:ring-2 focus:ring-[var(--brand-deep)]/20';

/* ----------------------------------------------------------- status pills --- */

const STATUS_STYLE: Record<Appointment['status'], { pill: string; dot: string }> = {
  pending: { pill: 'bg-[#fdf5e4] text-[#8a5a10] ring-[#e2c07a]/50', dot: 'bg-[#c99a3d]' },
  confirmed: { pill: 'bg-[var(--brand-tint)] text-[var(--brand-deep-strong)] ring-[var(--brand-deep)]/20', dot: 'bg-[var(--brand-deep)]' },
  declined: { pill: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  completed: { pill: 'bg-[#edf3f8] text-[#475569] ring-[#cbd7e2]/70', dot: 'bg-[#64748b]' },
  cancelled: { pill: 'bg-[#f2f6fa] text-[#64748b] ring-[#d5dee8]/80', dot: 'bg-[#94a3b8]' },
};

export function StatusChip({ status, className }: { status: Appointment['status']; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ring-1 ring-inset',
        STATUS_STYLE[status].pill,
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', STATUS_STYLE[status].dot)} />
      {status}
    </span>
  );
}

const TONE_STYLE = {
  teal: 'bg-[var(--brand-tint)] text-[var(--brand-deep-strong)] ring-[var(--brand-deep)]/20',
  sky: 'bg-sky-600/10 text-sky-800 ring-sky-600/20',
  amber: 'bg-[#fdf5e4] text-[#8a5a10] ring-[#e2c07a]/50',
  red: 'bg-red-500/10 text-red-700 ring-red-600/20',
  slate: 'bg-[#edf3f8] text-[#475569] ring-[#cbd7e2]/70',
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
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-[radial-gradient(80%_140%_at_12%_-40%,rgba(22,149,222,0.16),transparent_70%)]"
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--brand-deep)]">
              <span aria-hidden className="h-px w-5 bg-[var(--brand-deep)]/45" />
              {eyebrow}
            </p>
          )}
          <h2
            id="page-hero-title"
            className="mt-2 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--brand-ink-dark)] sm:text-[32px]"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-[#475569]">{description}</p>
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
        <h2 className="font-display text-[15.5px] font-semibold tracking-[-0.015em] text-[var(--brand-ink-dark)]">
          {title}
        </h2>
        {description && <p className="mt-1 text-[12.5px] leading-5 text-[#64748b]">{description}</p>}
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
  className,
}: {
  icon: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'teal' | 'amber' | 'slate' | 'sky';
  className?: string;
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-[#fdf5e4] text-[#a4761a] ring-[#e2c07a]/45'
      : tone === 'slate'
        ? 'bg-[#edf3f8] text-[#475569] ring-[#cfdbe5]/70'
        : tone === 'sky'
          ? 'bg-[#e9f3fb] text-[#2a6f9e] ring-[#bcd8ea]/60'
          : 'bg-[var(--brand-chip)] text-[var(--brand-deep)] ring-[var(--brand-deep)]/15';

  return (
    <div
      className={cn(
        'app-card group relative overflow-hidden p-4.5 transition-shadow duration-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.05),0_22px_46px_-32px_rgba(15,23,42,0.42)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
          {label}
        </p>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-[0.7rem] ring-1 ring-inset',
            toneClass,
          )}
        >
          <Icon size={17} aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.035em] text-[var(--brand-ink-dark)]">
        {value}
      </p>
      {hint && <p className="mt-1.5 truncate text-[11.5px] text-[#64748b]">{hint}</p>}
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
      className={cn('flex shrink-0 rounded-xl bg-[#edf4f8] p-1 ring-1 ring-inset ring-[#e1e9f1]', className)}
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
                ? 'bg-white text-[var(--brand-ink-dark)] shadow-[0_1px_2px_rgba(15,23,42,0.1),0_4px_10px_-6px_rgba(15,23,42,0.28)]'
                : 'text-[#64748b] hover:text-[#1e293b]',
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
        'rounded-xl border border-dashed border-[#d3e0ea] bg-[#f9fcfe] px-4 py-3.5 text-[13px] leading-5 text-[#64748b]',
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

/** Brand-blue confirmation, the counterpart to InlineNotice. */
export function SuccessNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl bg-[var(--brand-tint)] px-4 py-3 text-[13px] leading-5 text-[var(--brand-ink)] ring-1 ring-inset ring-[var(--brand-deep)]/15',
        className,
      )}
    >
      {children}
    </div>
  );
}
