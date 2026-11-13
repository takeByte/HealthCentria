import { useState, type FormEvent, type ReactNode } from 'react';
import { Droplet, HeartPulse, LoaderCircle, Pencil, Pill, Plus, Syringe, TriangleAlert, X } from 'lucide-react';
import {
  CardHeading,
  chipButton,
  fieldLabel,
  inputClass,
  panel,
  primaryButton,
  secondaryButton,
  selectClass,
} from './app-ui';
import { formatDateTime } from './record-meta';
import { ApiError, BLOOD_TYPES, type Immunization, type MedicalProfile, type MedicalProfileInput } from '../lib/api';
import { cn } from '../lib/utils';

/** True when nothing has been recorded yet. */
export function isMedicalEmpty(m: MedicalProfile): boolean {
  return (
    !m.bloodType &&
    m.allergies.length === 0 &&
    m.conditions.length === 0 &&
    m.medications.length === 0 &&
    m.immunizations.length === 0
  );
}

function formatVaccineDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

const labelClass = 'flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-500';

function Chips({ items, tone }: { items: string[]; tone?: 'alert' }) {
  if (items.length === 0) return <p className="mt-1.5 text-[13px] text-slate-500">None recorded</p>;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            'rounded-lg px-2.5 py-1 text-[12.5px] font-medium ring-1 ring-inset',
            tone === 'alert'
              ? 'bg-red-50 text-red-800 ring-red-600/20'
              : 'bg-[#edf3f8] text-slate-700 ring-[#cbd7e2]/70',
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Read-only medical profile. Shared by the patient page and the staff chart. */
export function MedicalProfileView({ medical }: { medical: MedicalProfile }) {
  return (
    <dl className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className={labelClass}>
            <Droplet size={12} aria-hidden /> Blood type
          </dt>
          <dd className="mt-1.5 text-[13.5px] font-semibold text-slate-900">{medical.bloodType || 'Not recorded'}</dd>
        </div>
        <div>
          <dt className={labelClass}>
            <TriangleAlert size={12} aria-hidden /> Allergies
          </dt>
          <dd>
            <Chips items={medical.allergies} tone="alert" />
          </dd>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className={labelClass}>
            <HeartPulse size={12} aria-hidden /> Conditions
          </dt>
          <dd>
            <Chips items={medical.conditions} />
          </dd>
        </div>
        <div>
          <dt className={labelClass}>
            <Pill size={12} aria-hidden /> Current medications
          </dt>
          <dd>
            <Chips items={medical.medications} />
          </dd>
        </div>
      </div>
      <div>
        <dt className={labelClass}>
          <Syringe size={12} aria-hidden /> Immunizations
        </dt>
        <dd>
          {medical.immunizations.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-slate-500">None recorded</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-slate-200/70 rounded-xl border border-slate-200/70">
              {medical.immunizations.map((v, i) => (
                <li key={`${v.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                  <span className="text-[13px] font-medium text-slate-800">{v.name}</span>
                  <span className="text-[12.5px] text-slate-500">
                    {[formatVaccineDate(v.date), v.note].filter(Boolean).join(' · ') || 'Date not recorded'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Chip list with an input. Enter, comma, the Add button, or leaving the field adds the entry. */
function TagField({
  id,
  label,
  items,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const value = draft.trim();
    setDraft('');
    if (!value) return;
    if (items.some((i) => i.toLowerCase() === value.toLowerCase())) return;
    onChange([...items, value]);
  }

  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          maxLength={120}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          className={inputClass}
        />
        <button type="button" onClick={commit} disabled={disabled || !draft.trim()} className={chipButton + ' h-11 shrink-0'}>
          <Plus size={14} aria-hidden /> Add
        </button>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-lg bg-[#edf3f8] py-1 pl-2.5 pr-1 text-[12.5px] font-medium text-slate-700 ring-1 ring-inset ring-[#cbd7e2]/70"
            >
              {item}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(items.filter((i) => i !== item))}
                aria-label={`Remove ${item}`}
                className="flex size-5 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MedicalEditor({
  medical,
  onCancel,
  onSave,
}: {
  medical: MedicalProfile;
  onCancel: () => void;
  onSave: (input: MedicalProfileInput) => Promise<void>;
}) {
  const [bloodType, setBloodType] = useState<MedicalProfileInput['bloodType']>(medical.bloodType);
  const [allergies, setAllergies] = useState(medical.allergies);
  const [conditions, setConditions] = useState(medical.conditions);
  const [medications, setMedications] = useState(medical.medications);
  const [immunizations, setImmunizations] = useState<Immunization[]>(medical.immunizations);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateVaccine(index: number, patch: Partial<Immunization>) {
    setImmunizations((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (immunizations.some((v) => !v.name.trim())) {
      setError('Each vaccine needs a name. Remove the empty rows or fill them in.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave({
        bloodType,
        allergies,
        conditions,
        medications,
        immunizations: immunizations.map((v) => ({ name: v.name.trim(), date: v.date, note: v.note.trim() })),
      });
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError) {
        const first = err.errors ? Object.values(err.errors).flat()[0] : undefined;
        setError(first ?? err.message);
      } else {
        setError('Could not save the medical profile. Try again.');
      }
    }
  }

  const todayMax = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Edit medical profile">
      <div className="max-w-[12rem]">
        <label htmlFor="mp-blood" className={fieldLabel}>
          Blood type
        </label>
        <select
          id="mp-blood"
          value={bloodType}
          disabled={pending}
          onChange={(e) => setBloodType(e.target.value as MedicalProfileInput['bloodType'])}
          className={selectClass}
        >
          <option value="">Not recorded</option>
          {BLOOD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <TagField id="mp-allergies" label="Allergies" items={allergies} onChange={setAllergies} placeholder="e.g. Penicillin" disabled={pending} />
      <TagField id="mp-conditions" label="Conditions" items={conditions} onChange={setConditions} placeholder="e.g. Hypertension" disabled={pending} />
      <TagField id="mp-meds" label="Current medications" items={medications} onChange={setMedications} placeholder="e.g. Losartan 50 mg daily" disabled={pending} />

      <div>
        <span className={fieldLabel}>Immunizations</span>
        <div className="space-y-2">
          {immunizations.map((v, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_0.9fr_1.2fr_auto]">
              <input
                aria-label={`Vaccine ${i + 1} name`}
                value={v.name}
                maxLength={120}
                disabled={pending}
                placeholder="Vaccine"
                onChange={(e) => updateVaccine(i, { name: e.target.value })}
                className={inputClass}
              />
              <input
                aria-label={`Vaccine ${i + 1} date`}
                type="date"
                max={todayMax}
                value={v.date}
                disabled={pending}
                onChange={(e) => updateVaccine(i, { date: e.target.value })}
                className={inputClass}
              />
              <input
                aria-label={`Vaccine ${i + 1} note`}
                value={v.note}
                maxLength={200}
                disabled={pending}
                placeholder="Note (dose, batch…)"
                onChange={(e) => updateVaccine(i, { note: e.target.value })}
                className={inputClass}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => setImmunizations((rows) => rows.filter((_, idx) => idx !== i))}
                aria-label={`Remove vaccine ${i + 1}`}
                className={chipButton + ' h-11 w-11 shrink-0 px-0'}
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={pending || immunizations.length >= 50}
          onClick={() => setImmunizations((rows) => [...rows, { name: '', date: '', note: '' }])}
          className={chipButton + ' mt-2'}
        >
          <Plus size={14} aria-hidden /> Add vaccine
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
          {pending ? 'Saving…' : 'Save medical profile'}
        </button>
      </div>
    </form>
  );
}

/**
 * Medical profile card. Pass `onSave` to let staff edit it; omit it for the
 * patient's read-only view.
 */
export function MedicalProfileCard({
  medical,
  onSave,
  note,
  className,
  actions,
}: {
  medical: MedicalProfile;
  onSave?: (input: MedicalProfileInput) => Promise<void>;
  note?: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section className={cn(panel, className)} aria-label="Medical profile">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <CardHeading
            title="Medical profile"
            description={
              medical.recordedAt
                ? `Last updated ${formatDateTime(medical.recordedAt)}`
                : 'Allergies, conditions, medications and vaccines on file.'
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onSave && !editing && (
            <button type="button" onClick={() => setEditing(true)} className={chipButton}>
              <Pencil size={14} aria-hidden /> {isMedicalEmpty(medical) ? 'Add details' : 'Edit'}
            </button>
          )}
        </div>
      </div>
      {note && <div className="mt-3">{note}</div>}
      <div className="mt-4 border-t border-slate-200/70 pt-4">
        {editing && onSave ? (
          <MedicalEditor
            medical={medical}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              await onSave(input);
              setEditing(false);
            }}
          />
        ) : (
          <MedicalProfileView medical={medical} />
        )}
      </div>
    </section>
  );
}
