import { Link, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ComponentType } from 'react';
import { CalendarCheck, LogOut, Menu, X } from 'lucide-react';
import { clearSession } from '../lib/auth';
import { listNotifications, type NotificationItem } from '../lib/api';
import { AppBackdrop } from './app-backdrop';
import { BellDot, NotificationCenter } from './notifications';
import { cn } from '../lib/utils';
import appLogo from '../assets/E-Kalinga_Logo.png';

export interface ShellNavItem {
  label: string;
  /** Omitted while the destination screen is not built yet — rendered disabled with a "soon" hint. */
  to?: string;
  icon: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

interface DashboardShellProps {
  title: string;
  /** One quiet line under the page title — a date, a count, a role hint. */
  subtitle?: string;
  roleLabel: string;
  userName?: string;
  userEmail: string;
  /** "Name — detail". Split at the dash so the sidebar can show both halves. */
  todayService: string;
  nav: ShellNavItem[];
  notificationsTo: '/app/notifications' | '/staff/notifications';
  /** Extra classes for the content wrapper — use to widen/narrow a single page's layout. */
  mainClassName?: string;
  children: React.ReactNode;
}

function splitToday(todayService: string): { name: string; detail: string } {
  const i = todayService.indexOf(' — ');
  if (i === -1) return { name: todayService, detail: '' };
  return { name: todayService.slice(0, i), detail: todayService.slice(i + 3) };
}

function SidebarBody({
  nav,
  roleLabel,
  todayService,
}: Pick<DashboardShellProps, 'nav' | 'roleLabel' | 'todayService'>) {
  const today = splitToday(todayService);

  return (
    <div className="flex h-full flex-col">
      {/* Brand lockup — the E-Kalinga seal is the app's anchor top-left. */}
      <div className="px-4 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <img
            src={appLogo}
            alt=""
            className="size-10 shrink-0 rounded-xl border border-slate-200/80 bg-white object-cover shadow-[0_2px_8px_rgba(15,60,90,0.10)]"
          />
          <div className="min-w-0">
            <p className="font-display text-[15px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
              HealthCentria
            </p>
            <p className="mt-1 truncate text-[11px] font-medium leading-none text-slate-500">
              Brgy. 11 Health Center
            </p>
          </div>
        </div>
        <span className="mt-3 inline-flex items-center rounded-full bg-teal-600/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-teal-800">
          {roleLabel}
        </span>
      </div>

      {/* Today's schedule, quiet enough to sit above the nav without shouting. */}
      <div className="mx-3 mb-4 rounded-xl border border-teal-600/15 bg-teal-50/80 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-teal-700">
          <CalendarCheck size={12} aria-hidden />
          Today
        </p>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-teal-950">{today.name}</p>
        {today.detail && (
          <p className="mt-0.5 text-[11px] leading-snug text-teal-800/70">{today.detail}</p>
        )}
      </div>

      <p className="px-5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Menu</p>
      <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4">
        {nav.map((item) => {
          const Icon = item.icon;
          if (!item.to) {
            return (
              <span
                key={item.label}
                aria-disabled="true"
                title="Coming next"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-slate-400"
              >
                <Icon size={17} aria-hidden />
                {item.label}
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide">soon</span>
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              to={item.to}
              /* Exact: /app/appointments/new must not also light up
                 /app/appointments in the sidebar. */
              activeOptions={{ exact: true }}
              activeProps={{
                className:
                  'bg-white font-semibold text-teal-900 shadow-[0_1px_2px_rgba(15,60,90,0.08)] ring-1 ring-teal-600/15 [&>svg]:text-teal-600',
              }}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-slate-600 transition-colors hover:bg-white/80 hover:text-slate-900 active:scale-[0.99] [&>svg]:text-slate-400"
            >
              <Icon size={17} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function DashboardShell({
  title,
  subtitle,
  roleLabel,
  userName,
  userEmail,
  todayService,
  nav,
  notificationsTo,
  mainClassName,
  children,
}: DashboardShellProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [drawer, setDrawer] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [bellItems, setBellItems] = useState<NotificationItem[] | null>(null);
  const initial = userName?.trim()?.charAt(0) ?? userEmail.trim().charAt(0).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((r) => {
        if (!cancelled) {
          setUnread(r.unread);
          setBellItems(r.notifications.slice(0, 10));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function openBell() {
    setBellOpen(true);
    try {
      const r = await listNotifications();
      setUnread(r.unread);
      setBellItems(r.notifications.slice(0, 10));
    } catch {
      // Drawer keeps last known state; page shows the error.
    }
  }

  async function logout() {
    clearSession();
    await navigate({ to: '/login' });
  }

  return (
    <div className="relative min-h-screen">
      <AppBackdrop />

      {/* Desktop sidebar */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[17rem] border-r border-white/70 lg:block">
        <SidebarBody nav={nav} roleLabel={roleLabel} todayService={todayService} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              aria-hidden
              onClick={() => setDrawer(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px] lg:hidden"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -300 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -300 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="app-sidebar fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85vw] shadow-2xl lg:hidden"
            >
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
                className="absolute right-2.5 top-3.5 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-white/70"
              >
                <X size={20} />
              </button>
              <SidebarBody nav={nav} roleLabel={roleLabel} todayService={todayService} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {bellOpen && (
          <>
            <motion.div
              aria-hidden
              onClick={() => setBellOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px]"
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Notifications"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 300 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 300 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="fixed inset-y-0 right-0 z-50 flex w-96 max-w-[92vw] flex-col bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 px-5 py-4">
                <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-slate-900">
                  Notifications
                </h2>
                <button
                  type="button"
                  onClick={() => setBellOpen(false)}
                  aria-label="Close notifications"
                  className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {bellItems === null ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : (
                  <NotificationCenter
                    items={bellItems}
                    onChanged={(items) => {
                      setBellItems(items);
                      setUnread(items.filter((i) => !i.read).length);
                    }}
                  />
                )}
              </div>
              <div className="border-t border-slate-200/60 p-3">
                <Link
                  to={notificationsTo}
                  onClick={() => setBellOpen(false)}
                  className="flex h-11 items-center justify-center rounded-lg text-sm font-medium text-teal-700 hover:bg-teal-50"
                >
                  View all notifications
                </Link>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-[17rem]">
        <header className="app-chrome sticky top-0 z-20 border-b border-white/60">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-7">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
              className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-white/80 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[17px] font-semibold leading-tight tracking-[-0.02em] text-slate-900">
                {title}
              </h1>
              {subtitle && (
                <p className="truncate text-[11.5px] font-medium leading-tight text-slate-500">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={openBell}
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                aria-haspopup="dialog"
                className="rounded-lg active:scale-[0.97]"
              >
                <BellDot unread={unread} />
              </button>
              <span className="mx-1 hidden h-6 w-px bg-slate-200/80 sm:block" aria-hidden />
              <div className="hidden items-center gap-2.5 sm:flex">
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-600 to-blue-600 text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                >
                  {initial}
                </span>
                <span className="hidden max-w-40 truncate text-[13px] font-medium text-slate-700 xl:block">
                  {userEmail}
                </span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-white/80 active:scale-[0.97]"
              >
                <LogOut size={17} aria-hidden />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          </div>
        </header>

        <main className={cn('mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-7 sm:py-8', mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}
