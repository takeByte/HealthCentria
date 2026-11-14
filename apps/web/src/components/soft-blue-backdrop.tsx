/**
 * Decorative backdrop for the landing page: a mist-dominant blue wash that runs
 * the full length of the page, with subtle translucent blobs and flowing
 * abstract shapes layered over it in the palette's sky and bright stops.
 *
 * Kept low-opacity so the blue reads as a tint behind the content rather than a
 * colored page.
 *
 * Purely presentational — `aria-hidden` keeps it out of the accessibility tree
 * and `pointer-events-none` guarantees it never swallows a click.
 */
export function SoftBlueBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Base wash: the palette's mist stop, with barely-there undulations. */}
      <div className="landing-wash absolute inset-0" />

      {/* Translucent blobs spread down the page, blurred so they have no edges. */}
      <div className="absolute -left-28 top-[2%] size-[28rem] rounded-full bg-[var(--palette-sky)]/25 blur-3xl" />
      <div className="absolute -right-24 top-[7%] size-[24rem] rounded-full bg-[var(--palette-mist)]/60 blur-3xl" />
      <div className="absolute left-[34%] top-[17%] size-[26rem] rounded-full bg-[var(--palette-bright)]/10 blur-3xl" />
      <div className="absolute -right-16 top-[31%] size-[24rem] rounded-full bg-[var(--palette-sky)]/20 blur-3xl" />
      <div className="absolute -left-24 top-[45%] size-[26rem] rounded-full bg-[var(--palette-mist)]/70 blur-3xl" />
      <div className="absolute right-[24%] top-[58%] size-[20rem] rounded-full bg-[var(--palette-sky)]/18 blur-3xl" />
      <div className="absolute left-[8%] top-[72%] size-[22rem] rounded-full bg-[var(--palette-mist)]/80 blur-3xl" />
      <div className="absolute -right-20 top-[86%] size-[24rem] rounded-full bg-[var(--palette-sky)]/20 blur-3xl" />

      {/* Flowing abstract ribbons, one band per third of the page. */}
      {['top-[4%]', 'top-[38%]', 'top-[72%]'].map((position, i) => (
        <svg
          key={position}
          className={`absolute inset-x-0 ${position} h-[46rem] w-full`}
          viewBox="0 0 1440 736"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id={`backdrop-ribbon-a-${i}`} x1="0" y1="0" x2="1" y2="0.6">
              <stop offset="0%" stopColor="var(--palette-sky)" stopOpacity="0" />
              <stop offset="35%" stopColor="var(--palette-sky)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--palette-bright)" stopOpacity="0.12" />
            </linearGradient>
            <linearGradient id={`backdrop-ribbon-b-${i}`} x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--palette-sky)" stopOpacity="0.26" />
              <stop offset="60%" stopColor="var(--palette-mist)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--palette-mist)" stopOpacity="0" />
            </linearGradient>
            <filter
              id={`backdrop-soften-${i}`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur stdDeviation="46" />
            </filter>
          </defs>

          <g filter={`url(#backdrop-soften-${i})`}>
            <path
              d="M-120 180 C 240 70, 520 240, 820 190 C 1080 146, 1280 46, 1560 120"
              stroke={`url(#backdrop-ribbon-a-${i})`}
              strokeWidth="150"
              strokeLinecap="round"
            />
            <path
              d="M1560 420 C 1280 458, 1120 330, 900 378 C 700 422, 560 520, 380 496"
              stroke={`url(#backdrop-ribbon-b-${i})`}
              strokeWidth="130"
              strokeLinecap="round"
            />
            <path
              d="M-120 660 C 260 606, 520 720, 880 692 C 1160 668, 1320 596, 1560 630"
              stroke={`url(#backdrop-ribbon-a-${i})`}
              strokeWidth="170"
              strokeLinecap="round"
            />
          </g>
        </svg>
      ))}
    </div>
  );
}
