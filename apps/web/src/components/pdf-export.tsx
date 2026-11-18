import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, LoaderCircle, Lock, Search } from 'lucide-react';
import { InlineNotice, SuccessNote, inputClass } from './app-ui';
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
 * The PDF choices inside the Export dialog: upload to Google Drive (or just
 * download) and, when uploading, who else gets the link by email. People come
 * from active staff/admin accounts only (no typed addresses); the superadmin is
 * always included. The server checks the list again, uploads the PDF to Drive
 * and sends the emails. Unticked = download only.
 *
 * Reports the current choice through onChange once the staff list has loaded
 * (or failed to), so the dialog can keep its Export button disabled until then.
 */
export function PdfOptionsPanel({
  disabled,
  onChange,
}: {
  disabled?: boolean;
  onChange: (options: PdfExportOptions) => void;
}) {
  const me = getSession()?.email?.toLowerCase() ?? '';
  const [options, setOptions] = useState<ExportRecipientOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options?.recipients ?? [];
    return q ? list.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) : list;
  }, [options, query]);

  const driveReady = options?.driveReady ?? false;
  const upload = driveReady && uploadChoice;
  const loaded = options !== null || loadError !== null;

  useEffect(() => {
    if (!loaded) return;
    onChange({ recipients: upload ? [...picked] : [], uploadToDrive: upload });
  }, [loaded, upload, picked, onChange]);

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_RECIPIENTS) next.add(id);
      return next;
    });
  }

  return (
    <div>
      <label
        className={cn(
          'flex items-start gap-3 rounded-xl px-3.5 py-3 ring-1 ring-inset',
          upload ? 'bg-[var(--brand-tint)]/60 ring-[var(--brand-deep)]/25' : 'bg-white ring-slate-200',
          driveReady && !disabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          type="checkbox"
          checked={upload}
          disabled={!driveReady || disabled}
          onChange={(e) => setUploadChoice(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand-deep)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-900">Upload to Google Drive</span>
          <span className="block text-[12px] leading-5 text-slate-500">
            {options === null && !loadError
              ? 'Checking Google Drive…'
              : !driveReady
                ? 'Not available right now.'
                : upload
                  ? `Saved to “${options?.driveFolderName || 'the Drive folder'}” and the link is emailed.`
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
          {options.driveMessage || 'Google Drive is not available.'} The PDF will still download, but it won&apos;t be
          saved to Drive or emailed.
        </p>
      )}

      {options === null && !loadError ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-500">
          <LoaderCircle size={15} className="animate-spin" aria-hidden /> Loading staff list…
        </p>
      ) : (
        options && (
          <div
            className={cn('mt-2 flex min-h-0 flex-col', (!upload || disabled) && 'pointer-events-none opacity-50')}
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

            <ul className="mt-2 max-h-56 min-h-0 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200">
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
                        className="size-4 shrink-0 accent-[var(--brand-deep)]"
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
                          r.role === 'admin' ? 'bg-sky-600/10 text-sky-800' : 'bg-[var(--brand-deep)]/10 text-[var(--brand-deep)]',
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
            className="inline-flex items-center gap-1 font-semibold text-[var(--brand-deep)] underline-offset-4 hover:underline"
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
