import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarCheck,
  Download,
  Printer,
  Search,
  TrendingUp,
  Users,
} from 'lucide-react';
import { BarChart } from '../../components/charts/bar-chart';
import { Bar } from '../../components/charts/bar';
import { BarValueAxis } from '../../components/charts/bar-value-axis';
import { BarValueLabels } from '../../components/charts/bar-value-labels';
import { BarXAxis } from '../../components/charts/bar-x-axis';
import { Grid } from '../../components/charts/grid';
import { ChartTooltip } from '../../components/charts/tooltip/chart-tooltip';
import { DashboardShell } from '../../components/dashboard-shell';
import { opsNav } from '../../components/ops-nav';
import {
  CardHeading,
  EmptyNote,
  InlineNotice,
  Segmented,
  StatTile,
  chipButton,
  panel,
} from '../../components/app-ui';
import { Toast, type ToastMessage } from '../../components/toast';
import { PdfExportButton, PdfExportDialog, PdfExportNote, usePdfExport } from '../../components/pdf-export';
import { SheetsExportButton, SheetsExportNote, useSheetsExport } from '../../components/sheets-export';
import { getSession } from '../../lib/auth';
import {
  appointmentsByStatus,
  downloadReportPdf,
  downloadVisitsCsv,
  exportVisitsPdf,
  exportVisitsToSheets,
  patientReport,
  visitsPerService,
  type AppointmentsByStatusRow,
  type AppointmentsByStatusTotals,
  type PatientReportRow,
  type ReportKind,
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

const REPORT_TITLES: Record<ReportKind, string> = {
  visits: 'Visits per service',
  status: 'Appointments by status',
  patients: 'Patient register',
};

const REPORT_TABS = [
  { key: 'visits', label: 'Visits by service', icon: TrendingUp },
  { key: 'status', label: 'Appointments by status', icon: CalendarCheck },
  { key: 'patients', label: 'Patient register', icon: Users },
] as const;

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
] as const;

const RANGE_DAYS: Record<ReportRange, number> = { today: 1, week: 7, month: 30 };

