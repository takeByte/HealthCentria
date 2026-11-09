import { Link } from '@tanstack/react-router';
import { cn } from '../lib/utils';
import appLogo from '../assets/E-Kalinga_Logo.png';

/** Shared sticky header for public pages (home, announcements, auth). */
export function PublicHeader({ inner = 'max-w-6xl' }: { inner?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl">
      <div className={cn('mx-auto flex h-16 w-full items-center gap-3 px-4 sm:px-6', inner)}>
        <Link to="/" className="flex items-center gap-2.5" aria-label="HealthCentria home">
          <img
            src={appLogo}
            alt="HealthCentria logo"
            className="size-9 rounded-full border border-slate-200 bg-white object-cover"
          />
          <span className="leading-tight">
            <span className="block text-base font-bold tracking-tight text-slate-900">
              HealthCentria
            </span>
            <span className="block text-[11px] font-medium text-slate-500">
              Brgy. 11 Health Center
            </span>
          </span>
        </Link>
        <nav aria-label="Public" className="ml-auto flex items-center gap-1 text-sm sm:gap-2">
          <Link
            to="/announcements"
            activeOptions={{ exact: true }}
            activeProps={{ className: 'bg-gradient-to-r from-teal-600 to-blue-600 text-white', 'aria-current': 'page' }}
            inactiveProps={{ className: 'text-slate-600' }}
            className="rounded-xl px-3 py-2 font-medium transition-colors hover:bg-slate-100 active:scale-[0.97]"
          >
            Announcements
          </Link>
          <Link
            to="/login"
            activeOptions={{ exact: true }}
            activeProps={{ className: 'bg-gradient-to-r from-teal-600 to-blue-600 text-white', 'aria-current': 'page' }}
            inactiveProps={{ className: 'text-slate-600' }}
            className="rounded-xl px-3 py-2 font-medium transition-colors hover:bg-slate-100 active:scale-[0.97]"
          >
            Log in
          </Link>
          <Link
            to="/register"
            activeOptions={{ exact: true }}
            activeProps={{ className: 'bg-gradient-to-r from-teal-600 to-blue-600 text-white', 'aria-current': 'page' }}
            inactiveProps={{ className: 'text-slate-600' }}
            className="rounded-xl px-3 py-2 font-medium transition-colors hover:bg-slate-100 active:scale-[0.97]"
          >
            Register
          </Link>
        </nav>
      </div>
    </header>
  );
}
