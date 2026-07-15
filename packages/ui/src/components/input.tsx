import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn";

const inputVariants = cva(
  "flex w-full border border-input bg-background ring-offset-background file:border-0 file:bg-transparent file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      density: {
        default: "h-10 rounded-md px-3 py-2 text-sm file:text-sm",
        compact: "h-9 rounded-row px-2.5 py-1.5 text-[13px] file:text-[13px]",
      },
    },
    defaultVariants: { density: "default" },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, density, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(inputVariants({ density }), className)}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input, inputVariants };