const STATUS_COLUMNS = [
  { key: 'pending', label: 'Pending', dot: 'bg-amber-500' },
  { key: 'confirmed', label: 'Confirmed', dot: 'bg-emerald-500' },
  { key: 'declined', label: 'Declined', dot: 'bg-red-500' },
  { key: 'completed', label: 'Completed', dot: 'bg-slate-400' },
  { key: 'cancelled', label: 'Cancelled', dot: 'bg-slate-300' },
] as const;

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

  const [report, setReport] = useState<ReportKind>('visits');
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const rangeDays = RANGE_DAYS[range];
  const sheets = useSheetsExport(() => exportVisitsToSheets(rangeDays));
  const pdf = usePdfExport((options) => exportVisitsPdf(rangeDays, options));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (report === 'visits') setVisits(null);
    else if (report === 'status') setStatus(null);
    else setPatients(null);

    const request =
      report === 'visits'
        ? visitsPerService(range).then((data) => {
            if (!cancelled) setVisits(data);
          })
        : report === 'status'
          ? appointmentsByStatus(range).then((data) => {
              if (!cancelled) setStatus(data);
            })
          : patientReport(range).then((data) => {
              if (!cancelled) setPatients(data);
            });

    request
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [report, range]);

  const meta: ReportRangeMeta | null =
    report === 'visits' ? visits : report === 'status' ? status : patients;
  const period = formatRange(meta);
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
  const chartData = useMemo(
    () => visitRows.map((row) => ({ service: row.serviceName, visits: row.count })),
    [visitRows],
  );

  const statusTotals = status?.totals ?? null;
  const completionRate =
    statusTotals && statusTotals.total > 0
      ? Math.round((statusTotals.completed / statusTotals.total) * 100)
      : 0;

  const patientRows = patients?.rows ?? [];

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadReportPdf(report, range);
      setToast({ tone: 'success', message: 'Report PDF downloaded.' });
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Could not export the report.',
      });
    } finally {
      setDownloading(false);
    }
  }

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

  const cardDescription =
    report === 'visits'
      ? `Completed visits · ${period || 'loading…'}`
      : report === 'status'
        ? `Every appointment outcome · ${period || 'loading…'}`
        : `All registered patients${meta ? ` · as of ${formatDay(meta.to)}` : ''}`;

  const actions = (
    <div className="flex flex-wrap items-center gap-2 print-hide">
      <button type="button" onClick={() => window.print()} className={chipButton}>
        <Printer size={15} aria-hidden />
        Print
      </button>
      {report === 'visits' && (
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={csvExporting}
          className={chipButton}
        >
          <Download size={15} aria-hidden />
          {csvExporting ? 'Preparing…' : 'Export CSV'}
        </button>
      )}
      {report === 'visits' && (
        <SheetsExportButton
          exporting={sheets.exporting}
          disabled={visits === null}
          onClick={sheets.start}
          className={chipButton}
        />
      )}
      {report === 'visits' ? (
        <PdfExportButton onClick={pdf.start} disabled={visits === null} className={chipButton} />
      ) : (
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className={chipButton}
        >
          <Download size={15} aria-hidden />
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      )}
    </div>
  );

  return (
    <DashboardShell
      title="Reports"
      subtitle="Where the center's time actually went"
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
              HealthCentria
            </p>
            <p className="text-[12px] text-slate-600">Brgy. 11 Health Center</p>
          </div>
          <div className="text-right text-[12px] leading-5 text-slate-600">
            <p className="font-semibold text-slate-900">{REPORT_TITLES[report]}</p>
            <p>{period || '—'}</p>
            <p>Generated {generatedAt}</p>
          </div>
        </div>
      </div>

      <motion.div
        {...rise}
        transition={riseTransition}
        className="flex flex-wrap items-center justify-end gap-3 print-hide"
      >
        <Segmented
          ariaLabel="Report period"
          value={range}
          onChange={setRange}
          options={RANGE_OPTIONS}
          className="print-hide"
        />
      </motion.div>

      <SheetsExportNote result={sheets.result} error={sheets.error} />
      <PdfExportNote result={pdf.result} error={pdf.error} />
      {pdf.open && (
        <PdfExportDialog
          title="Export PDF"
          subtitle={`${REPORT_TITLES.visits} · ${period || 'selected period'}`}
          onCancel={pdf.close}
          onGenerate={pdf.run}
        />
      )}

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.03 }}
        className="print-hide"
      >
        <div
          role="tablist"
          aria-label="Report"
          className="flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1"
        >
          {REPORT_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = report === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`report-tab-${tab.key}`}
                aria-controls={`report-panel-${tab.key}`}
                aria-selected={selected}
                onClick={() => setReport(tab.key)}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-semibold transition-all duration-150 active:scale-[0.97]',
                  selected
                    ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,60,90,0.12)]'
                    : 'text-slate-500 hover:text-slate-800',
                )}
              >
                <Icon size={15} aria-hidden />
                {tab.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.06 }}
        className="grid gap-3.5 sm:grid-cols-3"
      >
        {report === 'visits' && (
          <>
            <StatTile
              icon={TrendingUp}
              label="Completed visits"
              value={visits === null ? '—' : visitTotal}
              hint={`Last ${meta?.days ?? 30} days`}
            />
            <StatTile
              icon={CalendarCheck}
              label="Services used"
              value={visits === null ? '—' : visitRows.length}
              hint="At least one completed visit"
              tone="sky"
            />
            <StatTile
              icon={Users}
              label="Busiest service"
              value={visits === null ? '—' : busiest?.serviceName ?? '—'}
              hint={busiest ? `${busiest.count} visits` : 'No visits yet'}
              tone="slate"
            />
          </>
        )}

        {report === 'status' && (
          <>
            <StatTile
              icon={CalendarCheck}
              label="Appointments"
              value={status === null ? '—' : statusTotals?.total ?? 0}
              hint={`All outcomes · last ${meta?.days ?? 30} days`}
            />
            <StatTile
              icon={TrendingUp}
              label="Completed"
              value={status === null ? '—' : statusTotals?.completed ?? 0}
              hint={`${completionRate}% completion rate`}
              tone="sky"
            />
            <StatTile
              icon={Users}
              label="Pending review"
              value={status === null ? '—' : statusTotals?.pending ?? 0}
              hint="Awaiting staff action"
              tone="amber"
            />
          </>
        )}

        {report === 'patients' && (
          <>
            <StatTile
              icon={Users}
              label="Patients"
              value={patients === null ? '—' : patients.total}
              hint="Registered in the system"
            />
            <StatTile
              icon={TrendingUp}
              label="New this period"
              value={patients === null ? '—' : patients.newInPeriod}
              hint={`Registered · last ${meta?.days ?? 30} days`}
              tone="sky"
            />
            <StatTile
              icon={CalendarCheck}
              label="Seen this period"
              value={patients === null ? '—' : patients.seenInPeriod}
              hint="Last visit inside the window"
              tone="slate"
            />
          </>
        )}
      </motion.div>

      {error && <InlineNotice>{error}</InlineNotice>}

      <motion.section
        {...rise}
        transition={{ ...riseTransition, delay: 0.09 }}
        role="tabpanel"
        id={`report-panel-${report}`}
        aria-labelledby={`report-tab-${report}`}
        className={panel}
      >
        <CardHeading
          title={REPORT_TITLES[report]}
          description={cardDescription}
          action={actions}
        />

        {report === 'visits' && (
          <div className="mt-5">
            {loading && visitRows.length === 0 && (
              <>
                <BarChart
                  data={[]}
                  xDataKey="service"
                  status="loading"
                  margin={{ top: 28, right: 16, bottom: 52, left: 46 }}
                  aspectRatio="2.2 / 1"
                />
                <p className="sr-only" role="status">
                  Loading report…
                </p>
              </>
            )}
            {!loading && !error && visitRows.length === 0 && (
              <EmptyNote>
                No completed visits in this period. Try Today, Week or Month, or complete a visit
                in the appointments queue.
              </EmptyNote>
            )}
            {visitRows.length > 0 && (
              <>
                <BarChart
                  data={chartData}
                  xDataKey="service"
                  margin={{ top: 28, right: 16, bottom: 52, left: 46 }}
                  aspectRatio="2.2 / 1"
                  animationDuration={700}
                >
                  <Grid horizontal />
                  <Bar
                    dataKey="visits"
                    fill="var(--chart-line-primary)"
                    lineCap="round"
                    minBarHeight={2}
                  />
                  <BarValueAxis />
                  <BarValueLabels valueKey="visits" />
                  <BarXAxis maxLabels={10} maxLabelWidth={92} />
                  <ChartTooltip />
                </BarChart>
                <p className="mt-2 text-[12px] leading-5 text-slate-500">
                  {visitRows.length} {visitRows.length === 1 ? 'service' : 'services'} with
                  completed visits.
                  {busiest ? ` Busiest: ${busiest.serviceName} (${busiest.count}).` : ''}
                </p>
                <p className="sr-only">
                  Visits per service for {period || 'the selected period'}:{' '}
                  {visitRows.map((row) => `${row.serviceName}, ${row.count} visits`).join('; ')}.
                  Total {visitTotal} visits.
                </p>
                <VisitsTable rows={visitRows} total={visitTotal} />
              </>
            )}
          </div>
        )}

        {report === 'status' && (
          <div className="mt-5">
            {loading && status === null && <EmptyNote>Loading report…</EmptyNote>}
            {!loading && !error && status !== null && status.rows.length === 0 && (
              <EmptyNote>
                No appointments in this period. Try another preset or check back after the next
                booking.
              </EmptyNote>
            )}
            {status !== null && status.rows.length > 0 && (
              <StatusTable rows={status.rows} totals={status.totals} />
            )}
          </div>
        )}

        {report === 'patients' && (
          <div className="mt-5">
            {loading && patients === null && <EmptyNote>Loading report…</EmptyNote>}
            {!loading && !error && patients !== null && patientRows.length === 0 && (
              <EmptyNote>No patients registered yet.</EmptyNote>
            )}
            {patients !== null && patientRows.length > 0 && <PatientTable rows={patientRows} />}
          </div>
        )}
      </motion.section>

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

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200/80 print:overflow-visible print:border-0">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px] print:min-w-0">
        {children}
      </table>
    </div>
  );
}

