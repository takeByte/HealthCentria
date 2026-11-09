import { createFileRoute, redirect } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CalendarCheck, Download, FileText, LoaderCircle, TrendingUp } from 'lucide-react';
import { BarChart } from '../../components/charts/bar-chart';
import { Bar } from '../../components/charts/bar';
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
  panel,
  secondaryButton,
} from '../../components/app-ui';
import { PdfExportButton, PdfExportDialog, PdfExportNote, usePdfExport } from '../../components/pdf-export';
import { SheetsExportButton, SheetsExportNote, useSheetsExport } from '../../components/sheets-export';
import { getSession } from '../../lib/auth';
import {
  ApiError,
  downloadVisitsCsv,
  exportVisitsPdf,
  exportVisitsToSheets,
  visitsPerService,
  type VisitsPerServiceRow,
} from '../../lib/api';
import { getTodayService } from '../../lib/schedule';
import { sessionCan } from '../../lib/permissions';

export const Route = createFileRoute('/staff/reports')({
  beforeLoad: () => {
    const session = getSession();
    if (!sessionCan(session, 'reports.view')) throw redirect({ to: '/staff/dashboard' });
  },
  component: Reports,
});

type Range = '30' | '90';

function Reports() {
  const reduceMotion = useReducedMotion();
  const session = getSession();
  const today = getTodayService();
  const [range, setRange] = useState<Range>('30');
  const [rows, setRows] = useState<VisitsPerServiceRow[] | null>(null);
  const [meta, setMeta] = useState<{ from: string; to: string; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const sheets = useSheetsExport(() => exportVisitsToSheets(Number(range)));
  const pdf = usePdfExport((recipients) => exportVisitsPdf(Number(range), recipients));

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRows(null);
    visitsPerService(Number(range))
      .then((r) => {
        if (!cancelled) {
          setRows(r.rows);
          setMeta({ from: r.from, to: r.to, total: r.total });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load report.');
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  async function handleExport() {
    if (exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      await downloadVisitsCsv(Number(range));
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Could not generate the report. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const data = (rows ?? []).map((r) => ({ service: r.serviceName, visits: r.count }));
  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const riseTransition = { type: 'spring', bounce: 0, duration: 0.35 } as const;

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
      <motion.div {...rise} transition={riseTransition} className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-5 text-slate-600">
          Completed visits only. Change the window to compare recent activity.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || rows === null}
            className={secondaryButton}
          >
            {exporting ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden />
            ) : (
              <Download size={16} aria-hidden />
            )}
            {exporting ? 'Generating…' : 'Export CSV'}
          </button>
          <SheetsExportButton
            exporting={sheets.exporting}
            disabled={rows === null}
            onClick={sheets.start}
            className={secondaryButton}
          />
          <PdfExportButton onClick={pdf.start} disabled={rows === null} className={secondaryButton} />
          <Segmented
            ariaLabel="Report range"
            value={range}
            onChange={setRange}
            options={[
              { key: '30', label: '30 days' },
              { key: '90', label: '90 days' },
            ]}
          />
        </div>
      </motion.div>

      {exportError && <InlineNotice>{exportError}</InlineNotice>}
      <SheetsExportNote result={sheets.result} error={sheets.error} />
      <PdfExportNote result={pdf.result} error={pdf.error} />
      {pdf.open && (
        <PdfExportDialog
          title="Export PDF"
          subtitle={`Visits per service · last ${range} days`}
          onCancel={pdf.close}
          onGenerate={pdf.run}
        />
      )}

      <motion.div
        {...rise}
        transition={{ ...riseTransition, delay: 0.04 }}
        className="grid gap-3.5 sm:grid-cols-3"
      >
        <StatTile
          icon={FileText}
          label="Completed visits"
          value={meta === null ? '—' : meta.total}
          hint={`Last ${range} days`}
        />
        <StatTile
          icon={CalendarCheck}
          label="Services used"
          value={rows === null ? '—' : rows.length}
          hint="At least one completed visit"
          tone="sky"
        />
        <StatTile
          icon={TrendingUp}
          label="Busiest service"
          value={rows && rows.length > 0 ? [...rows].sort((a, b) => b.count - a.count)[0].serviceName : '—'}
          hint={rows && rows.length > 0 ? `${[...rows].sort((a, b) => b.count - a.count)[0].count} visits` : 'No visits yet'}
          tone="slate"
        />
      </motion.div>

      <motion.section {...rise} transition={{ ...riseTransition, delay: 0.08 }} className={panel}>
        <CardHeading
          title="Visits per service"
          description={
            meta
              ? `Completed visits, ${meta.from} → ${meta.to}.`
              : `Completed visits in the last ${range} days.`
          }
        />
        <div className="mt-5">
          {error && <InlineNotice>{error}</InlineNotice>}
          {rows === null && !error && <EmptyNote>Loading report…</EmptyNote>}
          {rows !== null && rows.length === 0 && !error && (
            <EmptyNote>
              No completed visits in this window yet. Complete a visit in the appointments queue and it shows up
              here.
            </EmptyNote>
          )}
          {rows !== null && rows.length > 0 && (
            <BarChart data={data} xDataKey="service">
              <Grid horizontal />
              <Bar dataKey="visits" fill="var(--chart-line-primary)" lineCap="round" />
              <BarXAxis />
              <ChartTooltip />
            </BarChart>
          )}
        </div>
      </motion.section>
    </DashboardShell>
  );
}
