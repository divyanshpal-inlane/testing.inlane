import * as React from "react";

import { cn } from "@/lib/utils";

interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * A11y note: the *button* is the control (`role="switch"`), so `id` and every
 * other labelling prop must land on it -- otherwise `<Label htmlFor>` points at
 * the `sr-only` input inside, the button ends up with no accessible name, and
 * `getByRole("switch", { name })` / `getByLabel()` cannot find the real
 * control. The inner checkbox is kept (without `id`) only so the value still
 * submits inside a plain HTML form; it is hidden from the accessibility tree
 * and untabbable so it cannot be focused or clicked directly.
 */
const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      className,
      checked,
      onCheckedChange,
      id,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        type="button"
        role="switch"
        id={id}
        aria-label={ariaLabel}
        aria-checked={checked}
        className={cn(
          "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-input",
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
        <input
          type="checkbox"
          ref={ref}
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          {...props}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
