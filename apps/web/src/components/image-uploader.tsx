import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import type { AnnouncementImage } from '../lib/api';
import { getPublicSettings } from '../lib/api';
import { uploadAnnouncementImages } from '../lib/uploadthing';
import { inputClass } from './app-ui';

export const MAX_IMAGES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/**
 * Picker + thumbnails + per-image alt text for the announcement composer.
 * Files upload as soon as they are chosen; the parent only ever holds URLs.
 */
export function ImageUploader({
  images,
  onChange,
  disabled,
}: {
  images: AnnouncementImage[];
  onChange: (next: AnnouncementImage[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadsOff, setUploadsOff] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPublicSettings()
      .then((s) => {
        if (!cancelled) setUploadsOff(s.uploadthingEnabled === false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const remaining = MAX_IMAGES - images.length;
  const uploading = progress !== null;

  async function onPick(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (picked.length === 0) return;
    setError(null);

    if (picked.length > remaining) {
      setError(`You can add ${remaining} more image${remaining === 1 ? '' : 's'} (max ${MAX_IMAGES}).`);
      return;
    }
    const bad = picked.find((f) => !f.type.startsWith('image/') || f.size > MAX_BYTES);
    if (bad) {
      setError(bad.type.startsWith('image/') ? `"${bad.name}" is larger than 8MB.` : `"${bad.name}" is not an image.`);
      return;
    }

    setProgress(0);
    try {
      const uploaded = await uploadAnnouncementImages(picked, setProgress);
      onChange([...images, ...uploaded.map((u) => ({ url: u.url, key: u.key, alt: '' }))]);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Upload failed. Try again.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-slate-700">Photos</span>
        <span className="text-[11.5px] text-slate-500">
          {images.length}/{MAX_IMAGES} · JPG, PNG, WebP · 8MB each
        </span>
      </div>

      {images.length > 0 && (
        <ul className="mb-3 space-y-2">
          {images.map((img, i) => (
            <li key={img.url} className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-2">
              <img src={img.url} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
              <input
                value={img.alt}
                maxLength={300}
                disabled={disabled}
                onChange={(e) => onChange(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                placeholder="Describe this photo (optional)"
                aria-label={`Description for photo ${i + 1}`}
                className={`${inputClass} h-10 min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
                aria-label={`Remove photo ${i + 1}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-destructive disabled:opacity-50"
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
      <button
        type="button"
        disabled={disabled || uploading || remaining === 0 || uploadsOff}
        onClick={() => inputRef.current?.click()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-[13px] font-semibold text-slate-600 transition-colors hover:border-teal-600 hover:bg-teal-50/50 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? (
          <>
            <LoaderCircle size={16} className="animate-spin" aria-hidden /> Uploading… {progress}%
          </>
        ) : (
          <>
            <ImagePlus size={16} aria-hidden /> {uploadsOff ? 'Photo uploads are turned off' : remaining === 0 ? 'Photo limit reached' : 'Add photos'}
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
