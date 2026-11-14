import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LoaderCircle, MailCheck } from 'lucide-react';
import { fieldLabel, inputClass, primaryButton, secondaryButton } from './app-ui';
import { ApiError, cancelApprovalRequest, getApprovalStatus, withApprovalId } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * Superadmin PIN prompt, shared by Settings and other protected actions
 * (e.g. deleting a patient account). The server checks the PIN; this is only
 * the input. See server/src/middleware/requireSuperPin.js.
 *
 * Two layers: the PIN, then an email confirmation. A correct PIN makes the
 * server email the superadmin a link and answer APPROVAL_REQUIRED; the dialog
 * then waits (polling) and, once the superadmin confirms, replays the same
 * change with the approval id. The PIN is not kept for the replay.
 */

/** Thrown when the admin closes the PIN prompt; callers just stop quietly. */
export class PinCancelled extends Error {
  constructor() {
    super('PIN entry cancelled.');
    this.name = 'PinCancelled';
  }
}

export interface PinRequest {
  title: string;
  run: (pin: string) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** Errors that keep the dialog open and are shown inside it. */
const IN_DIALOG_CODES = [
  'PIN_INCORRECT',
  'PIN_LOCKED',
  'SU_PIN_NOT_SET',
  'SU_EMAIL_NOT_SET',
  'APPROVAL_EMAIL_FAILED',
  'APPROVAL_LIMIT',
  'APPROVAL_DENIED',
  'APPROVAL_EXPIRED',
  'APPROVAL_PENDING',
];

const POLL_MS = 2000;

interface WaitingApproval {
  id: string;
  expiresAt: number;
  sentTo: string;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Superadmin PIN prompt. The PIN lives only in this dialog's local state and is
 * sent with the change request itself (X-Super-Pin header). It is cleared after
 * every attempt and when the dialog closes, and is never saved anywhere.
 * Wrong PIN / lockout errors stay in the dialog; any other error closes it and
 * goes back to the card that asked, so existing error handling still applies.
 */
export function PinDialog({ request, onClose }: { request: PinRequest; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<WaitingApproval | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const replaying = useRef(false);

  const cancel = useCallback(() => {
    if (busy) return;
    setPin('');
    if (waiting) cancelApprovalRequest(waiting.id).catch(() => undefined);
    request.reject(new PinCancelled());
    onClose();
  }, [busy, onClose, request, waiting]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancel]);

  /** Back to the PIN step with a message (denied, expired, ...). */
  const backToPin = useCallback((message: string) => {
    replaying.current = false;
    setWaiting(null);
    setBusy(false);
    setError(message);
  }, []);

  // While waiting: tick the countdown and poll until the superadmin decides.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;

    const replay = async () => {
      if (replaying.current) return;
      replaying.current = true;
      setBusy(true);
      try {
        const result = await withApprovalId(waiting.id, () => request.run(''));
        request.resolve(result);
        onClose();
      } catch (err) {
        if (err instanceof ApiError && IN_DIALOG_CODES.includes(err.code ?? '')) {
          backToPin(err.message);
          return;
        }
        // Anything else (e.g. the setting failed validation) goes back to the
        // card that asked. The approval stays valid for a retry of the same change.
        request.reject(err);
        onClose();
      }
    };

    const poll = async () => {
      try {
        const { status } = await getApprovalStatus(waiting.id);
        if (stopped) return;
        if (status === 'approved') await replay();
        else if (status === 'denied') backToPin('The superadmin denied this change.');
        else if (status !== 'pending') backToPin('The confirmation expired or was cancelled. Enter the PIN to try again.');
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 404) {
          backToPin('The confirmation expired. Enter the PIN to try again.');
        }
        // Other errors (offline, server restarting): keep waiting and retry.
      }
    };

