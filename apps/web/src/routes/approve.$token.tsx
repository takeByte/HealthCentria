import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, LoaderCircle, ShieldCheck } from 'lucide-react';
import { PublicHeader } from '../components/public-header';
import { ApiError, decideApproval, getApprovalInfo, type ApprovalInfo } from '../lib/api';

export const Route = createFileRoute('/approve/$token')({
  component: ApproveChange,
});

type Outcome = 'confirmed' | 'denied';

const STATUS_NOTES: Record<string, string> = {
  expired: 'This confirmation link has expired. Nothing was changed.',
  used: 'This request was already confirmed and applied.',
  approved: 'This request was already confirmed.',
  denied: 'This request was already denied.',
  cancelled: 'The admin cancelled this request. Nothing was changed.',
};

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Landing page for the superadmin's email link. Opening it changes nothing: the
 * decision is made with an explicit button press (a POST), so mail scanners that
 * pre-open links cannot approve by accident. No sign-in; the single-use token in
 * the URL is the credential.
 */
function ApproveChange() {
  const { token } = Route.useParams();
  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovalInfo(token)
      .then((r) => {
        if (!cancelled) setInfo(r.approval);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : 'Could not load this request. Try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function decide(decision: 'confirm' | 'deny') {
    if (busy) return;
    setBusy(decision === 'confirm' ? 'confirmed' : 'denied');
    setActionError(null);
    try {
      await decideApproval(token, decision);
      setOutcome(decision === 'confirm' ? 'confirmed' : 'denied');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not send your decision. Try again.');
      setBusy(null);
    }
  }

  const pending = info?.status === 'pending';
  const note = info && !pending ? (STATUS_NOTES[info.status] ?? 'This request is no longer waiting.') : null;

  return (
    <>
      <PublicHeader />
      <div className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(135deg,#f2f9fe_0%,#eff6ff_55%,#f0fdf4_100%)]"
        />
        <section className="w-full max-w-[440px] rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_8px_30px_rgba(15,60,90,0.08)] sm:p-8">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[#1f55a8]">
            <ShieldCheck size={16} aria-hidden /> HealthCentria superadmin
          </p>

          {loadError ? (
            <>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Link not valid</h1>
              <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {loadError}
              </p>
            </>
          ) : !info ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <LoaderCircle size={18} className="animate-spin" aria-hidden />
              Loading request…
            </p>
          ) : outcome ? (
            <div className="text-center">
              <span
                className={`mx-auto mt-3 flex size-12 items-center justify-center rounded-full ${
                  outcome === 'confirmed' ? 'bg-[#1695de]/10 text-[#1f55a8]' : 'bg-destructive/10 text-destructive'
                }`}
              >
                {outcome === 'confirmed' ? <CircleCheck size={26} aria-hidden /> : <CircleX size={26} aria-hidden />}
              </span>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                {outcome === 'confirmed' ? 'Change confirmed' : 'Change denied'}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {outcome === 'confirmed'
                  ? 'The admin’s screen will apply the change in a moment. You can close this tab.'
                  : 'Nothing was changed. If you did not expect this request, change SU_PIN in the server .env.'}
              </p>
            </div>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Confirm this change?</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                An admin entered the superadmin PIN. Nothing changes until you press Confirm.
              </p>
              <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200/80 text-sm">
                <div className="flex gap-3 px-3.5 py-2.5">
                  <dt className="w-20 shrink-0 text-slate-500">What</dt>
                  <dd className="font-medium text-slate-900">{info.label}</dd>
                </div>
                <div className="flex gap-3 px-3.5 py-2.5">
                  <dt className="w-20 shrink-0 text-slate-500">Who</dt>
                  <dd className="break-all text-slate-900">{info.requestedBy}</dd>
                </div>
                <div className="flex gap-3 px-3.5 py-2.5">
                  <dt className="w-20 shrink-0 text-slate-500">When</dt>
                  <dd className="text-slate-900">{formatWhen(info.requestedAt)}</dd>
                </div>
                <div className="flex gap-3 px-3.5 py-2.5">
                  <dt className="w-20 shrink-0 text-slate-500">From IP</dt>
                  <dd className="text-slate-900">{info.ip || 'unknown'}</dd>
                </div>
              </dl>

              {note ? (
                <p role="status" className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {note}
                </p>
              ) : (
                <>
                  <p className="mt-3 text-xs text-slate-500">Link expires {formatWhen(info.expiresAt)}.</p>
                  {actionError && (
                    <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                      {actionError}
                    </p>
                  )}
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => decide('deny')}
                      disabled={busy !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-base font-medium text-slate-800 transition-colors hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
                    >
                      {busy === 'denied' && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => decide('confirm')}
                      disabled={busy !== null}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#1695de] to-blue-600 text-base font-medium text-white active:scale-[0.97] disabled:opacity-60"
                    >
                      {busy === 'confirmed' && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
                      Confirm
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
