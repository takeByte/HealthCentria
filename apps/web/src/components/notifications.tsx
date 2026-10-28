import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { markAllNotificationsRead, markNotificationRead, type NotificationItem } from '../lib/api';
import { cn } from '../lib/utils';
import { EmptyNote, chipButton } from './app-ui';

const KNOWN_LINKS = [
  '/app/dashboard',
  '/app/appointments',
  '/app/announcements',
  '/staff/dashboard',
  '/staff/appointments',
  '/staff/announcements',
] as const;

type KnownLink = (typeof KNOWN_LINKS)[number];

function knownLink(link: string): KnownLink | null {
  return (KNOWN_LINKS as readonly string[]).includes(link) ? (link as KnownLink) : null;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Shared inbox used by the patient and staff notification pages. */
export function NotificationCenter({
  items,
  onChanged,
}: {
  items: NotificationItem[];
  onChanged: (items: NotificationItem[]) => void;
}) {
  const [clearing, setClearing] = useState(false);

  async function open(item: NotificationItem) {
    if (!item.read) {
      try {
        await markNotificationRead(item.id);
        onChanged(items.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
      } catch {
        // Opening the link still works; the dot clears on next load.
      }
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await markAllNotificationsRead();
      onChanged(items.map((x) => ({ ...x, read: true })));
    } catch {
      // Ignore — badge refreshes on next load.
    } finally {
      setClearing(false);
    }
  }

  const unread = items.filter((i) => !i.read).length;

  if (items.length === 0) {
    return (
      <EmptyNote className="px-5 py-6">
        No notifications yet. Appointment updates, announcements, and reminders will appear here.
      </EmptyNote>
    );
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <p className="text-[12px] font-medium text-slate-500" role="status">
          {unread === 0 ? 'All caught up' : `${unread} unread`}
        </p>
        {unread > 0 && (
          <button type="button" onClick={clear} disabled={clearing} className={chipButton}>
            Mark all read
          </button>
        )}
      </div>

      <ul className="app-card divide-y divide-slate-200/70 overflow-hidden">
        {items.map((item) => {
          const dest = knownLink(item.link);
          const cls =
            'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/70 active:bg-white';
          const row = (
            <>
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  item.read ? 'bg-slate-200' : 'bg-teal-600',
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-[13.5px] leading-snug',
                    item.read ? 'font-medium text-slate-600' : 'font-semibold text-slate-900',
                  )}
                >
                  {item.title}
                </span>
                {item.body && (
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-slate-600">{item.body}</span>
                )}
                {timeAgo(item.createdAt) && (
                  <span className="mt-1 block text-[11px] font-medium text-slate-400">
                    {timeAgo(item.createdAt)}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {dest ? (
                <Link to={dest} onClick={() => open(item)} className={cls}>
                  {row}
                </Link>
              ) : (
                <button type="button" onClick={() => open(item)} className={cls}>
                  {row}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BellDot({ unread }: { unread: number }) {
  return (
    <span className="relative flex size-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-white/80">
      <Bell size={19} aria-hidden />
      {unread > 0 && (
        <span
          aria-label={`${unread} unread notifications`}
          className="absolute right-1 top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </span>
  );
}
