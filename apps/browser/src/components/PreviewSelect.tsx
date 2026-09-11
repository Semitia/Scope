import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LineCurve, LinePattern } from '../types';

export const CURVE_OPTIONS: ReadonlyArray<{ value: LineCurve; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'stepped', label: 'Stepped' },
];

export const PATTERN_OPTIONS: ReadonlyArray<{ value: LinePattern; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashdot', label: 'Dash-dot' },
];

interface StylePreviewProps {
  kind: 'curve' | 'pattern';
  value: LineCurve | LinePattern;
}

function StylePreview({ kind, value }: StylePreviewProps) {
  if (kind === 'pattern') {
    const dashArray = value === 'dashed'
      ? '4 10'
      : value === 'dotted'
        ? '1 9'
        : value === 'dashdot'
          ? '5 9 1 9'
          : undefined;

    return (
      <svg className="style-preview" viewBox="0 0 44 14" aria-hidden="true">
        <line
          x1="2"
          y1="7"
          x2="42"
          y2="7"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={dashArray}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const path = value === 'smooth'
    ? 'M2 11 C9 2 16 1 23 7 S35 12 42 3'
    : value === 'stepped'
      ? 'M2 11 H13 V3 H27 V9 H42'
      : 'M2 11 L13 3 L27 9 L42 3';

  return (
    <svg className="style-preview" viewBox="0 0 44 14" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PreviewSelectProps<T extends string> {
  ariaLabel: string;
  color: string;
  kind: 'curve' | 'pattern';
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}

export function PreviewSelect<T extends string>({
  ariaLabel,
  color,
  kind,
  options,
  value,
  onChange,
}: PreviewSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className={`preview-select${open ? ' open' : ''}`}
      ref={rootRef}
      style={{ '--preview-color': color } as React.CSSProperties}
    >
      <button
        className="preview-select-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="preview-select-value">
          {value !== null && <StylePreview kind={kind} value={value as LineCurve | LinePattern} />}
          <span>{selected?.label ?? 'Mixed'}</span>
        </span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="preview-select-menu" role="listbox" aria-label={`${ariaLabel} options`}>
          {options.map((option) => (
            <button
              className="preview-select-option"
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <StylePreview kind={kind} value={option.value as LineCurve | LinePattern} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

