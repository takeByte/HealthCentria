import { LiveBanner } from '../../components/live-banner';
import { useLiveSync } from '../../lib/realtime';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  StatusChip,
  fieldLabel,
  panel,
  primaryButton,
  secondaryButton,
  textareaClass,
} from '../../components/app-ui';
import { MedicalProfileCard } from '../../components/medical-profile';
import { RecordMeta } from '../../components/record-meta';
import { Toast, type ToastMessage } from '../../components/toast';
import { getSession } from '../../lib/auth';
import { flash } from '../../lib/flash';
import {
  ApiError,
  completeAppointment,
  getVisitContext,
  isFieldLocked,
  updateAppointmentRecord,
  updatePatientMedical,
  type MedicalProfileInput,
  type PatientDetail,
  type PatientVisit,
  type VisitContext,
  type VisitLockSection,
} from '../../lib/api';
import { isHeldByOther, useVisitLocks } from '../../lib/visit-lock';
import { getTodayService } from '../../lib/schedule';
import { sessionCan } from '../../lib/permissions';

export const Route = createFileRoute('/staff/visits/$appointmentId')({
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'appointments.manage')) throw redirect({ to: '/staff/dashboard' });
  },
  component: VisitPage,
});

function serviceName(v: { service: { id: string; name: string } | string }): string {
  return typeof v.service === 'object' ? v.service.name : 'Service';
}

/** Human names for the three lockable clinical sections. */
const SECTION_NAMES: Record<VisitLockSection, string> = {
  diagnosis: 'Diagnosis',
  prescription: 'Prescription',
  visitNotes: 'Visit Notes',
};

/** "A"; "A and B"; "A, B, and C". */
function listAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ageOf(birthdate: string): string {
  if (!birthdate) return '';
  const [y, m, d] = birthdate.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age >= 0 ? `${age} yrs` : '';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-slate-800">{value || '—'}</dd>
    </div>
  );
}

