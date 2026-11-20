/**
 * One-shot success/error notice that survives a route change.
 *
 * A screen that saves and then navigates cannot show its own toast: the toast
 * unmounts with the page. So it publishes the message before navigating, and
 * the notice mounted in the root layout picks it up on the next screen.
 *
 * Same shape as lib/edit-conflict.ts: publish from anywhere, subscribe once.
 */
export type FlashMessage = {
  tone: 'success' | 'error';
  message: string;
};

const EVENT = 'healthcentria:flash';

export function flash(message: string, tone: FlashMessage['tone'] = 'success'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<FlashMessage>(EVENT, { detail: { tone, message } }));
}

/** Subscribe to flashes. Returns the cleanup function. */
export function onFlash(handler: (message: FlashMessage) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<FlashMessage>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
