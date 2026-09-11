import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  className: string;
  label: string;
  width: number;
  anchor: () => Element | null;
  onClose: () => void;
  children: ReactNode;
}

/** A viewport-sized editor outside the workspace's clipped/transformed panels. */
export function FloatingPanel({ className, label, width, anchor, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ anchor, onClose });
  callbacks.current = { anchor, onClose };
  useLayoutEffect(() => {
    const element = ref.current!;
    const position = () => {
      const rect = callbacks.current.anchor()?.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const margin = 12;
      const bottom = window.innerHeight - margin;
      let top = rect ? rect.bottom + 8 : (window.innerHeight - box.height) / 2;
      if (rect && top + box.height > bottom && rect.top - box.height - 8 >= margin) top = rect.top - box.height - 8;
      element.style.top = `${Math.max(margin, Math.min(top, bottom - box.height))}px`;
      const left = rect ? rect.right - box.width : (window.innerWidth - box.width) / 2;
      element.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - box.width - margin))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    const anchorElement = callbacks.current.anchor();
    if (anchorElement) observer.observe(anchorElement);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!element.contains(target) && !callbacks.current.anchor()?.contains(target)) callbacks.current.onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') callbacks.current.onClose();
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown);
    };
  }, []);
  return createPortal(<div ref={ref} className={`${className} floating-panel`} role="dialog" aria-label={label}
    style={{ width: `min(${width}px, calc(100vw - 24px))` }}>{children}</div>, document.body);
}

export function panelAnchor(panelId: string, selector: string) {
  const panel = document.querySelector(`[data-panel-id="${CSS.escape(panelId)}"]`);
  return panel?.querySelector(selector) ?? panel?.querySelector('.plot-legend') ?? panel;
}
