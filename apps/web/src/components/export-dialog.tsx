import { motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FileDown, FileSpreadsheet, FileText, LoaderCircle, X } from 'lucide-react';
import { InlineNotice, primaryButton, secondaryButton } from './app-ui';
import { PdfExportNote, PdfOptionsPanel } from './pdf-export';
import { SheetsExportNote } from './sheets-export';
import { PinCancelled } from './super-pin';
import { ApiError, type PdfExportOptions, type PdfExportResult, type SheetsExportResult } from '../lib/api';
import { cn } from '../lib/utils';

export type ExportFormat = 'csv' | 'sheets' | 'pdf';

const FORMAT_KEY = 'healthcentria.exportFormat';

const FORMATS: Array<{
  key: ExportFormat;
  label: string;
  hint: string;
  icon: typeof FileText;
}> = [
  { key: 'csv', label: 'CSV', hint: 'A file for Excel', icon: FileDown },
  { key: 'sheets', label: 'Google Sheets', hint: 'A new tab online', icon: FileSpreadsheet },
  { key: 'pdf', label: 'PDF', hint: 'A printable report', icon: FileText },
];

function rememberedFormat(): ExportFormat {
  try {
    const value = window.localStorage.getItem(FORMAT_KEY);
    if (value === 'csv' || value === 'sheets' || value === 'pdf') return value;
  } catch {
    // storage can be blocked; fall back to CSV
  }
  return 'csv';
}

type Outcome =
  | { format: 'csv' }
  | { format: 'sheets'; result: SheetsExportResult }
  | { format: 'pdf'; result: PdfExportResult };

/**
 * One "Export" dialog for Activity log, Reports and Backups. The person picks the
 * format (CSV, Google Sheets or PDF); the PDF choice shows the Google Drive upload
 * and who to email, exactly as before. The result stays inside the dialog, so it
 * is obvious that the export worked.
 *
 * `hideWhileRunning` tucks the dialog away while a request is in flight, so the
 * superadmin PIN prompt (Backups) is not stacked on top of it.
 */
export function ExportDialog({
  title,
  summary,
  children,
  disabledReason,
  csvHint,
  hideWhileRunning = false,
  onClose,
  runCsv,
  runSheets,
  runPdf,
}: {
  title: string;
  /** What is being exported, e.g. "Activity log · current filters". */
  summary: string;
  /** Extra choices above the format picker, e.g. the Backups table picker. */
  children?: ReactNode;
  /** When set, Export is disabled and this explains why. */
  disabledReason?: string;
  csvHint?: string;
  hideWhileRunning?: boolean;
  onClose: () => void;
  runCsv: () => Promise<void>;
  runSheets: () => Promise<SheetsExportResult>;
  runPdf: (options: PdfExportOptions) => Promise<PdfExportResult>;
}) {
  const [format, setFormat] = useState<ExportFormat>(rememberedFormat);
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handlePdfOptions = useCallback((options: PdfExportOptions) => setPdfOptions(options), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, onClose]);

  function pick(next: ExportFormat) {
    if (running) return;
    setFormat(next);
    setOutcome(null);
    setError(null);
    try {
      window.localStorage.setItem(FORMAT_KEY, next);
    } catch {
      // not critical
    }
  }

  async function start() {
    if (running) return;
    setRunning(true);
    setError(null);
    setOutcome(null);
    try {
      if (format === 'csv') {
        await runCsv();
        setOutcome({ format: 'csv' });
      } else if (format === 'sheets') {
        setOutcome({ format: 'sheets', result: await runSheets() });
      } else if (pdfOptions) {
        setOutcome({ format: 'pdf', result: await runPdf(pdfOptions) });
      }
    } catch (err) {
      // Closing the superadmin PIN prompt is a choice, not an error.
      if (!(err instanceof PinCancelled)) {
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Export failed. Try again.');
      }
    } finally {
      setRunning(false);
    }
  }

  const waitingForPdfOptions = format === 'pdf' && pdfOptions === null;
  const blocked = Boolean(disabledReason) || waitingForPdfOptions;
  const done = outcome !== null && outcome.format === format;
  const goLabel =
    format === 'pdf' && pdfOptions?.uploadToDrive
      ? 'Export PDF and upload to Drive'
      : format === 'pdf'
        ? 'Download PDF'
        : format === 'sheets'
          ? 'Export to Google Sheets'
          : 'Download CSV';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]',
        hideWhileRunning && running && 'hidden',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 id="export-dialog-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900">
              {title}
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 sm:px-6">
          {children}

          <div>
            <p className="mb-2 text-[12.5px] font-semibold text-slate-700">Export as</p>
            <div role="radiogroup" aria-label="Export format" className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const active = format === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pick(f.key)}
                    disabled={running}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-center ring-1 ring-inset transition-colors disabled:opacity-60',
                      active
                        ? 'bg-[#eaf3fc]/70 text-[#1a448a] ring-2 ring-[#1f55a8]'
                        : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
                    )}
                  >
                    <Icon size={20} aria-hidden />
                    <span className="text-[13px] font-semibold">{f.label}</span>
                    <span className="text-[11px] leading-4 text-slate-500">{f.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {format === 'csv' && (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-slate-600">
              {csvHint ?? 'Downloads a CSV file you can open in Excel or Google Sheets.'}
            </p>
          )}
          {format === 'sheets' && (
            <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-slate-600">
              Adds a new tab to the clinic&apos;s Google Sheets export spreadsheet and gives you the link.
            </p>
          )}
          {format === 'pdf' && <PdfOptionsPanel disabled={running} onChange={handlePdfOptions} />}

          {disabledReason && <p className="text-[12.5px] text-slate-500">{disabledReason}</p>}
          {error && <InlineNotice>{error}</InlineNotice>}
          {done && outcome.format === 'csv' && (
            <p
              role="status"
              className="rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold leading-5 text-emerald-900 ring-1 ring-inset ring-emerald-600/20"
            >
              Exported. Your CSV file was downloaded.
            </p>
          )}
          {done && outcome.format === 'sheets' && <SheetsExportNote result={outcome.result} error={null} />}
          {done && outcome.format === 'pdf' && <PdfExportNote result={outcome.result} error={null} />}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={running} className={secondaryButton}>
            {done ? 'Done' : 'Cancel'}
          </button>
          <button type="button" onClick={start} disabled={running || blocked} className={primaryButton}>
            {running && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
            {running ? 'Exporting…' : done ? 'Export again' : goLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
