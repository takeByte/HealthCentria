import { useEffect, useState } from 'react';
import { onFlash } from '../lib/flash';
import { Toast, type ToastMessage } from './toast';

/** Shows a message published just before a screen navigated away. */
export function FlashToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => onFlash(setToast), []);

  if (!toast) return null;
  return <Toast key={`${toast.tone}-${toast.message}`} toast={toast} onDone={() => setToast(null)} />;
}
