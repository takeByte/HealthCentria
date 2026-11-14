/**
 * The cool page wash behind the signed-in app.
 *
 * Matches the E-Kalinga shell: a pale blue-mint page with a few soft teal blobs,
 * fixed so the tint stays put while a page scrolls. Purely presentational:
 * `aria-hidden` keeps it out of the a11y tree and `pointer-events-none`
 * guarantees it never swallows a click.
 */
export function AppBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#f3f8fd] print:hidden"
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f3f8fd_0%,#f6fbfd_46%,#eef4f8_100%)]" />
      <div className="absolute -left-40 -top-36 size-[34rem] rounded-full bg-[#14b8a6]/10 blur-3xl" />
      <div className="absolute -right-32 top-[4%] size-[30rem] rounded-full bg-[#5eead4]/12 blur-3xl" />
      <div className="absolute left-[36%] top-[38%] size-[28rem] rounded-full bg-[#38bdf8]/08 blur-3xl" />
      <div className="absolute -bottom-44 -right-24 size-[32rem] rounded-full bg-[#14b8a6]/08 blur-3xl" />
    </div>
  );
}
