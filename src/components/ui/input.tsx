import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends
    React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

import { cva, VariantProps } from "class-variance-authority";

const inputVariants = cva(
  "flex h-fit w-full rounded-md border border-input bg-transparent px-3 py-3 text-base shadow-md transition-colors file:border-0 file:bg-transparent file:text-base file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "focus-visible:ring-ring",
        purple: "focus-visible:ring-accent-purple",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
