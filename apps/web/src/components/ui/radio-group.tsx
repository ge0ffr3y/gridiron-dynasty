/**
 * A radio group (Phase 18) for choices drawn as buttons or cards: one tab stop for the whole group,
 * arrow keys move the choice, and disabled options are skipped.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface RadioOption<T extends string> {
  value: T;
  disabled?: boolean;
  content: ReactNode;
}

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  optionClassName,
}: {
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** Classes for each option's button, from its state. */
  optionClassName: (checked: boolean, disabled: boolean) => string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((o) => !o.disabled);
  // The tab stop: the chosen option, or the first one that can be chosen.
  const stop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;
  const move = (step: number) => {
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(-1);
    else return;
    e.preventDefault();
  };
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            if (el) refs.current.set(o.value, el);
            else refs.current.delete(o.value);
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          tabIndex={o.value === stop ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={onKey}
          className={optionClassName(o.value === value, o.disabled === true)}
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}
