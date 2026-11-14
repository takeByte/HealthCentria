import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AnnouncementFeed } from '../components/announcement-feed';
import { PublicHeader } from '../components/public-header';
import { listAnnouncements, type Announcement } from '../lib/api';

export const Route = createFileRoute('/announcements')({
  component: PublicAnnouncements,
});

function PublicAnnouncements() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnnouncements()
      .then((r) => {
        if (!cancelled) setItems(r.announcements);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load announcements.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader inner="max-w-3xl" />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Announcements</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Schedule changes, vaccination days, and health advisories from the center. No login needed.
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {items === null && !error && <p className="text-sm text-slate-500">Loading announcements…</p>}
        {items !== null && <AnnouncementFeed items={items} collapsible={false} />}
      </main>
    </div>
  );
}
