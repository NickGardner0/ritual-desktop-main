import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn";

const menuSurfaceVariants = cva("ritual-floating-surface", {
  variants: {
    kind: {
      menu: "",
      dialog: "ritual-dialog-surface",
    },
  },
  defaultVariants: { kind: "menu" },
});

const menuRowVariants = cva("ritual-menu-row", {
  variants: {
    inset: {
      true: "pl-8",
      false: "",
    },
    tone: {
      default: "",
      destructive: "text-[var(--ritual-status-danger)]",
    },
  },
  defaultVariants: { inset: false, tone: "default" },
});

type MenuSurfaceProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof menuSurfaceVariants>;

const MenuSurface = React.forwardRef<HTMLDivElement, MenuSurfaceProps>(
  ({ className, kind, ...props }, ref) => (
    <div ref={ref} className={cn(menuSurfaceVariants({ kind }), className)} {...props} />
  ),
);
MenuSurface.displayName = "MenuSurface";

const MenuList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("ritual-menu-list", className)} {...props} />
  ),
);
MenuList.displayName = "MenuList";

type MenuRowProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof menuRowVariants>;

const MenuRow = React.forwardRef<HTMLDivElement, MenuRowProps>(
  ({ className, inset, tone, ...props }, ref) => (
    <div ref={ref} className={cn(menuRowVariants({ inset, tone }), className)} {...props} />
  ),
);
MenuRow.displayName = "MenuRow";

const MenuLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("ritual-menu-label", className)} {...props} />
  ),
);
MenuLabel.displayName = "MenuLabel";

const MenuSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, role = "separator", ...props }, ref) => (
    <div ref={ref} role={role} className={cn("ritual-menu-separator", className)} {...props} />
  ),
);
MenuSeparator.displayName = "MenuSeparator";

export {
  MenuLabel,
  MenuList,
  MenuRow,
  MenuSeparator,
  MenuSurface,
  menuRowVariants,
  menuSurfaceVariants,
  type MenuRowProps,
  type MenuSurfaceProps,
};
