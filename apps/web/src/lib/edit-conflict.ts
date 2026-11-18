/**
 * One place that reports "somebody else saved this first", so any screen can
 * react without every form catching the 409 itself.
 *
 * The API layer publishes; the notice mounted in the root layout subscribes.
 */
export type EditConflict = {
  message: string;
  /** The version now stored on the server, when it sent one. */
  currentVersion?: number;
};

const EVENT = 'healthcentria:edit-conflict';

export function reportEditConflict(conflict: EditConflict): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<EditConflict>(EVENT, { detail: conflict }));
}

/** Subscribe to conflicts. Returns the cleanup function. */
export function onEditConflict(handler: (conflict: EditConflict) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<EditConflict>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
