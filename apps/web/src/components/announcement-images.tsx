import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AnnouncementImage } from '../lib/api';
import { cn } from '../lib/utils';

/** Facebook-style grid: 1 full width, 2 side by side, 3–4 as a mosaic. */
export function ImageGallery({ images }: { images: AnnouncementImage[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (images.length === 0) return null;
  const shown = images.slice(0, 4);

  const layout =
    shown.length === 1
      ? 'grid-cols-1'
      : shown.length === 2
        ? 'grid-cols-2 aspect-[2/1]'
        : 'grid-cols-2 aspect-[4/3]';

  return (
    <>
      <div className={cn('mt-3 grid gap-1 overflow-hidden rounded-xl bg-slate-100', layout)}>
        {shown.map((img, i) => (
          <button
            key={img.url}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`View image ${i + 1} of ${shown.length}${img.alt ? `: ${img.alt}` : ''}`}
            className={cn(
              'relative block min-h-0 overflow-hidden bg-slate-200 focus-visible:outline-2 focus-visible:outline-[#1f55a8]',
              // With three images the first one spans both rows on the left.
              shown.length === 3 && i === 0 && 'row-span-2',
              shown.length === 1 && 'max-h-[26rem]',
            )}
          >
            <img
              src={img.url}
              alt={img.alt || ''}
              loading="lazy"
              className={cn('size-full object-cover', shown.length === 1 && 'max-h-[26rem]')}
            />
          </button>
        ))}
      </div>
      {active !== null && (
        <Lightbox images={shown} index={active} onIndex={setActive} onClose={() => setActive(null)} />
      )}
    </>
  );
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: AnnouncementImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const img = images[index];
  const many = images.length > 1;
  const prev = () => onIndex((index + images.length - 1) % images.length);
  const next = () => onIndex((index + 1) % images.length);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && images.length > 1) onIndex((index + images.length - 1) % images.length);
      else if (e.key === 'ArrowRight' && images.length > 1) onIndex((index + 1) % images.length);
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, images.length, onIndex, onClose]);

  const nav =
    'absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/25"
      >
        <X size={20} aria-hidden />
      </button>
      {many && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className={cn(nav, 'left-4')}
        >
          <ChevronLeft size={22} aria-hidden />
        </button>
      )}
      <figure className="flex max-h-full max-w-5xl flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img src={img.url} alt={img.alt || ''} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
        {(img.alt || many) && (
          <figcaption className="text-center text-[13px] text-white/80">
            {img.alt}
            {img.alt && many ? ' · ' : ''}
            {many ? `${index + 1} / ${images.length}` : ''}
          </figcaption>
        )}
      </figure>
      {many && (
        <button
          type="button"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className={cn(nav, 'right-4')}
        >
          <ChevronRight size={22} aria-hidden />
        </button>
      )}
    </div>
  );
}
