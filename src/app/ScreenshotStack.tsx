import { useRef, useState, type CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';

export function ScreenshotStack({ images, label, onOpen }: {
  images: Array<{ source: string; alt: string }>;
  label: string;
  onOpen: (source: string, alt: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{ id: number; x: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const current = index % images.length;
  const next = () => setIndex((value) => (value + 1) % images.length);
  return <div className="public-stack">
    <div className="public-stack__cards">
      {images.map((image, position) => {
        const depth = (position - current + images.length) % images.length;
        return <button key={image.source} type="button"
          className={`public-showcase public-stack__card${depth === 0 && offset ? ' public-stack__card--dragging' : ''}`}
          style={{ '--depth': Math.min(depth, 2), '--drag': `${depth === 0 ? offset : 0}px`, zIndex: images.length - depth } as CSSProperties}
          aria-label={`Open ${label} screenshot`} aria-hidden={depth !== 0} tabIndex={depth === 0 ? 0 : -1}
          onPointerDown={(event) => {
            if (depth !== 0 || images.length < 2 || !event.isPrimary || event.button !== 0) return;
            suppressClick.current = false;
            gesture.current = { id: event.pointerId, x: event.clientX, dragged: false };
          }}
          onPointerMove={(event) => {
            const start = gesture.current;
            if (!start || start.id !== event.pointerId) return;
            const delta = event.clientX - start.x;
            if (Math.abs(delta) > 8) {
              start.dragged = true;
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            if (start.dragged) setOffset(delta);
          }}
          onPointerUp={(event) => {
            const start = gesture.current;
            if (!start || start.id !== event.pointerId) return;
            suppressClick.current = start.dragged;
            if (Math.abs(event.clientX - start.x) >= 48) next();
            gesture.current = null;
            setOffset(0);
          }}
          onPointerCancel={() => { suppressClick.current = true; gesture.current = null; setOffset(0); }}
          onClick={(event) => {
            if (depth !== 0) return;
            if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
            onOpen(image.source, image.alt);
          }}>
          <img src={image.source} alt={image.alt} draggable={false} />
        </button>;
      })}
    </div>
    {images.length > 1 && <div className="public-stack__controls">
      <span aria-live="polite">{current + 1} / {images.length}</span>
      <span className="public-stack__hint">Drag to see the next screenshot</span>
      <button type="button" className="public-stack__next" onClick={next} aria-label={`Next ${label} screenshot`}>Next screenshot <ArrowRight aria-hidden="true" /></button>
    </div>}
  </div>;
}
