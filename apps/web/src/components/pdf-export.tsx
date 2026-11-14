import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileDown, LoaderCircle, Lock, Search } from 'lucide-react';
import { InlineNotice, SuccessNote, inputClass, primaryButton, secondaryButton } from './app-ui';
import { getSession } from '../lib/auth';
import {
  ApiError,
  listExportRecipients,
  type ExportRecipientOptions,
  type PdfExportOptions,
  type PdfExportResult,
} from '../lib/api';
import { cn } from '../lib/utils';

const MAX_RECIPIENTS = 10;

/**
 * "Export PDF" for Reports and the Activity log. A dialog lets the exporter
 * choose whether to upload to Google Drive and, if so, who else gets the
 * link, from active staff/admin accounts only (no typed addresses); the
 * superadmin is always included. The server checks the list again, uploads
 * the PDF to Drive and sends the emails. Unticked = download only.
 */
export function usePdfExport(run: (options: PdfExportOptions) => Promise<PdfExportResult>) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PdfExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return {
    open,
    result,
    error,
    start: () => {
      setResult(null);
      setError(null);
      setOpen(true);
    },
    close: () => setOpen(false),
    run: async (options: PdfExportOptions) => {
      setError(null);
      try {
        const r = await run(options);
        setResult(r);
        setOpen(false);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not generate the PDF. Try again.');
        setOpen(false);
      }
    },
  };
}

export function PdfExportButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  className: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      <FileDown size={16} aria-hidden />
      Export PDF
    </button>
  );
}

export function PdfExportDialog({
  title,
  subtitle,
  onCancel,
  onGenerate,
}: {
  title: string;
  subtitle: string;
  onCancel: () => void;
  onGenerate: (options: PdfExportOptions) => Promise<void>;
}) {
  const me = getSession()?.email?.toLowerCase() ?? '';
  const [options, setOptions] = useState<ExportRecipientOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Ticked by default; only takes effect while Drive is ready.
  const [uploadChoice, setUploadChoice] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listExportRecipients()
      .then((r) => {
        if (!cancelled) setOptions(r);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Could not load the staff list.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options?.recipients ?? [];
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) : list;
  }, [options, query]);

  const driveReady = options?.driveReady ?? false;
  const upload = driveReady && uploadChoice;

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_RECIPIENTS) next.add(id);
      return next;
    });
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    await onGenerate({ recipients: upload ? [...picked] : [], uploadToDrive: upload });
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-dialog-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_24px_70px_-28px_rgba(15,60,90,0.45)] sm:p-6"
      >
        <h2 id="pdf-dialog-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>

        <label
          className={cn(
            'mt-4 flex items-start gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset',
            upload ? 'bg-[#e9f7f4]/60 ring-[#0f766e]/25' : 'bg-white ring-slate-200',
            driveReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
          )}
        >
          <input
            type="checkbox"
            checked={upload}
            disabled={!driveReady || busy}
            onChange={(e) => setUploadChoice(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[#0f766e]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-slate-900">Upload to Google Drive</span>
            <span className="block text-[12px] leading-5 text-slate-500">
              {options === null
                ? 'Checking Google Drive…'
                : !driveReady
                  ? 'Not available right now.'
                  : upload
                    ? `Saved to “${options.driveFolderName || 'the Drive folder'}” and the link is emailed.`
                    : 'Download only. Nothing is saved to Drive and no one is emailed.'}
            </span>
          </span>
        </label>

        <p className={cn('mt-4 text-[12.5px] font-semibold text-slate-700', !upload && 'text-slate-400')}>
          Also email the Google Drive link to:
        </p>

        {loadError && <InlineNotice className="mt-2">{loadError}</InlineNotice>}
        {options && !driveReady && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
            {options.driveMessage || 'Google Drive is not available.'} The PDF will still download, but it won&apos;t
            be saved to Drive or emailed.
          </p>
        )}

        {options === null && !loadError ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-500">
            <LoaderCircle size={15} className="animate-spin" aria-hidden /> Loading staff list…
          </p>
        ) : (
          options && (
            <div
              className={cn('mt-2 flex min-h-0 flex-col', !upload && 'pointer-events-none opacity-50')}
              aria-disabled={!upload}
            >
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or email"
                  aria-label="Search staff and admins"
                  disabled={!upload}
                  className={`${inputClass} h-10 pl-9`}
                />
              </div>

              <ul className="mt-2 min-h-0 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200">
                {options.superadminNotified && (
                  <li className="flex items-center gap-3 bg-slate-50/80 px-3 py-2.5">
                    <Lock size={15} className="shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1 text-[13px] text-slate-700">
                      <span className="font-semibold">Superadmin</span>
                      <span className="text-slate-500"> · always notified</span>
                    </span>
                  </li>
                )}
                {visible.length === 0 && (
                  <li className="px-3 py-3 text-[13px] text-slate-500">No staff or admin matches “{query.trim()}”.</li>
                )}
                {visible.map((r) => {
                  const checked = picked.has(r.id);
                  const full = !checked && picked.size >= MAX_RECIPIENTS;
                  return (
                    <li key={r.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50',
                          full && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={full || !upload}
                          onChange={() => toggle(r.id)}
                          className="size-4 shrink-0 accent-[#0f766e]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-slate-900">
                            {r.name}
                            {r.email.toLowerCase() === me && <span className="font-normal text-slate-500"> (you)</span>}
                          </span>
                          <span className="block truncate text-[12px] text-slate-500">{r.email}</span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em]',
                            r.role === 'admin' ? 'bg-sky-600/10 text-sky-800' : 'bg-[#0f766e]/10 text-[#115e59]',
                          )}
                        >
                          {r.role}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11.5px] leading-4 text-slate-500">
                {upload
                  ? `${picked.size} picked (max ${MAX_RECIPIENTS}). Each person gets view access to this one file. Opening it needs a Google account with the same email.`
                  : 'Turn on “Upload to Google Drive” to email the link.'}
              </p>
            </div>
          )
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={generate} disabled={busy || options === null} className={primaryButton}>
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <FileDown size={16} aria-hidden />}
            {busy ? 'Generating…' : upload ? 'Generate PDF' : 'Download PDF'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** What happened after the download: Drive link and email count, or why not. */
export function PdfExportNote({ result, error }: { result: PdfExportResult | null; error: string | null }) {
  if (error) return <InlineNotice>{error}</InlineNotice>;
  if (!result) return null;
  if (result.driveStatus === 'off') {
    return <SuccessNote>PDF downloaded. It was not uploaded to Google Drive, as chosen.</SuccessNote>;
  }
  if (result.driveStatus === 'uploaded') {
    return (
      <SuccessNote className="flex flex-wrap items-center justify-between gap-2">
        <span>
          PDF downloaded and saved to Google Drive.{' '}
          {result.emailedCount > 0
            ? `The link was emailed to ${result.emailedCount} ${result.emailedCount === 1 ? 'person' : 'people'}.`
            : 'No one was emailed.'}
        </span>
        {result.driveLink && (
          <a
            href={result.driveLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[#115e59] underline-offset-4 hover:underline"
          >
            Open in Drive <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </SuccessNote>
    );
  }
  return (
    <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 ring-1 ring-inset ring-amber-600/20">
      PDF downloaded.{' '}
      {result.driveStatus === 'failed'
        ? `The Google Drive upload failed: ${result.driveMessage}`
        : `It was not saved to Drive or emailed: ${result.driveMessage}`}
    </p>
  );
}
