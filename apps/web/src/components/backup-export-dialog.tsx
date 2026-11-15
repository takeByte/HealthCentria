import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { InlineNotice, fieldLabel, selectClass } from './app-ui';
import { ExportDialog } from './export-dialog';
import { formatDateTime } from './record-meta';
import type { WithPin } from './super-pin';
import {
  ApiError,
  exportBackupCsv,
  exportBackupPdf,
  exportBackupToSheets,
  listBackupTables,
  type BackupSettings,
} from '../lib/api';

function fileSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Export dialog for Backups: pick the backup and the tables, then the format.
 * Every format needs the superadmin PIN (it copies patient data out of the
 * system), so each run goes through withPin.
 */
export function BackupExportDialog({
  files,
  withPin,
  onClose,
}: {
  files: BackupSettings['files'];
  withPin: WithPin;
  onClose: () => void;
}) {
  const [file, setFile] = useState(files[0]?.name ?? '');
  const [tables, setTables] = useState<Array<{ name: string; count: number }> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = [...picked];

  useEffect(() => {
    let cancelled = false;
    setTables(null);
    setLoadError('');
    setPicked(new Set());
    if (!file) return undefined;
    listBackupTables(file)
      .then((r) => {
        if (!cancelled) setTables(r.tables);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : 'Could not read this backup.');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  function toggle(name: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const count = list.length;
  const what = `${count} table${count === 1 ? '' : 's'} of a backup`;

  return (
    <ExportDialog
      title="Export backup data"
      summary="Pick a backup and the tables you want. Each export needs the superadmin PIN because it copies patient data out of the system. Passwords and keys are always hidden."
      hideWhileRunning
      disabledReason={count === 0 && tables ? 'Tick at least one table to export.' : undefined}
      csvHint="Downloads one ZIP file with a CSV file for each table. It opens in Excel."
      onClose={onClose}
      runCsv={() => withPin(`Export ${what} as CSV.`, (pin) => exportBackupCsv(file, list, pin))}
      runSheets={() => withPin(`Export ${what} to Google Sheets.`, (pin) => exportBackupToSheets(file, list, pin))}
      runPdf={(options) => withPin(`Export ${what} as a PDF.`, (pin) => exportBackupPdf(file, list, options, pin))}
    >
      <div>
        <label htmlFor="backup-export-file" className={fieldLabel}>
          Backup
        </label>
        <select id="backup-export-file" value={file} onChange={(e) => setFile(e.target.value)} className={selectClass}>
          {files.map((f) => (
            <option key={f.name} value={f.name}>
              {formatDateTime(f.createdAt)} · {fileSize(f.bytes)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold text-slate-700">Tables to export</p>
          {tables && (
            <div className="flex gap-3 text-[12.5px] font-semibold text-[#1f55a8]">
              <button
                type="button"
                onClick={() => setPicked(new Set(tables.filter((t) => t.count > 0).map((t) => t.name)))}
                className="underline"
              >
                Select all
              </button>
              <button type="button" onClick={() => setPicked(new Set())} className="underline">
                Clear
              </button>
            </div>
          )}
        </div>
        {loadError && <InlineNotice>{loadError}</InlineNotice>}
        {tables === null && !loadError && (
          <p className="flex items-center gap-2 text-[13px] text-slate-500">
            <LoaderCircle size={15} className="animate-spin" aria-hidden /> Reading the backup…
          </p>
        )}
        {tables && (
          <ul className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">
            {tables.map((t) => (
              <li key={t.name}>
                <label
                  className={
                    'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] ring-1 ring-inset ' +
                    (t.count === 0
                      ? 'cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200'
                      : picked.has(t.name)
                        ? 'cursor-pointer bg-[#eaf3fc]/60 text-slate-900 ring-[#1f55a8]/25'
                        : 'cursor-pointer bg-white text-slate-700 ring-slate-200')
                  }
                >
                  <input
                    type="checkbox"
                    checked={picked.has(t.name)}
                    disabled={t.count === 0}
                    onChange={() => toggle(t.name)}
                    className="size-4 shrink-0 accent-[#1f55a8]"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  <span className="text-[12px] text-slate-500">{t.count}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ExportDialog>
  );
}
