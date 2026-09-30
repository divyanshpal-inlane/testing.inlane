import { cva, type VariantProps } from "class-variance-authority";
import React from "react";

import { cn } from "@/lib/utils";

const paintedTextVariants = cva("relative inline-block", {
  variants: {
    variant: {
      yellow: "text-yellow-900",
      green: "text-green-900",
      blue: "text-blue-900",
      red: "text-red-900",
    },
  },
  defaultVariants: {
    variant: "yellow",
  },
});

const brushColors = {
  yellow: "ffff43",
  green: "00FF91",
  blue: "43a2ff",
  red: "FF8989",
};

export interface PaintedTextProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof paintedTextVariants> {
  children: React.ReactNode;
}

const PaintedText = React.forwardRef<HTMLSpanElement, PaintedTextProps>(
  ({ className, variant, children, ...props }, ref) => {
    const brushColor = variant ? brushColors[variant] : undefined;

    return (
      // <span className={cn(paintedTextVariants({ variant, className }))}>
      <span
        className={cn(
          "highlight relative z-10 -mx-1.5 -my-0.5 px-1.5 py-0.5 text-base",
          className,
        )}
        style={
          brushColor
            ? {
                background: `url(https://s2.svgbox.net/pen-brushes.svg?ic=brush-10&color=${brushColor})`,
              }
            : {}
        }
        ref={ref}
        {...props}
      >
        {children}
      </span>
      // </span>
    );
  },
);

PaintedText.displayName = "PaintedText";

export { PaintedText, paintedTextVariants };
