import { useEffect, useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { InlineNotice, SuccessNote } from './app-ui';
import { type SheetsExportResult } from '../lib/api';

/**
 * What happened after "Export to Google Sheets" (inside the Export dialog). The
 * link is shown instead of opened automatically: browsers block pop-ups that
 * open after a request.
 */
export function SheetsExportNote({
  result,
  error,
}: {
  result: SheetsExportResult | null;
  error: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Bring the confirmation (or the error) into view: it can sit below the fold.
  useEffect(() => {
    if (result || error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [result, error]);

  if (error) {
    return (
      <div ref={ref}>
        <InlineNotice>{error}</InlineNotice>
      </div>
    );
  }
  if (!result) return null;
  return (
    <div ref={ref} role="status">
      <SuccessNote className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Done! Exported to Google Sheets as <strong>{result.tab}</strong>
          {typeof result.rows === 'number' ? ` (${result.rows} rows)` : ''}.
        </span>
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-[var(--brand-deep)] underline-offset-4 hover:underline"
        >
          Open in Google Sheets <ExternalLink size={14} aria-hidden />
        </a>
      </SuccessNote>
    </div>
  );
}