function VisitsTable({ rows, total }: { rows: VisitsPerServiceRow[]; total: number }) {
  return (
    <TableShell>
      <thead>
        <tr className="border-b border-slate-200/80 bg-white/80 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <th scope="col" className="px-3.5 py-2.5 font-semibold">
            Service
          </th>
          <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">
            Visits
          </th>
          <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const share = total > 0 ? (row.count / total) * 100 : 0;
          return (
            <tr
              key={row.serviceId}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
            >
              <td className="px-3.5 py-2.5 font-medium text-slate-800">{row.serviceName}</td>
              <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-700">
                {row.count}
              </td>
              <td className="px-3.5 py-2.5">
                <div className="flex items-center justify-end gap-2">
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 print:hidden">
                    <span
                      className="block h-full rounded-full bg-teal-600"
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                  </span>
                  <span className="w-12 text-right tabular-nums text-slate-600">
                    {share.toFixed(1)}%
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-semibold text-slate-900">
          <td className="px-3.5 py-2.5">Total</td>
          <td className="px-3.5 py-2.5 text-right tabular-nums">{total}</td>
          <td className="px-3.5 py-2.5 text-right tabular-nums">100%</td>
        </tr>
      </tfoot>
    </TableShell>
  );
}

function StatusTable({
  rows,
  totals,
}: {
  rows: AppointmentsByStatusRow[];
  totals: AppointmentsByStatusTotals;
}) {
  return (
    <TableShell>
      <thead>
        <tr className="border-b border-slate-200/80 bg-white/80 text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
          <th scope="col" className="px-2.5 py-2.5 font-semibold">
            Service
          </th>
          {STATUS_COLUMNS.map((column) => (
            <th
              key={column.key}
              scope="col"
              className="whitespace-nowrap px-2.5 py-2.5 text-right font-semibold"
            >
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('size-1.5 rounded-full', column.dot)} aria-hidden />
                {column.label}
              </span>
            </th>
          ))}
          <th scope="col" className="px-2.5 py-2.5 text-right font-semibold">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.serviceId}
            className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
          >
            <td className="px-2.5 py-2.5 font-medium text-slate-800">{row.serviceName}</td>
            {STATUS_COLUMNS.map((column) => {
              const value = row[column.key];
              return (
                <td
                  key={column.key}
                  className={cn(
                    'px-2.5 py-2.5 text-right tabular-nums',
                    value > 0 ? 'text-slate-700' : 'text-slate-300',
                  )}
                >
                  {value}
                </td>
              );
            })}
            <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums text-slate-900">
              {row.total}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-semibold text-slate-900">
          <td className="px-2.5 py-2.5">Total</td>
          {STATUS_COLUMNS.map((column) => (
            <td key={column.key} className="px-2.5 py-2.5 text-right tabular-nums">
              {totals[column.key]}
            </td>
          ))}
          <td className="px-2.5 py-2.5 text-right tabular-nums">{totals.total}</td>
        </tr>
      </tfoot>
    </TableShell>
  );
}

