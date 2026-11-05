import { useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

type DropSide = 'before' | 'after';
let dragging: { group: string; id: string } | null = null;
let dropTarget: { group: string; id: string; clear: () => void } | null = null;

export function reorderById<T>(
  items: T[],
  sourceId: string,
  targetId: string,
  side: DropSide,
  getId: (item: T) => string,
): T[] {
  const source = items.findIndex((item) => getId(item) === sourceId);
  const target = items.findIndex((item) => getId(item) === targetId);
  if (source < 0 || target < 0 || source === target) return items;
  const result = [...items];
  const [item] = result.splice(source, 1);
  const insertion = result.findIndex((entry) => getId(entry) === targetId);
  result.splice(insertion + (side === 'after' ? 1 : 0), 0, item);
  return result;
}

export function ReorderableItem({
  group, id, label, onReorder, children, as = 'div',
}: {
  group: string;
  id: string;
  label: string;
  onReorder: (sourceId: string, targetId: string, side: DropSide) => void;
  children: (handle: ReactNode) => ReactNode;
  as?: 'div' | 'li';
}) {
  const [side, setSide] = useState<DropSide | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const Container = as;
  const handle = (
    <button
      type="button"
      className="admin-drag-handle"
      aria-label={`Drag ${label} to reorder`}
      title="Drag to reorder; use the move buttons for keyboard access"
      draggable
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDragStart={(event) => {
        event.stopPropagation();
        dragging = { group, id };
        setIsDragging(true);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        dragging = null;
        dropTarget?.clear();
        dropTarget = null;
        setIsDragging(false);
        setSide(null);
      }}
    ><GripVertical size={18} aria-hidden="true" focusable="false" /></button>
  );

  return (
    <Container
      className={`admin-reorder-item${isDragging ? ' admin-reorder-item--dragging' : ''}${side ? ` admin-reorder-item--${side}` : ''}`}
      onDragOver={(event) => {
        if (!dragging || dragging.group !== group || dragging.id === id) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget?.group !== group || dropTarget.id !== id) {
          dropTarget?.clear();
          dropTarget = { group, id, clear: () => setSide(null) };
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        setSide(event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setSide(null);
          if (dropTarget?.group === group && dropTarget.id === id) dropTarget = null;
        }
      }}
      onDrop={(event) => {
        if (!dragging || dragging.group !== group || dragging.id === id) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        const dropSide = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
        onReorder(dragging.id, id, dropSide);
        dragging = null;
        dropTarget?.clear();
        dropTarget = null;
        setSide(null);
      }}
    >
      {children(handle)}
    </Container>
  );
}
