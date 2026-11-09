import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { CardHeading, dangerChipButton, fieldLabel, inputClass, panel, secondaryButton } from './app-ui';
import { PinCancelled, type WithPin } from './super-pin';
import { ApiError, deletePatientAccount } from '../lib/api';
import { cn } from '../lib/utils';

const destructiveButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-[0_6px_18px_-8px_rgba(220,38,38,0.7)] transition-transform active:scale-[0.97] disabled:opacity-60';

/** One-time message shown on the patient list after an account is deleted. */
export const PATIENTS_FLASH_KEY = 'ekalinga.patients.flash';

function sameName(a: string, b: string) {
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * Admin-only "Delete account" section for the patient record. Confirming needs
 * the patient's name typed exactly, then the superadmin PIN; the server checks
 * both again.
 */
export function DeletePatientSection({
  patientId,
  patientName,
  withPin,
  onDeleted,
}: {
  patientId: string;
  /** Full name, or the email for accounts without a name yet. */
  patientName: string;
  withPin: WithPin;
  onDeleted: (result: { cancelled: number; keptVisits: number }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className={cn(panel, 'border-red-200/70')} aria-label="Delete patient account">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <CardHeading
              title="Delete patient account"
              description="Removes the login and all personal details. Upcoming appointments are cancelled. Past visits stay in reports as an anonymous “Deleted patient”, without diagnosis or notes. This cannot be undone."
            />
          </div>
          <button type="button" onClick={() => setOpen(true)} className={`${dangerChipButton} h-10 px-4`}>
            <Trash2 size={15} aria-hidden /> Delete account
          </button>
        </div>
      </section>

      {open && (
        <DeleteDialog
          patientId={patientId}
          patientName={patientName}
          withPin={withPin}
          onClose={() => setOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

function DeleteDialog({
  patientId,
  patientName,
  withPin,
  onClose,
  onDeleted,
}: {
  patientId: string;
  patientName: string;
  withPin: WithPin;
  onClose: () => void;
  onDeleted: (result: { cancelled: number; keptVisits: number }) => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = sameName(typed, patientName);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await withPin(`Permanently delete the account of ${patientName}.`, (pin) =>
        deletePatientAccount(patientId, typed.trim(), pin),
      );
      onDeleted({ cancelled: r.cancelled, keptVisits: r.keptVisits });
    } catch (err) {
      setBusy(false);
      if (err instanceof PinCancelled) return;
      setError(
        err instanceof ApiError
          ? (err.errors?.confirmName?.[0] ?? err.message)
          : 'Could not delete the account. Try again.',
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        <h2 id="delete-dialog-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900">
          Delete this patient account?
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] leading-5 text-slate-600">
          <li>Login, name, contact details, address and notifications are removed.</li>
          <li>Upcoming appointments are cancelled and removed from Google Calendar.</li>
          <li>Past visits stay in reports as &ldquo;Deleted patient&rdquo;, without diagnosis, prescription or notes.</li>
          <li>The Activity log keeps a record that the account was deleted, and by whom.</li>
        </ul>
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-800">
          This cannot be undone.
        </p>

        <label htmlFor="confirm-patient-name" className={cn(fieldLabel, 'mt-4')}>
          Type <span className="font-bold text-slate-900">{patientName}</span> to confirm
        </label>
        <input
          ref={inputRef}
          id="confirm-patient-name"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          disabled={busy}
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] font-medium text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={!matches || busy} className={destructiveButton}>
            {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
