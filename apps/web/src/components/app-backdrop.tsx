/**
 * The cool page wash behind the signed-in app.
 *
 * Dominated by the palette's mist stop, with a few soft sky and bright blobs,
 * fixed so the tint stays put while a page scrolls. Purely presentational:
 * `aria-hidden` keeps it out of the a11y tree and `pointer-events-none`
 * guarantees it never swallows a click.
 */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--palette-mist)] print:hidden"
    >
      <div className="absolute -left-40 -top-36 size-[34rem] rounded-full bg-[var(--palette-sky)]/30 blur-3xl" />
      <div className="absolute -right-32 top-[4%] size-[30rem] rounded-full bg-[var(--palette-sky)]/20 blur-3xl" />
      <div className="absolute left-[36%] top-[38%] size-[28rem] rounded-full bg-[var(--palette-bright)]/10 blur-3xl" />
      <div className="absolute -bottom-44 -right-24 size-[32rem] rounded-full bg-[var(--palette-bright)]/08 blur-3xl" />
    </div>
  );
}
