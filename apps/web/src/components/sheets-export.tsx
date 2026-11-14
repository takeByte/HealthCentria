import { useState } from 'react';
import { ExternalLink, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { InlineNotice, SuccessNote } from './app-ui';
import { ApiError, type SheetsExportResult } from '../lib/api';

/**
 * Shared "Export to Google Sheets" state. The link is shown in a note instead
 * of opened automatically: browsers block pop-ups that open after a request.
 */
export function useSheetsExport(run: () => Promise<SheetsExportResult>) {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<SheetsExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (exporting) return;
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await run());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not export to Google Sheets. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return { exporting, result, error, start, dismiss: () => setResult(null) };
}

export function SheetsExportButton({
  exporting,
  disabled,
  onClick,
  className,
}: {
  exporting: boolean;
  disabled?: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={exporting || disabled} className={className}>
      {exporting ? (
        <LoaderCircle size={16} className="animate-spin" aria-hidden />
      ) : (
        <FileSpreadsheet size={16} aria-hidden />
      )}
      {exporting ? 'Exporting…' : 'Export to Sheets'}
    </button>
  );
}

export function SheetsExportNote({
  result,
  error,
}: {
  result: SheetsExportResult | null;
  error: string | null;
}) {
  if (error) return <InlineNotice>{error}</InlineNotice>;
  if (!result) return null;
  return (
    <SuccessNote className="flex flex-wrap items-center justify-between gap-2">
      <span>
        Exported to Google Sheets as tab <strong>{result.tab}</strong>
        {typeof result.rows === 'number' ? ` (${result.rows} rows)` : ''}.
      </span>
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-[#1a448a] underline-offset-4 hover:underline"
      >
        Open in Google Sheets <ExternalLink size={14} aria-hidden />
      </a>
    </SuccessNote>
  );
}