function VisitPage() {
  const session = getSession();
  const today = getTodayService();
  const { appointmentId } = Route.useParams();
  const navigate = useNavigate();
  const canEditMedical = sessionCan(session, 'patients.manage');

  const [ctx, setCtx] = useState<VisitContext | null>(null);
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [medicalEditing, setMedicalEditing] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCtx(null);
    getVisitContext(appointmentId)
      .then((r) => {
        if (cancelled) return;
        setCtx(r);
        setPatient(r.patient);
        setMedicalEditing(false);
        setDiagnosis(r.appointment.diagnosis);
        setPrescription(r.appointment.prescription);
        setVisitNotes(r.appointment.visitNotes);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this visit.');
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, reloadKey]);

  const appt = ctx?.appointment ?? null;
  const completing = appt?.status === 'confirmed';
  const editingDone = appt?.status === 'completed';
  const readOnly = appt !== null && !completing && !editingDone;

  // Pessimistic section locks: claimed as soon as this screen opens, so another
  // tab sees who is editing and cannot type into the same field.
  const sectionLocks = useVisitLocks(appointmentId, !!appt && !readOnly);
  const lockedByOther = (section: VisitLockSection) => isHeldByOther(sectionLocks.locks, section);
  const holderOf = (section: VisitLockSection) =>
    sectionLocks.locks?.[section]?.heldBy ?? 'Another staff member';
  // After a save, or once another editor's lease runs out, this tab holds
  // nothing. Typing claims the sections again so the screen stays protected.
  const ensureClaim = () => {
    if (!sectionLocks.holding) void sectionLocks.reclaim();
  };

  // A draft (clinical notes or the medical profile) is never replaced by a live
  // refresh; the version is quietly re-read when the form is still untouched.
  const formDirty =
    !!appt &&
    (diagnosis !== appt.diagnosis || prescription !== appt.prescription || visitNotes !== appt.visitNotes);
  const dirtyRef = useRef(formDirty || medicalEditing);
  dirtyRef.current = formDirty || medicalEditing;


  const refreshVisit = useCallback(async () => {
    // The same change may have released the other editor's section locks, so
    // refresh who is editing at the same time as the record itself.
    void sectionLocks.refresh();
    try {
      const r = await getVisitContext(appointmentId);
      if (dirtyRef.current) return;
      setCtx(r);
      setPatient(r.patient);
      setDiagnosis(r.appointment.diagnosis);
      setPrescription(r.appointment.prescription);
      setVisitNotes(r.appointment.visitNotes);
    } catch {
      // Best effort: the next push, focus or manual reload retries.
    }
  }, [appointmentId, sectionLocks.refresh]);

  const liveSync = useLiveSync({
    topics: ['patients', 'appointments'],
    dirty: dirtyRef.current,
    patientId: ctx?.patient.id,
    refresh: refreshVisit,
  });

  /**
   * Hand the sections back before leaving the screen, so the queue does not
   * briefly show this tab as the editor. Capped at 1 s: a slow release must not
   * trap the user on a saved screen; the lease cleans up if it never lands.
   */
  async function releaseBeforeLeaving() {
    let timer: number | undefined;
    try {
      await Promise.race([
        sectionLocks.release(),
        new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, 1_000);
        }),
      ]);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!appt) return;
    setFormError(null);
    const clinical = {
      diagnosis: diagnosis.trim(),
      prescription: prescription.trim(),
      visitNotes: visitNotes.trim(),
    };
    // Only send sections that actually changed, so an untouched section held by
    // somebody else does not block this save.
    const changed = Object.fromEntries(
      Object.entries(clinical).filter(([field, value]) => value !== (appt[field as VisitLockSection] ?? '')),
    ) as { diagnosis?: string; prescription?: string; visitNotes?: string };
    if (!completing && Object.keys(changed).length === 0) {
      // Nothing to write, but the button still means "done here": go back to
      // the queue and give the sections back, like a successful save.
      await releaseBeforeLeaving();
      flash('No changes to save.');
      void navigate({ to: '/staff/appointments' });
      return;
    }
    setSaving(true);
    try {
      if (completing) {
        await completeAppointment(appt.id, clinical, sectionLocks.owner);
        await releaseBeforeLeaving();
        flash('Visit completed and record saved.');
        void navigate({ to: '/staff/appointments' });
        return;
      }
      const saved = await updateAppointmentRecord(appt.id, changed, appt.version, sectionLocks.owner);
      // Keep the saved values and the new version, so this form is not "dirty"
      // against an older copy and a later save is not mistaken for a conflict.
      setCtx((c) =>
        c
          ? {
              ...c,
              appointment: {
                ...c.appointment,
                diagnosis: saved.appointment.diagnosis,
                prescription: saved.appointment.prescription,
                visitNotes: saved.appointment.visitNotes,
                version: saved.appointment.version,
                updatedAt: saved.appointment.updatedAt,
                updatedByName: saved.appointment.updatedByName,
              },
            }
          : c,
      );
      // Saving ends this editing session: hand the sections back so the other
      // editor's "being edited by" banner clears, and return to the queue so the
      // updated record is visible where the user came from.
      await releaseBeforeLeaving();
      flash('Visit record saved.');
      void navigate({ to: '/staff/appointments' });
      return;
    } catch (err) {
      if (isFieldLocked(err)) {
        setFormError(err.message);
        void sectionLocks.refresh();
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const history: PatientVisit[] = ctx?.visits ?? [];

  return (
    <>
      <DashboardShell
        title={completing ? 'Complete visit' : 'Visit record'}
        subtitle={patient ? `${patient.name} · ${appt ? serviceName(appt) : ''}` : 'Loading the visit'}
        roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
        userName={session?.name}
        userEmail={session?.email ?? ''}
        todayService={`${today.name} — ${today.detail}`}
        nav={opsNav(session?.role, session?.permissions)}
        notificationsTo="/staff/notifications"
      >
        <div>
          <Link to="/staff/appointments" className={`${secondaryButton} h-9 px-3.5 text-[13px]`}>
            <ArrowLeft size={15} aria-hidden /> Back to appointments
          </Link>
        </div>

        {error && (
          <div className="space-y-2">
            <InlineNotice>{error}</InlineNotice>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={`${secondaryButton} h-9 px-3.5 text-[13px]`}
            >
              Try again
            </button>
          </div>
        )}
        <LiveBanner
          stale={liveSync.stale}
          onReload={() => {
            liveSync.clear();
            // Full reload: drops any open draft (and its now-stale version).
            setReloadKey((k) => k + 1);
          }}
        />
        {!ctx && !error && <EmptyNote>Loading visit…</EmptyNote>}

        {ctx && appt && patient && (
          <div className="grid items-start gap-5 lg:grid-cols-5">
            {/* Left: this visit and its clinical record */}
            <div className="space-y-5 lg:col-span-3">
              <section className={panel} aria-label="Visit details">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-slate-900">
                      {serviceName(appt)}
                    </h2>
                    <p className="mt-0.5 text-[13px] text-slate-600">
                      {formatDay(appt.day)}
                      {appt.timePreference !== 'any' ? ` · ${appt.timePreference}` : ''}
                    </p>
                    <RecordMeta
                      createdAt={appt.createdAt}
                      updatedAt={appt.updatedAt}
                      updatedByName={appt.updatedByName}
                      className="mt-1"
                    />
                  </div>
                  <StatusChip status={appt.status} />
                </div>
                {appt.notes && (
                  <p className="mt-3 rounded-lg bg-slate-50/80 px-3 py-2 text-[12.5px] leading-5 text-slate-600">
                    <span className="font-semibold text-slate-700">Patient notes: </span>
                    {appt.notes}
                  </p>
                )}
              </section>

              <form onSubmit={handleSubmit} className={`${panel} space-y-4`} aria-label="Visit record">
                <CardHeading
                  title="Visit record"
                  description={
                    completing
                      ? 'Saved when you complete the visit, and visible to the patient.'
                      : editingDone
                        ? 'Correct the clinical notes of this completed visit.'
                        : 'This visit is not open for clinical notes.'
                  }
                />
                {readOnly && (
                  <InlineNotice>
                    Only confirmed visits can be completed. This visit is {appt.status}.
                  </InlineNotice>
                )}
                {!readOnly && sectionLocks.blockedSections.length > 0 && (
                  <InlineNotice>
                    {listAnd(sectionLocks.blockedSections.map((section) => SECTION_NAMES[section]))}{' '}
                    {sectionLocks.blockedSections.length === 1 ? 'is' : 'are'} currently being edited by{' '}
                    {listAnd([...new Set(sectionLocks.blockedSections.map(holderOf))])}. These sections are
                    read-only until the other user saves their changes, cancels editing, or the lock expires.{' '}
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="font-semibold underline underline-offset-2"
                    >
                      Reload this page
                    </button>
                  </InlineNotice>
                )}
                <div>
                  <label htmlFor="visit-diagnosis" className={fieldLabel}>Diagnosis</label>
                  <textarea
                    id="visit-diagnosis"
                    rows={4}
                    maxLength={1000}
                    value={diagnosis}
                    onChange={(e) => {
                      ensureClaim();
                      setDiagnosis(e.target.value);
                    }}
                    onFocus={ensureClaim}
                    disabled={readOnly || !sectionLocks.ready || lockedByOther('diagnosis')}
                    aria-describedby={lockedByOther('diagnosis') ? 'visit-diagnosis-lock' : undefined}
                    placeholder="e.g. Acute viral nasopharyngitis"
                    className={textareaClass}
                  />
                  {lockedByOther('diagnosis') && (
                    <p id="visit-diagnosis-lock" className="mt-1 text-[11.5px] font-medium text-amber-800">
                      {holderOf('diagnosis')} is editing this section.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="visit-prescription" className={fieldLabel}>Prescription</label>
                  <textarea
                    id="visit-prescription"
                    rows={4}
                    maxLength={1000}
                    value={prescription}
                    onChange={(e) => {
                      ensureClaim();
                      setPrescription(e.target.value);
                    }}
                    onFocus={ensureClaim}
                    disabled={readOnly || !sectionLocks.ready || lockedByOther('prescription')}
                    aria-describedby={lockedByOther('prescription') ? 'visit-prescription-lock' : undefined}
                    placeholder="e.g. Paracetamol 500mg every 6 hours for 3 days"
                    className={textareaClass}
                  />
                  {lockedByOther('prescription') && (
                    <p id="visit-prescription-lock" className="mt-1 text-[11.5px] font-medium text-amber-800">
                      {holderOf('prescription')} is editing this section.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="visit-notes" className={fieldLabel}>Visit notes</label>
                  <textarea
                    id="visit-notes"
                    rows={4}
                    maxLength={2000}
                    value={visitNotes}
                    onChange={(e) => {
                      ensureClaim();
                      setVisitNotes(e.target.value);
                    }}
                    onFocus={ensureClaim}
                    disabled={readOnly || !sectionLocks.ready || lockedByOther('visitNotes')}
                    aria-describedby={lockedByOther('visitNotes') ? 'visit-notes-lock' : undefined}
                    placeholder="Advice, follow-up instructions…"
                    className={textareaClass}
                  />
                  {lockedByOther('visitNotes') && (
                    <p id="visit-notes-lock" className="mt-1 text-[11.5px] font-medium text-amber-800">
                      {holderOf('visitNotes')} is editing this section.
                    </p>
                  )}
                </div>
                {formError && <InlineNotice>{formError}</InlineNotice>}
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className={`${primaryButton} h-10 px-5`}
                    >
                      {saving && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                      {completing ? 'Save & complete visit' : 'Save changes'}
                    </button>
                    <Link
                      to="/staff/appointments"
                      onClick={() => void sectionLocks.release()}
                      className={`${secondaryButton} h-10 px-5`}
                    >
                      Cancel
                    </Link>
                  </div>
                )}
              </form>
            </div>

            {/* Right: the patient, so the clinician has context while writing */}
            <div className="space-y-5 lg:col-span-2">
              <section className={panel} aria-label="Patient profile">
                <CardHeading
                  title={patient.name}
                  description={[ageOf(patient.birthdate), patient.sex].filter(Boolean).join(' · ') || 'Patient profile'}
                />
                {!patient.profileCompleted && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900">
                    This profile is incomplete. Missing details can be added from the patient record.
                  </p>
                )}
                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Row label="Contact" value={patient.contactNumber} />
                  <Row label="Birthdate" value={patient.birthdate} />
                  <div className="sm:col-span-2">
                    <Row label="Address" value={[patient.address, patient.barangay].filter(Boolean).join(', ')} />
                  </div>
                  <Row label="Household" value={patient.householdNumber} />
                  <Row label="PhilHealth" value={patient.philHealthNumber} />
                  <div className="sm:col-span-2">
                    <Row
                      label="Emergency contact"
                      value={[patient.emergencyName, patient.emergencyNumber].filter(Boolean).join(' · ')}
                    />
                  </div>
                </dl>
                <Link
                  to="/staff/patients/$patientId"
                  params={{ patientId: patient.id }}
                  className="mt-4 inline-block text-[12.5px] font-semibold text-[#1f55a8] underline"
                >
                  Open full patient record
                </Link>
              </section>

              <MedicalProfileCard
                medical={patient.medical}
                onEditingChange={setMedicalEditing}
                onSave={
                  canEditMedical
                    ? async (input: MedicalProfileInput) => {
                        const result = await updatePatientMedical(patient.id, input, patient.version);
                        setPatient(result.patient);
                        setToast({ tone: 'success', message: 'Medical profile saved.' });
                      }
                    : undefined
                }
              />

              <section className={panel} aria-label="Previous visits">
                <CardHeading
                  title="Previous visits"
                  description={history.length ? `${history.length} other visit${history.length === 1 ? '' : 's'}` : 'No other visits yet'}
                />
                <div className="mt-4 grid gap-3">
                  {history.map((v) => (
                    <article key={v.id} className="rounded-xl border border-slate-200/70 bg-white/70 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-display text-[13.5px] font-semibold text-slate-900">{serviceName(v)}</h3>
                          <p className="mt-0.5 text-[12px] text-slate-500">{formatDay(v.day)}</p>
                        </div>
                        <StatusChip status={v.status} />
                      </div>
                      {v.status === 'completed' && (v.diagnosis || v.prescription || v.visitNotes) ? (
                        <dl className="mt-2.5 space-y-1.5 text-[12.5px] leading-5">
                          {v.diagnosis && (
                            <div>
                              <dt className="font-semibold text-slate-500">Diagnosis</dt>
                              <dd className="text-slate-800">{v.diagnosis}</dd>
                            </div>
                          )}
                          {v.prescription && (
                            <div>
                              <dt className="font-semibold text-slate-500">Prescription</dt>
                              <dd className="text-slate-800">{v.prescription}</dd>
                            </div>
                          )}
                          {v.visitNotes && (
                            <div>
                              <dt className="font-semibold text-slate-500">Visit notes</dt>
                              <dd className="text-slate-800">{v.visitNotes}</dd>
                            </div>
                          )}
                        </dl>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </DashboardShell>
      <AnimatePresence>
        {toast && <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </>
  );
}