    const pollTimer = window.setInterval(poll, POLL_MS);
    const tickTimer = window.setInterval(() => setNow(Date.now()), 1000);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(pollTimer);
      window.clearInterval(tickTimer);
    };
  }, [waiting, request, onClose, backToPin]);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    const value = pin.trim();
    if (busy) return;
    if (!value) {
      setError('Enter the superadmin PIN.');
      return;
    }
    setBusy(true);
    setError(null);
    setPin('');
    try {
      const result = await request.run(value);
      request.resolve(result);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'APPROVAL_REQUIRED' && typeof err.data?.approvalId === 'string') {
        setNow(Date.now());
        setWaiting({
          id: err.data.approvalId,
          expiresAt: typeof err.data.expiresAt === 'number' ? err.data.expiresAt : Date.now() + 5 * 60 * 1000,
          sentTo: typeof err.data.sentTo === 'string' ? err.data.sentTo : 'the superadmin email',
        });
        setBusy(false);
        return;
      }
      if (err instanceof ApiError && IN_DIALOG_CODES.includes(err.code ?? '')) {
        setError(err.message);
        setBusy(false);
        inputRef.current?.focus();
        return;
      }
      request.reject(err);
      onClose();
    }
  }

  const remaining = waiting ? waiting.expiresAt - now : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <motion.form
        onSubmit={confirm}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-dialog-title"
        aria-describedby="pin-dialog-desc"
        className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        {waiting ? (
          <>
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#0f766e]/10 text-[#0f766e]">
              <MailCheck size={19} aria-hidden />
            </span>
            <h2
              id="pin-dialog-title"
              className="mt-3 font-display text-lg font-semibold tracking-[-0.02em] text-slate-900"
            >
              Confirm by email
            </h2>
            <p id="pin-dialog-desc" className="mt-1 text-[13px] leading-5 text-slate-600">
              PIN accepted. We emailed a confirmation link to{' '}
              <span className="font-medium text-slate-800">{waiting.sentTo}</span>. Open it and press Confirm. This
              change ({request.title.replace(/\.$/, '')}) applies automatically once you do.
            </p>
            <p
              role="status"
              aria-live="polite"
              className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] text-slate-700"
            >
              <LoaderCircle size={16} className="shrink-0 animate-spin text-[#0f766e]" aria-hidden />
              {busy
                ? 'Confirmed. Applying the change…'
                : remaining > 0
                  ? `Waiting for confirmation… link expires in ${formatRemaining(remaining)}`
                  : 'Link expired. Checking…'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={cancel} disabled={busy} className={secondaryButton}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#0f766e]/10 text-[#0f766e]">
              <KeyRound size={19} aria-hidden />
            </span>
            <h2
              id="pin-dialog-title"
              className="mt-3 font-display text-lg font-semibold tracking-[-0.02em] text-slate-900"
            >
              Enter superadmin PIN to confirm
            </h2>
            <p id="pin-dialog-desc" className="mt-1 text-[13px] leading-5 text-slate-600">
              {request.title}
            </p>
            <label htmlFor="super-pin" className={cn(fieldLabel, 'mt-4')}>
              Superadmin PIN
            </label>
            <input
              ref={inputRef}
              id="super-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'super-pin-error' : undefined}
              className={inputClass}
            />
            {error && (
              <p id="super-pin-error" role="alert" className="mt-2 text-[12.5px] font-medium leading-5 text-destructive">
                {error}
              </p>
            )}
            <p className="mt-2 text-[12px] leading-5 text-slate-500">
              After the PIN, a confirmation link is emailed to the superadmin.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={cancel} disabled={busy} className={secondaryButton}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={primaryButton}>
                {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </motion.form>
    </div>
  );
}

export type WithPin = <T,>(title: string, run: (pin: string) => Promise<T>) => Promise<T>;

/**
 * withPin(title, run) opens the prompt and resolves with run(pin)'s result once
 * the server accepts the PIN and the superadmin confirms by email; it rejects
 * with PinCancelled if the user closes it. Render `dialog` once in the page.
 */
export function useSuperPin(): { withPin: WithPin; dialog: ReactNode } {
  const [request, setRequest] = useState<PinRequest | null>(null);
  const withPin = useCallback<WithPin>(
    (title, run) =>
      new Promise((resolve, reject) => {
        setRequest({ title, run, resolve: resolve as (value: unknown) => void, reject });
      }),
    [],
  );
  const close = useCallback(() => setRequest(null), []);
  const dialog = request ? <PinDialog key={request.title} request={request} onClose={close} /> : null;
  return { withPin, dialog };
}
