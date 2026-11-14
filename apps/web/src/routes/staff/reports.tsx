import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  Clock3,
  Download,
  Eye,
  Printer,
  Stethoscope,
  TrendingUp,
  Users,
} from 'lucide-react';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  EmptyNote,
  InlineNotice,
  Segmented,
  chipButton,
} from '../../components/app-ui';
import { Toast, type ToastMessage } from '../../components/toast';
import { PdfExportDialog, PdfExportNote, usePdfExport } from '../../components/pdf-export';
import { SheetsExportButton, SheetsExportNote, useSheetsExport } from '../../components/sheets-export';
import { getSession } from '../../lib/auth';
import {
  appointmentsByStatus,
  downloadVisitsCsv,
  exportVisitsPdf,
  exportVisitsToSheets,
  monthlyTrends,
  patientReport,
  visitsPerService,
  type AppointmentsByStatusRow,
  type AppointmentsByStatusTotals,
  type MonthlyTrendMonth,
  type MonthlyTrendSeries,
  type PatientReportRow,
  type ReportRange,
  type ReportRangeMeta,
  type VisitsPerServiceRow,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { sessionCan } from '../../lib/permissions';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/staff/reports')({
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'reports.view')) throw redirect({ to: '/staff/dashboard' });
  },
  component: Reports,
});

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
] as const;

const RANGE_DAYS: Record<ReportRange, number> = { today: 1, week: 7, month: 30 };

const SERIES_COLORS = ['#134e4a', '#2dd4bf', '#d9a441'] as const;
const SERVICE_COLORS = ['#0f766e', '#14b8a6', '#5eead4', '#ccfbf1'] as const;

const AGE_GROUPS = [
  { label: 'Children (0–17)', min: 0, max: 17, color: '#ccfbf1' },
  { label: 'Youth (18–35)', min: 18, max: 35, color: '#5eead4' },
  { label: 'Adults (36–59)', min: 36, max: 59, color: '#0f766e' },
  { label: 'Seniors (60+)', min: 60, max: Number.POSITIVE_INFINITY, color: '#d9a441' },
] as const;

const card =
  'rounded-[1.25rem] border border-[#e2e8f0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_44px_-36px_rgba(15,23,42,0.38)]';

