import { createFileRoute, Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, ClipboardList, MapPin, Megaphone, Stethoscope } from 'lucide-react';
import { PublicHeader } from '../components/public-header';
import { SoftBlueBackdrop } from '../components/soft-blue-backdrop';
import { listAnnouncements, listServices, CATEGORY_LABELS, type Announcement, type Service } from '../lib/api';
import barangayHall from '../assets/barangayhall.png';
import barangayLogo from '../assets/Barangay11_logo.png';
import cityLogo from '../assets/CityofMalaybalay_Logo.png';
import ekalingaLogo from '../assets/E-Kalinga_Logo.png';
import krmcLogo from '../assets/KRMC_Logo.png';

export const Route = createFileRoute('/')({
  component: HomePage,
});

/**
 * Landing page frame: gutters grow to roughly an inch and a half (144px) per
 * side on wide screens so the content uses the available width instead of
 * floating in a narrow column. Capped so ultra-wide monitors keep a comfortable
 * line length.
 */
const PAGE_CONTAINER = 'mx-auto w-full max-w-[1728px] px-4 sm:px-8 lg:px-20 xl:px-36';

// useReducedMotion() returns boolean | null (null before hydration resolves).
const fade = (delay: number, reduce: boolean | null) => ({
  initial: reduce ? { opacity: 0 } : { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring' as const, bounce: 0, duration: 0.4, delay },
});

const STEPS = [
  {
    title: 'Create your account',
    body: 'Register once with your email and contact details so the center can reach you.',
  },
  {
    title: 'Pick a service and date',
    body: 'See the live schedule for each service and choose an open day that suits you.',
  },
  {
    title: 'Track and visit',
    body: 'Get a confirmation when the front desk accepts your request, and review your records afterwards.',
  },
];

const PROMISES = [
  {
    icon: Stethoscope,
    title: 'Clinical services',
    body: 'Consultations, immunization days, and routine care run on published schedules.',
  },
  {
    icon: CalendarDays,
    title: 'Real availability',
    body: 'Book against the same schedule the front desk sees, so no wasted trips.',
  },
  {
    icon: ClipboardList,
    title: 'Your records, kept',
    body: 'Diagnosis, prescriptions, and visit notes stay available to you after each appointment.',
  },
  {
    icon: Megaphone,
    title: 'Announcements first',
    body: 'Schedule changes and health advisories are posted publicly, before you walk in.',
  },
];

/** Partners shown in the landing-page strip; order is the marquee reading order. */
const partners = [
  {
    name: 'City of Malaybalay',
    logo: cityLogo,
    logoAlt: 'City of Malaybalay official seal',
    frame: 'border-slate-200 bg-white',
  },
  {
    name: 'HealthCentria',
    logo: ekalingaLogo,
    logoAlt: 'HealthCentria logo',
    frame: 'border-slate-800 bg-slate-900',
  },
  {
    name: 'Barangay 11',
    logo: barangayLogo,
    logoAlt: 'Barangay 11 logo',
    frame: 'border-slate-200 bg-white',
  },
  {
    name: 'KRMC',
    logo: krmcLogo,
    logoAlt: 'KRMC logo',
    frame: 'border-slate-200 bg-white',
  },
];

/**
 * The marquee renders the partner list this many times and slides by half its
 * width. The count is even and the repeated units are identical, so the slide
 * lands exactly on the next unit, and the strip stays wider than the card on
 * wide screens (no blank space before the loop restarts).
 */
const MARQUEE_UNITS = 8;

function HomePage() {
  const reduceMotion = useReducedMotion();
  const [services, setServices] = useState<Service[] | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    // Both endpoints are public. A failure here must not blank the page,
    // so the sections just render in their empty state.
    let cancelled = false;

    listServices()
      .then((r) => {
        if (!cancelled) setServices(r.services.filter((s) => s.active).slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setServices([]);
      });

    listAnnouncements()
      .then((r) => {
        if (!cancelled) setAnnouncements(r.announcements.slice(0, 2));
      })
      .catch(() => {
        if (!cancelled) setAnnouncements([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative isolate min-h-screen overflow-x-clip bg-white">
      <SoftBlueBackdrop />
      <PublicHeader inner={PAGE_CONTAINER} />

      <main className={PAGE_CONTAINER}>
        <section className="relative py-14 text-center sm:py-20">
          {/* Full-bleed tinted band, like the reference hero, fading into the page. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-full w-screen -translate-x-1/2 bg-[linear-gradient(102deg,#eef6ff_0%,#e9f7f4_42%,#e2f7ee_74%,#ddf4ea_100%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-full w-screen -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,255,255,0)_55%,rgba(255,255,255,0.92)_100%)]"
          />

          <motion.div
            {...fade(0, reduceMotion)}
            className="mx-auto flex max-w-4xl flex-col items-center"
          >
            <p className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/75 py-1 pl-1.5 pr-3 text-xs font-semibold text-slate-700 shadow-[0_6px_20px_rgba(15,60,90,0.08)] backdrop-blur">
              <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                New
              </span>
              Community health center
              <ChevronRight size={13} className="text-slate-400" aria-hidden />
            </p>

            <h1 className="mt-7 font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] text-balance text-slate-900 sm:text-5xl lg:text-6xl">
              Smarter health care,
              <br className="hidden sm:block" /> for every barangay resident.
            </h1>

            <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Check the schedule for every service, request an appointment online, and stay updated on
              vaccination days and schedule changes — no account needed to read announcements.
            </p>

            <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
              <Link
                to="/announcements"
                className="inline-flex h-12 w-full items-center justify-center rounded-full border border-teal-700/50 bg-white/40 px-7 font-medium text-teal-800 transition hover:bg-white/80 active:scale-[0.98] sm:w-auto"
              >
                View announcements
              </Link>
              <Link
                to="/register"
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-teal-700 px-7 font-medium text-white shadow-[0_14px_30px_-12px_rgba(15,118,110,0.85)] transition hover:bg-teal-800 active:scale-[0.98] sm:w-auto"
              >
                Create an account
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={15} className="text-teal-700" aria-hidden />
                Barangay 11, Malaybalay City
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} className="text-teal-700" aria-hidden />
                Walk-ins welcome on service days
              </span>
            </div>
          </motion.div>

          <motion.div
            {...fade(0.12, reduceMotion)}
            className="mt-16 flex flex-col items-center gap-4 rounded-2xl border border-slate-200/70 bg-white px-5 py-4 sm:mt-20 sm:flex-row sm:gap-8"
          >
            <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Serving our community with
            </p>
            <div className="partner-marquee w-full min-w-0 overflow-hidden sm:flex-1">
              <div className="partner-marquee-track flex w-max">
                {Array.from({ length: MARQUEE_UNITS }, (_, unit) => (
                  // Only the first unit is announced; the rest exist to fill the loop.
                  <div key={unit} className="flex shrink-0" aria-hidden={unit > 0 || undefined}>
                    {partners.map((partner) => (
                      <span key={partner.name} className="inline-flex items-center gap-2 pr-8">
                        <img
                          src={partner.logo}
                          alt={partner.logoAlt}
                          className={`size-9 rounded-full border object-cover ${partner.frame}`}
                          loading="lazy"
                        />
                        <span className="whitespace-nowrap text-sm font-medium text-slate-700">
                          {partner.name}
                        </span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        <section aria-labelledby="services-heading" className="pb-4">
          <div className="mt-12 flex flex-col items-center gap-2 text-center">
            <div>
              <h2 id="services-heading" className="text-xl font-bold tracking-tight text-slate-900">
                Services
              </h2>
              <p className="mt-1 text-sm text-slate-600">Published schedules, updated by the front desk.</p>
            </div>
            <Link
              to="/login"
              className="shrink-0 text-sm font-medium text-teal-700 underline-offset-4 hover:underline"
            >
              Sign in to book
            </Link>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {services === null &&
              [0, 1].map((i) => (
                <div
                  key={i}
                  className="h-[104px] animate-pulse rounded-2xl border border-slate-200/70 bg-white"
                />
              ))}

            {services?.length === 0 && (
              <p className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center text-sm leading-6 text-slate-600 sm:col-span-2">
                No services are published yet. Please check back, or ask the front desk for details.
              </p>
            )}

            {services?.map((service, i) => (
              <motion.article
                key={service.id}
                {...fade(0.05 * i, reduceMotion)}
                className="rounded-2xl border border-slate-200/70 bg-white p-5 text-center shadow-[0_8px_30px_rgba(15,60,90,0.06)]"
              >
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <h3 className="font-bold text-slate-900">{service.name}</h3>
                  <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
                    {service.scheduleText}
                  </span>
                </div>
                {service.description && (
                  <p className="mt-2 text-sm leading-6 text-slate-600">{service.description}</p>
                )}
              </motion.article>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="py-12 text-center">
          <h2 id="how-heading" className="text-xl font-bold tracking-tight text-slate-900">
            How it works
          </h2>
          <ol className="mt-6 grid gap-5 text-center sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.title}
                {...fade(0.05 * i, reduceMotion)}
                className="rounded-2xl border border-slate-200/70 bg-white p-5"
              >
                <span className="mx-auto flex size-7 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>
              </motion.li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="updates-heading" className="pb-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 id="updates-heading" className="text-xl font-bold tracking-tight text-slate-900">
              Latest updates
            </h2>
            <Link
              to="/announcements"
              className="shrink-0 text-sm font-medium text-teal-700 underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="mt-6 space-y-3">
            {announcements.length === 0 && (
              <p className="rounded-2xl border border-slate-200/70 bg-white p-6 text-center text-sm leading-6 text-slate-600">
                No announcements right now. Schedule changes and health advisories will appear here.
              </p>
            )}
            {announcements.map((a) => (
              <article
                key={a.id}
                className="rounded-2xl border border-slate-200/70 bg-white p-5 text-center shadow-[0_8px_30px_rgba(15,60,90,0.06)]"
              >
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    {CATEGORY_LABELS[a.category]}
                  </span>
                  <h3 className="font-bold text-slate-900">{a.title}</h3>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{a.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-slate-200/60 pb-14 pt-10 text-center">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">What the center offers</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map((item, i) => (
              <motion.div
                key={item.title}
                {...fade(0.05 * i, reduceMotion)}
                className="rounded-2xl border border-slate-200/70 bg-white p-5"
              >
                <item.icon size={20} className="mx-auto text-teal-700" aria-hidden />
                <h3 className="mt-3 font-bold text-slate-900">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="visit-heading"
          className="mb-14 overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-900 text-white"
        >
          <img
            src={barangayHall}
            alt="Front of the Barangay 11 hall"
            className="h-40 w-full object-cover object-center sm:h-48"
            loading="lazy"
          />
          <div className="p-6 text-center sm:p-8">
            <h2 id="visit-heading" className="text-lg font-bold tracking-tight">
              Visit the center in person
            </h2>
            <p className="mx-auto mt-1 max-w-2xl text-sm leading-6 text-slate-300">
              Barangay 11, Malaybalay City — bring a valid ID on your first visit.
              Online booking uses the same front-desk schedule.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link
                to="/register"
                className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-slate-900 transition-transform active:scale-[0.97]"
              >
                Book online instead
              </Link>
              <Link
                to="/announcements"
                className="inline-flex h-10 items-center rounded-xl border border-white/25 px-4 text-sm font-medium text-white hover:bg-white/10"
              >
                Check advisories first
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/60 bg-white/40 backdrop-blur-sm">
        <div className={`${PAGE_CONTAINER} flex flex-col items-center gap-3 py-6 text-center text-sm text-slate-600`}>
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <img
                src={barangayLogo}
                alt="Barangay 11 logo"
                className="size-8 rounded-full border border-slate-200 bg-white object-cover"
                loading="lazy"
              />
              <img
                src={cityLogo}
                alt="City of Malaybalay seal"
                className="size-8 rounded-full border border-slate-200 bg-white object-cover"
                loading="lazy"
              />
              <img
                src={ekalingaLogo}
                alt="HealthCentria logo"
                className="size-8 rounded-full border border-slate-800 bg-slate-900 object-cover"
                loading="lazy"
              />
            </div>
            <p>HealthCentria — community health services.</p>
          </div>
          <Link to="/announcements" className="font-medium text-teal-700 underline-offset-4 hover:underline">
            Announcements
          </Link>
        </div>
      </footer>
    </div>
  );
}
