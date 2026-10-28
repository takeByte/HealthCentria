/**
 * The landing page's pale-blue wash, reused behind the signed-in app.
 *
 * Same palette and same idea as `SoftBlueBackdrop`, but fixed rather than
 * absolute (so the tint stays put while a page scrolls) and built from a
 * handful of blurred blobs instead of the landing page's ribbon SVGs — app
 * screens repaint far more often and these cost nothing to composite.
 *
 * Purely presentational: `aria-hidden` keeps it out of the a11y tree and
 * `pointer-events-none` guarantees it never swallows a click.
 */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#f5faff]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f4faff_0%,#eef7fe_28%,#f8fcff_54%,#eef6fd_80%,#f3f9ff_100%)]" />
      <div className="absolute -left-40 -top-36 size-[34rem] rounded-full bg-sky-300/20 blur-3xl" />
      <div className="absolute -right-32 top-[4%] size-[30rem] rounded-full bg-cyan-200/22 blur-3xl" />
      <div className="absolute left-[36%] top-[38%] size-[28rem] rounded-full bg-blue-200/12 blur-3xl" />
      <div className="absolute -bottom-44 -right-24 size-[32rem] rounded-full bg-teal-200/18 blur-3xl" />
      <div className="absolute -bottom-28 left-[4%] size-[26rem] rounded-full bg-sky-200/18 blur-3xl" />
    </div>
  );
}