function formatDay(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return ymd;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatRange(meta: ReportRangeMeta | null): string {
  if (!meta) return '';
  return meta.from === meta.to
    ? formatDay(meta.from)
    : `${formatDay(meta.from)} – ${formatDay(meta.to)}`;
}

function Reports() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();

  const [range, setRange] = useState<ReportRange>('month');
  const [visits, setVisits] = useState<
    (ReportRangeMeta & { total: number; rows: VisitsPerServiceRow[] }) | null
  >(null);
  const [status, setStatus] = useState<
    (ReportRangeMeta & { totals: AppointmentsByStatusTotals; rows: AppointmentsByStatusRow[] }) | null
  >(null);
  const [patients, setPatients] = useState<
    (ReportRangeMeta & {
      total: number;
      newInPeriod: number;
      seenInPeriod: number;
      rows: PatientReportRow[];
    }) | null
  >(null);
  const [trends, setTrends] = useState<{
    months: MonthlyTrendMonth[];
    series: MonthlyTrendSeries[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [csvExporting, setCsvExporting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const rangeDays = RANGE_DAYS[range];
  const sheets = useSheetsExport(() => exportVisitsToSheets(rangeDays));
  const pdf = usePdfExport((options) => exportVisitsPdf(rangeDays, options));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      visitsPerService(range),
      appointmentsByStatus(range),
      patientReport(range),
      monthlyTrends(),
    ])
      .then(([visitData, statusData, patientData, trendData]) => {
        if (cancelled) return;
        setVisits(visitData);
        setStatus(statusData);
        setPatients(patientData);
        setTrends(trendData);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load reports.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const period = formatRange(visits);
  const generatedAt = useMemo(
    () =>
      new Date().toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [],
  );

  const visitRows = visits?.rows ?? [];
  const visitTotal = visits?.total ?? 0;
  const busiest = visitRows[0];
  const statusTotals = status?.totals ?? null;
  const completionRate =
    statusTotals && statusTotals.total > 0
      ? Math.round((statusTotals.completed / statusTotals.total) * 100)
      : 0;

  const patientRows = patients?.rows;
  const demographics = useMemo(() => {
    const rows = patientRows ?? [];
    const counts = AGE_GROUPS.map(
      (group) => rows.filter((row) => row.age !== null && row.age >= group.min && row.age <= group.max).length,
    );
    const known = counts.reduce((sum, count) => sum + count, 0);
    return AGE_GROUPS.map((group, index) => ({
      ...group,
      count: counts[index],
      pct: known > 0 ? Math.round((counts[index] / known) * 100) : 0,
    }));
  }, [patientRows]);

  async function handleExportCsv() {
    if (csvExporting) return;
    setCsvExporting(true);
    try {
      await downloadVisitsCsv(rangeDays);
      setToast({ tone: 'success', message: 'Report CSV downloaded.' });
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not generate the CSV. Try again.',
      });
    } finally {
      setCsvExporting(false);
    }
  }

  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

  return (
    <DashboardShell
      title="Reports"
      subtitle="Trends, patients and outcomes"
      roleLabel={session?.role === 'admin' ? 'Admin' : 'Staff'}
      userName={session?.name}
      userEmail={session?.email ?? ''}
      todayService={`${today.name} — ${today.detail}`}
      nav={opsNav(session?.role, session?.permissions)}
      notificationsTo="/staff/notifications"
    >
      <div className="print-only">
        <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
          <div>
            <p className="font-display text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
              E-Kalinga
            </p>
            <p className="text-[12px] text-slate-600">Brgy. 11 Health Center</p>
          </div>
          <div className="text-right text-[12px] leading-5 text-slate-600">
            <p className="font-semibold text-slate-900">Reports &amp; Analysis</p>
            <p>{period || '—'}</p>
            <p>Generated {generatedAt}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#14b8a6]">
            Report &amp; Analysis
          </p>
          <h1 className="mt-1 font-display text-[27px] font-semibold leading-tight tracking-[-0.02em] text-[#134e4a]">
            Reports &amp; Analysis
          </h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            View service trends, patient demographics and appointment outcomes.
            {loading && <span className="ml-1.5 font-medium text-[#0f766e]">Updating…</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print-hide">
          <Segmented
            ariaLabel="Report period"
            value={range}
            onChange={setRange}
            options={RANGE_OPTIONS}
          />
          <button
            type="button"
            onClick={() => window.print()}
            title="Print this report or save it as a PDF"
            className={chipButton}
          >
            <Printer size={15} aria-hidden />
            Print
          </button>
          <button
            type="button"
            onClick={pdf.start}
            disabled={visits === null}
            title="Generate a PDF, optionally save it to Google Drive and email the link"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#d9a441] px-4 py-2.5 text-[12.5px] font-semibold text-[#3b2a06] shadow-sm transition-colors hover:bg-[#c99433] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9a441] disabled:opacity-60"
          >
            <Download size={15} aria-hidden />
            Generate Report
          </button>
        </div>
      </div>

      <SheetsExportNote result={sheets.result} error={sheets.error} />
      <PdfExportNote result={pdf.result} error={pdf.error} />
      {pdf.open && (
        <PdfExportDialog
          title="Export PDF"
          subtitle={`Visits per service · ${period || 'selected period'}`}
          onCancel={pdf.close}
          onGenerate={pdf.run}
        />
      )}

      {error && <InlineNotice>{error}</InlineNotice>}

      <motion.section
        {...rise}
        transition={riseTransition}
        aria-label="Key figures"
        aria-busy={loading}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="Completed visits"
          value={visits === null ? '—' : visitTotal}
          note={`Completed consultations · last ${visits?.days ?? rangeDays} days`}
          delta={busiest ? `Busiest: ${busiest.serviceName}` : 'No completed visits yet'}
          icon={Stethoscope}
          tone="bg-[#e9f7f4] text-[#0f766e]"
        />
        <KpiCard
          label="Services used"
          value={visits === null ? '—' : visitRows.length}
          note="With at least one completed visit"
          delta={busiest ? `${busiest.count} visits for the busiest service` : 'Nothing in this period'}
          icon={CalendarCheck}
          tone="bg-[#edf4f8] text-[#475569]"
        />
        <KpiCard
          label="Pending review"
          value={status === null ? '—' : (statusTotals?.pending ?? 0)}
          note="Appointments awaiting staff action"
          delta={
            statusTotals
              ? `${completionRate}% of appointments completed`
              : 'No appointment outcomes yet'
          }
          deltaTone={statusTotals && statusTotals.pending > 0 ? 'amber' : 'green'}
          icon={Clock3}
          tone="bg-amber-50 text-amber-600"
        />
        <KpiCard
          label="Registered patients"
          value={patients === null ? '—' : patients.total}
          note="Registered in the system"
          delta={
            patients
              ? `${patients.newInPeriod} new · ${patients.seenInPeriod} seen this period`
              : 'No patient records yet'
          }
          icon={Users}
          tone="bg-sky-50 text-sky-600"
        />
      </motion.section>

      <div className="grid gap-4 xl:grid-cols-3">
        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.03 }}
          className={cn(card, 'p-5 xl:col-span-2')}
        >
          <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#134e4a]">
            Monthly Service Trends
          </h2>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            Completed visits for the three busiest services over the last six months.
          </p>
          {trends === null ? (
            <EmptyNote className="mt-4">Loading trends…</EmptyNote>
          ) : trends.series.length === 0 ? (
            <EmptyNote className="mt-4">
              No completed visits in the last six months. The chart fills in as visits are
              completed.
            </EmptyNote>
          ) : (
            <>
              <TrendChart months={trends.months} series={trends.series} />
              <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {trends.series.map((series, index) => (
                  <li
                    key={series.serviceId}
                    className="flex items-center gap-1.5 text-[11px] text-slate-600"
                  >
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                    />
                    {series.serviceName}
                  </li>
                ))}
              </ul>
              <p className="sr-only">
                Completed visits by month:{' '}
                {trends.months
                  .map((month) => `${month.label} ${month.year}: ${month.total}`)
                  .join('; ')}
                .
              </p>
            </>
          )}
        </motion.section>

        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.06 }}
          className={cn(card, 'p-5')}
        >
          <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#134e4a]">
            Top Services breakdown
          </h2>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            Share of completed visits in this period.
          </p>
          {visits === null ? (
            <EmptyNote className="mt-4">Loading services…</EmptyNote>
          ) : visitRows.length === 0 ? (
            <EmptyNote className="mt-4">No completed visits in this period.</EmptyNote>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {visitRows.slice(0, 4).map((row, index) => {
                const share = visitTotal > 0 ? (row.count / visitTotal) * 100 : 0;
                return (
                  <li key={row.serviceId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-medium text-slate-700">
                        {row.serviceName}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {row.count}{' '}
                        <span className="font-normal text-slate-400">
                          ({share.toFixed(0)}%)
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef4f8]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, share)}%`,
                          backgroundColor: SERVICE_COLORS[index % SERVICE_COLORS.length],
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {visitRows.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              {visitRows.length} {visitRows.length === 1 ? 'service' : 'services'} · {visitTotal}{' '}
              completed visits total.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eef4f8] pt-3 print-hide">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={csvExporting || visits === null}
              className={chipButton}
            >
              <Download size={15} aria-hidden />
              {csvExporting ? 'Preparing…' : 'Export CSV'}
            </button>
            <SheetsExportButton
              exporting={sheets.exporting}
              disabled={visits === null}
              onClick={sheets.start}
              className={chipButton}
            />
          </div>
        </motion.section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.09 }}
          className={cn(card, 'overflow-hidden xl:col-span-2')}
        >
          <div className="px-5 pt-5">
            <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#134e4a]">
              Service outcomes
            </h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              Every appointment outcome by service for this period.
            </p>
          </div>
          {status === null ? (
            <div className="px-5 pb-5">
              <EmptyNote className="mt-4">Loading outcomes…</EmptyNote>
            </div>
          ) : status.rows.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyNote className="mt-4">No appointments in this period.</EmptyNote>
            </div>
          ) : (
            <OutcomesTable rows={status.rows} />
          )}
        </motion.section>

        <motion.section
          {...rise}
          transition={{ ...riseTransition, delay: 0.12 }}
          className={cn(card, 'p-5')}
        >
          <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#134e4a]">
            Patient Demographics
          </h2>
          <p className="mt-0.5 text-[11.5px] text-slate-500">
            Registered patients classified by age.
          </p>
          <div className="mt-3 flex justify-center">
            <DemographicsDonut groups={demographics} total={patients?.total ?? 0} />
          </div>
          <ul className="mt-3 space-y-2">
            {demographics.map((group) => (
              <li key={group.label} className="flex items-center gap-2 text-[11.5px]">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <span className="flex-1 text-slate-600">{group.label}</span>
                <span className="tabular-nums font-semibold text-slate-700">{group.pct}%</span>
              </li>
            ))}
          </ul>
          {patients !== null && patients.total === 0 && (
            <EmptyNote className="mt-3">No patients registered yet.</EmptyNote>
          )}
        </motion.section>
      </div>

      <div className="flex items-center gap-2 pt-1 text-[10.5px] text-slate-400">
        <TrendingUp size={13} aria-hidden />
        {period ? `Live data for ${period}` : 'Live data'} · generated {generatedAt}. Age groups
        use patients with a recorded birthdate.
      </div>

      {toast && (
        <Toast
          key={`${toast.tone}-${toast.message}`}
          toast={toast}
          onDone={() => setToast(null)}
        />
      )}
    </DashboardShell>
  );
}

function KpiCard({
  label,
  value,
  note,
  delta,
  deltaTone = 'green',
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  delta: string;
  deltaTone?: 'green' | 'amber';
  icon: typeof Stethoscope;
  tone: string;
}) {
  return (
    <article className="rounded-[1.25rem] border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_20px_44px_-36px_rgba(15,23,42,0.38)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
          {label}
        </p>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={15} aria-hidden />
        </span>
      </div>
      <p className="mt-2 font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-[#134e4a]">
        {value}
      </p>
      <p className="mt-2 text-[11.5px] text-slate-500">{note}</p>
      <p
        className={cn(
          'mt-0.5 text-[11px] font-semibold',
          deltaTone === 'amber' ? 'text-[#a16a12]' : 'text-[#0f766e]',
        )}
      >
        {delta}
      </p>
    </article>
  );
}

function TrendChart({
  months,
  series,
}: {
  months: MonthlyTrendMonth[];
  series: MonthlyTrendSeries[];
}) {
  const left = 50;
  const right = 610;
  const top = 20;
  const bottom = 210;

  const peak = Math.max(1, ...series.flatMap((entry) => entry.values));
  const rawTick = Math.max(1, Math.ceil(peak / 4));
  const magnitude = 10 ** Math.floor(Math.log10(rawTick));
  const normalized = rawTick / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ceiling = step * 4;

  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const x = (index: number) =>
    months.length > 1 ? left + (index * (right - left)) / (months.length - 1) : (left + right) / 2;

  const ticks = Array.from({ length: 5 }, (_, index) => index * step);

  return (
    <svg
      viewBox="0 0 620 240"
      className="mt-4 h-auto w-full"
      role="img"
      aria-label={`Monthly completed visits for ${series.map((entry) => entry.serviceName).join(', ')}`}
    >
      {ticks.map((value) => (
        <g key={value}>
          <line x1={44} x2={right} y1={y(value)} y2={y(value)} stroke="#eaf1f7" />
          <text
            x={34}
            y={y(value) + 3}
            textAnchor="end"
            fontSize="9"
            fill="#94a3b8"
          >
            {value}
          </text>
        </g>
      ))}
      {months.map((month, index) => (
        <text
          key={month.key}
          x={x(index)}
          y={228}
          textAnchor="middle"
          fontSize="9"
          fill="#94a3b8"
        >
          {month.label}
        </text>
      ))}
      {series.map((entry, seriesIndex) => {
        const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
        return (
          <g key={entry.serviceId}>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={entry.values.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
            />
            {entry.values.map((value, index) => (
              <circle
                key={index}
                cx={x(index)}
                cy={y(value)}
                r="2.6"
                fill="#fff"
                stroke={color}
                strokeWidth="1.8"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function OutcomesTable({ rows }: { rows: AppointmentsByStatusRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-y border-[#eef4f8] bg-[#f8fbfd] text-[9.5px] uppercase tracking-[0.08em] text-slate-500">
            <th className="px-5 py-2.5 font-bold">Service</th>
            <th className="px-3 py-2.5 text-right font-bold">Completed</th>
            <th className="px-3 py-2.5 text-right font-bold">Pending</th>
            <th className="px-3 py-2.5 text-right font-bold">Total</th>
            <th className="px-3 py-2.5 font-bold">Completion</th>
            <th className="px-5 py-2.5 text-right font-bold print-hide">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = open === row.serviceId;
            const rate = row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0;
            return (
              <Fragment key={row.serviceId}>
                <tr className="border-b border-[#eef4f8] text-[12px]">
                  <td className="px-5 py-3 font-semibold text-slate-800">{row.serviceName}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {row.completed}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {row.pending}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">
                    {row.total}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset',
                        rate >= 60
                          ? 'bg-[#e6f7f4] text-[#0f766e] ring-[#0f766e]/15'
                          : 'bg-amber-50 text-amber-800 ring-amber-600/20',
                      )}
                    >
                      {rate}% completed
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right print-hide">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : row.serviceId)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'View'} the ${row.serviceName} outcome breakdown`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-[#dde9f2] text-slate-500 transition-colors hover:bg-[#eef4f8] hover:text-[#0f766e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f766e]"
                    >
                      <Eye size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-[#eef4f8] bg-[#f8fbfd]">
                    <td colSpan={6} className="px-5 py-3 text-[11.5px] text-slate-600">
                      {row.completed} of {row.total} appointments completed · {row.pending}{' '}
                      pending · {row.confirmed} confirmed · {row.declined} declined ·{' '}
                      {row.cancelled} cancelled.
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DemographicsDonut({
  groups,
  total,
}: {
  groups: ReadonlyArray<{ label: string; pct: number; count: number; color: string }>;
  total: number;
}) {
  let offset = 0;

  return (
    <svg
      viewBox="0 0 120 120"
      className="size-40"
      role="img"
      aria-label={`Patient demographics by age group. ${groups
        .map((group) => `${group.label}: ${group.pct}%`)
        .join(', ')}.`}
    >
      <circle cx="60" cy="60" r="46" fill="none" stroke="#eef4f8" strokeWidth="14" />
      {total > 0 &&
        groups.map((group) => {
          const dashOffset = -offset;
          offset += group.pct;
          if (group.pct <= 0) return null;
          return (
            <circle
              key={group.label}
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke={group.color}
              strokeWidth="14"
              pathLength={100}
              strokeDasharray={`${group.pct} ${100 - group.pct}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
            />
          );
        })}
      <text x="60" y="57" textAnchor="middle" fontSize="16" fontWeight="600" fill="#134e4a">
        {total.toLocaleString()}
      </text>
      <text x="60" y="71" textAnchor="middle" fontSize="8" fill="#94a3b8">
        Patients
      </text>
    </svg>
  );
}
