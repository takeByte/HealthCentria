import { LiveBanner } from '../../components/live-banner';
import { useLiveStale } from '../../lib/realtime';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { AnimatePresence } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
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
import {
  ConflictNotice,
  LostDraft,
  conflictLatest,
  nonEmptyDraft,
  type DraftItem,
} from '../../components/conflict-draft';
import { MedicalProfileCard } from '../../components/medical-profile';
import { RecordMeta } from '../../components/record-meta';
import { Toast, type ToastMessage } from '../../components/toast';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  completeAppointment,
  getVisitContext,
  updateAppointmentRecord,
  updatePatientMedical,
  type MedicalProfileInput,
  type PatientDetail,
  type PatientVisit,
  type StaffAppointment,
  type VisitContext,
} from '../../lib/api';
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
  // Someone else changed this patient or visit: say so, but never replace what is being typed.
  const liveStale = useLiveStale(['patients', 'appointments'], ctx?.patient.id);
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [visitNotes, setVisitNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Someone saved this visit first: their copy waits here while the user's text stays on screen.
  const [conflict, setConflict] = useState<{ latest: StaffAppointment; version?: number } | null>(null);
  // The user's own text, kept for copying after the latest version has been loaded.
  const [lostDraft, setLostDraft] = useState<DraftItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCtx(null);
    setConflict(null);
    getVisitContext(appointmentId)
      .then((r) => {
        if (cancelled) return;
        setCtx(r);
        setPatient(r.patient);
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

  /** What the user typed that differs from the given saved copy (so only real edits are kept). */
  function draftDifferingFrom(saved: { diagnosis: string; prescription: string; visitNotes: string }): DraftItem[] {
    const same = (a: string, b: string) => a.trim() === (b ?? '').trim();
    return nonEmptyDraft(
      [
        { label: 'Diagnosis', value: diagnosis, saved: saved.diagnosis },
        { label: 'Prescription', value: prescription, saved: saved.prescription },
        { label: 'Visit notes', value: visitNotes, saved: saved.visitNotes },
      ]
        .filter((f) => !same(f.value, f.saved))
        .map(({ label, value }) => ({ label, value })),
    );
  }

  /** Show the other person's version; keep the user's own text next to it. */
  function loadLatest() {
    if (!conflict) return;
    const latest = conflict.latest;
    const kept = draftDifferingFrom(latest);
    setLostDraft(kept.length ? kept : null);
    setCtx((c) =>
      c
        ? {
            ...c,
            appointment: {
              ...c.appointment,
              status: latest.status,
              version: latest.version,
              diagnosis: latest.diagnosis,
              prescription: latest.prescription,
              visitNotes: latest.visitNotes,
              updatedAt: latest.updatedAt,
              updatedByName: latest.updatedByName,
            },
          }
        : c,
    );
    setDiagnosis(latest.diagnosis);
    setPrescription(latest.prescription);
    setVisitNotes(latest.visitNotes);
    setConflict(null);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!appt || conflict) return;
    setFormError(null);
    setSaving(true);
    const clinical = {
      diagnosis: diagnosis.trim(),
      prescription: prescription.trim(),
      visitNotes: visitNotes.trim(),
    };
    try {
      if (completing) {
        await completeAppointment(appt.id, clinical);
        void navigate({ to: '/staff/appointments' });
        return;
      }
      const saved = await updateAppointmentRecord(appt.id, clinical, appt.version);
      // Keep the new version so a second save from this page is not mistaken for a conflict.
      setCtx((c) => (c ? { ...c, appointment: { ...c.appointment, version: saved.appointment.version } } : c));
      setToast({ tone: 'success', message: 'Visit record updated.' });
    } catch (err) {
      const c = conflictLatest<StaffAppointment>(err);
      if (c) {
        // Nothing was saved. Keep the form as typed and wait for the user's decision.
        setConflict({ latest: c.latest, version: c.version ?? c.latest.version });
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
          stale={liveStale.stale}
          onReload={() => {
            // Reloading replaces the form, so keep anything the user typed for them to copy.
            if (appt) {
              const kept = draftDifferingFrom(appt);
              if (kept.length) setLostDraft(kept);
            }
            liveStale.clear();
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
                <div>
                  <label htmlFor="visit-diagnosis" className={fieldLabel}>Diagnosis</label>
                  <textarea
                    id="visit-diagnosis"
                    rows={4}
                    maxLength={1000}
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    disabled={readOnly}
                    placeholder="e.g. Acute viral nasopharyngitis"
                    className={textareaClass}
                  />
                </div>
                <div>
                  <label htmlFor="visit-prescription" className={fieldLabel}>Prescription</label>
                  <textarea
                    id="visit-prescription"
                    rows={4}
                    maxLength={1000}
                    value={prescription}
                    onChange={(e) => setPrescription(e.target.value)}
                    disabled={readOnly}
                    placeholder="e.g. Paracetamol 500mg every 6 hours for 3 days"
                    className={textareaClass}
                  />
                </div>
                <div>
                  <label htmlFor="visit-notes" className={fieldLabel}>Visit notes</label>
                  <textarea
                    id="visit-notes"
                    rows={4}
                    maxLength={2000}
                    value={visitNotes}
                    onChange={(e) => setVisitNotes(e.target.value)}
                    disabled={readOnly}
                    placeholder="Advice, follow-up instructions…"
                    className={textareaClass}
                  />
                </div>
                {conflict && (
                  <ConflictNotice
                    version={conflict.version}
                    updatedBy={conflict.latest.updatedByName || undefined}
                    onLoadLatest={loadLatest}
                  />
                )}
                {lostDraft && !conflict && <LostDraft items={lostDraft} onDismiss={() => setLostDraft(null)} />}
                {formError && <InlineNotice>{formError}</InlineNotice>}
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={saving || conflict !== null}
                      className={`${primaryButton} h-10 px-5`}
                    >
                      {saving && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
                      {completing ? 'Save & complete visit' : 'Save changes'}
                    </button>
                    <Link to="/staff/appointments" className={`${secondaryButton} h-10 px-5`}>
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
                onLoadLatest={setPatient}
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