function PatientTable({ rows }: { rows: PatientReportRow[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.address, row.barangay, row.contactNumber, row.householdNumber].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [rows, query]);

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 print-hide">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search patients…"
            aria-label="Search patients"
            className="h-9 w-full rounded-lg border border-slate-200/80 bg-white pl-9 pr-3 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/25 sm:w-64"
          />
        </div>
        <p className="text-[12px] text-slate-500">
          Showing {filtered.length} of {rows.length} patients
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyNote className="mt-4">No patients match “{query.trim()}”.</EmptyNote>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b border-slate-200/80 bg-white/80 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Patient
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Age / sex
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Address
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Contact
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Household #
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Last visit
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
              >
                <td className="px-3 py-2.5 font-medium text-slate-800">{row.name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                  {row.age ?? '—'} / {row.sex || '—'}
                </td>
                <td className="px-3 py-2.5 text-slate-600">
                  {[row.address, row.barangay].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                  {row.contactNumber || '—'}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{row.householdNumber || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                  {row.lastVisit ? formatDay(row.lastVisit) : 'No visits'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-semibold text-slate-900">
              <td className="px-3 py-2.5">Total</td>
              <td className="px-3 py-2.5" colSpan={4}>
                {filtered.length === rows.length
                  ? `${rows.length} patients`
                  : `${filtered.length} of ${rows.length} patients`}
              </td>
              <td className="px-3 py-2.5" />
            </tr>
          </tfoot>
        </TableShell>
      )}
    </div>
  );
}
