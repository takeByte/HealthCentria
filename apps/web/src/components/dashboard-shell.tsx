import { Link, useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ComponentType } from 'react';
import { CalendarCheck, CalendarDays, ChevronDown, LogOut, Menu, UserRound, X } from 'lucide-react';
import { clearSession, getSession } from '../lib/auth';
import { listNotifications, logoutRequest, type NotificationItem } from '../lib/api';
import { AppBackdrop } from './app-backdrop';
import { BellDot, NotificationCenter } from './notifications';
import { EmailVerificationBanner } from './email-verification-banner';
import { cn } from '../lib/utils';
import appLogo from '../assets/E-Kalinga_Logo.png';

export interface ShellNavItem {
  label: string;
  /** Omitted while the destination screen is not built yet — rendered disabled with a "soon" hint. */
  to?: string;
  icon: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Sidebar section this item belongs to. Items keep their array order inside a group. */
  group?: string;
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

/** Short date for the top bar, e.g. "Thu, Nov 12". */
function todayChipLabel(): string {
  return new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(),
  );
}

function groupNav(nav: ShellNavItem[]): Array<{ label: string; items: ShellNavItem[] }> {
  const groups: Array<{ label: string; items: ShellNavItem[] }> = [];
  for (const item of nav) {
    const label = item.group ?? 'Menu';
    const existing = groups.find((g) => g.label === label);
    if (existing) existing.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function SidebarBody({
  nav,
  roleLabel,
  todayService,
  userName,
  userEmail,
  avatarUrl,
  profileTo,
  onLogout,
  onClose,
}: {
  nav: ShellNavItem[];
  roleLabel: string;
  todayService: string;
  userName?: string;
  userEmail: string;
  avatarUrl?: string;
  /** Profile route the signed-in identity card links to, when the nav has one. */
  profileTo?: string;
  onLogout: () => void | Promise<void>;
  /** Drawer-only: renders a close control inside the brand card. */
  onClose?: () => void;
}) {
  const today = splitToday(todayService);
  const groups = groupNav(nav);
  const initial = userName?.trim()?.charAt(0) ?? userEmail.trim().charAt(0).toUpperCase();

  const identity = (
    <>
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#14b8a6] text-[12px] font-bold text-white ring-1 ring-white/25"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12px] font-semibold text-white">{userName ?? 'Signed in'}</span>
        <span className="block truncate text-[10px] text-white/65">{userEmail}</span>
      </span>
    </>
  );

  return (
    <div className="flex h-full flex-col px-3 py-3.5">
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        {/* Brand lockup — the E-Kalinga seal on a paper card anchors the top-left. */}
        <div className="flex items-center gap-3 rounded-2xl bg-white/96 p-2.5 shadow-[0_10px_28px_-18px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/40">
          <img src={appLogo} alt="" className="size-10 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-semibold leading-tight tracking-[-0.02em] text-[#134e4a]">
              E-Kalinga
            </p>
            <p className="mt-0.5 truncate text-[10.5px] font-medium leading-tight text-[#64748b]">
              Brgy. 11 Health Center
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#eef4f8] hover:text-[#134e4a]"
            >
              <X size={17} />
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#14b8a6]/22 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#99f6e4] ring-1 ring-inset ring-[#5eead4]/25">
            <span aria-hidden className="size-1.5 rounded-full bg-[#5eead4]" />
            {roleLabel}
          </span>
        </div>

        {/* Today's schedule, quiet enough to sit above the nav without shouting. */}
        <div className="mt-3.5 rounded-xl bg-black/15 px-3 py-2.5 ring-1 ring-inset ring-white/10">
          <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-[#99f6e4]">
            <CalendarCheck size={11} aria-hidden />
            Today at the clinic
          </p>
          <p className="mt-1 text-[12.5px] font-semibold leading-snug text-white">{today.name}</p>
          {today.detail && <p className="mt-0.5 text-[10.5px] leading-snug text-white/65">{today.detail}</p>}
        </div>

        <nav aria-label="Primary" className="mt-5 flex flex-col gap-4 pb-2">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-2.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/65">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  if (!item.to) {
                    return (
                      <span
                        key={item.label}
                        aria-disabled="true"
                        title="Coming next"
                        className="flex h-9 cursor-not-allowed items-center gap-2.5 rounded-[0.6rem] px-2.5 text-[12.5px] text-white/35"
                      >
                        <Icon size={16} aria-hidden />
                        {item.label}
                        <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide">soon</span>
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
                          'bg-white font-semibold text-[#134e4a] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.45)]',
                      }}
                      inactiveProps={{
                        className: 'font-medium text-white/80 hover:bg-white/10 hover:text-white',
                      }}
                      className="group flex h-9 items-center gap-2.5 rounded-[0.6rem] px-2.5 text-[12.5px] transition-colors active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      <Icon size={16} aria-hidden className="shrink-0 opacity-80 group-hover:opacity-100" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Who is signed in, pinned to the bottom; log out never scrolls away. */}
      <div className="mt-3 shrink-0 rounded-xl bg-white/10 p-2 ring-1 ring-inset ring-white/12 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          {profileTo ? (
            <Link
              to={profileTo}
              title="Open my profile"
              className="-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {identity}
            </Link>
          ) : (
            <div className="-m-1 flex min-w-0 flex-1 items-center gap-2.5 p-1">{identity}</div>
          )}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <LogOut size={15} aria-hidden />
          </button>
        </div>
      </div>
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [bellItems, setBellItems] = useState<NotificationItem[] | null>(null);
  const session = getSession();
  const initial = userName?.trim()?.charAt(0) ?? userEmail.trim().charAt(0).toUpperCase();
  const profileTo = nav.find((item) => item.label === 'My Profile')?.to;
  const avatarUrl = session?.avatarUrl ?? '';

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
    // Record the sign-out first; a failed call must never keep the user signed in.
    try {
      await logoutRequest();
    } catch {
      // Ignore — the local session is cleared either way.
    }
    clearSession();
    await navigate({ to: '/login' });
  }

  return (
    <div className="relative min-h-screen">
      <AppBackdrop />

      {/* Desktop sidebar */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-[15rem] border-r border-[#042f2e]/40 lg:block">
        <SidebarBody
          nav={nav}
          roleLabel={roleLabel}
          todayService={todayService}
          userName={userName}
          userEmail={userEmail}
          avatarUrl={avatarUrl}
          profileTo={profileTo}
          onLogout={logout}
        />
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
              className="app-sidebar fixed inset-y-0 left-0 z-50 w-[15rem] max-w-[85vw] shadow-2xl lg:hidden"
            >
              <SidebarBody
                nav={nav}
                roleLabel={roleLabel}
                todayService={todayService}
                userName={userName}
                userEmail={userEmail}
                avatarUrl={avatarUrl}
                profileTo={profileTo}
                onLogout={logout}
                onClose={() => setDrawer(false)}
              />
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
                  className="flex h-11 items-center justify-center rounded-lg text-sm font-medium text-[#0f766e] hover:bg-[#eef4f8]"
                >
                  View all notifications
                </Link>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="app-main lg:pl-[15rem]">
        <header className="app-chrome sticky top-0 z-20 border-b border-[#e2e8f0]">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-7">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
              className="flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-[#eef4f8] lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[17px] font-semibold leading-tight tracking-[-0.02em] text-[#134e4a]">
                {title}
              </h1>
              {subtitle && (
                <p className="truncate text-[11.5px] font-medium leading-tight text-[#64748b]">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[#475569] md:inline-flex">
                <CalendarDays size={13} aria-hidden className="text-[#0f766e]" />
                {todayChipLabel()}
              </span>
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
              {profileTo ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={profileOpen}
                    aria-label="Open profile menu"
                    className="flex h-9 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-[#eef4f8] active:scale-[0.97]"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#14b8a6] to-[#0f766e] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="size-full object-cover"
                        />
                      ) : (
                        initial
                      )}
                    </span>
                    <span className="hidden max-w-40 truncate text-[13px] font-medium text-slate-700 xl:block">
                      {userName ?? userEmail}
                    </span>
                    <ChevronDown size={14} aria-hidden className="hidden text-slate-400 sm:block" />
                  </button>
                  <AnimatePresence>
                    {profileOpen && (
                      <>
                        <button
                          type="button"
                          aria-hidden
                          tabIndex={-1}
                          onClick={() => setProfileOpen(false)}
                          className="fixed inset-0 z-10 cursor-default"
                        />
                        <motion.div
                          role="menu"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white p-1 shadow-xl"
                        >
                          <div className="px-2.5 py-2">
                            <p className="truncate text-[12.5px] font-semibold text-[#042f2e]">
                              {userName ?? userEmail}
                            </p>
                            {userName && (
                              <p className="truncate text-[11px] text-[#94a3b8]">{userEmail}</p>
                            )}
                          </div>
                          <Link
                            to={profileTo}
                            role="menuitem"
                            onClick={() => setProfileOpen(false)}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#1e293b] hover:bg-[#f2f7fb]"
                          >
                            <UserRound size={16} aria-hidden /> My Profile
                          </Link>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setProfileOpen(false);
                              void logout();
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-[#1e293b] hover:bg-[#f2f7fb]"
                          >
                            <LogOut size={16} aria-hidden /> Log out
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <>
                  <div className="hidden items-center gap-2.5 sm:flex">
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#14b8a6] to-[#0f766e] text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(15,60,90,0.18)]"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="size-full object-cover"
                        />
                      ) : (
                        initial
                      )}
                    </span>
                    <span className="hidden max-w-40 truncate text-[13px] font-medium text-slate-700 xl:block">
                      {userName ?? userEmail}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 transition-colors hover:bg-[#eef4f8] active:scale-[0.97]"
                  >
                    <LogOut size={17} aria-hidden />
                    <span className="hidden sm:inline">Log out</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        <main className={cn('app-content mx-auto w-full space-y-5 py-6 sm:py-8', mainClassName)}>
          <EmailVerificationBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
