"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

type PrimitiveProps<T extends React.ElementType> = React.ComponentPropsWithoutRef<T> & {
  asChild?: boolean;
};

type NavRowSurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  expanded?: boolean;
};

export function AppChrome({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ritual-app-chrome", className)} {...props} />;
}

export function Titlebar({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "dashboard-top-chrome titlebar-region ritual-titlebar tauri-drag-region relative flex items-center overflow-hidden px-2",
        className,
      )}
      {...props}
    />
  );
}

export function ContentSurface({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <main className={cn("ritual-content-surface", className)} {...props} />;
}

export function SidebarShell({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={cn(
        "sidebar-vibrancy ritual-sidebar-shell relative h-full flex-shrink-0 flex-col justify-between pb-4 items-stretch overflow-hidden hidden md:flex",
        className,
      )}
      {...props}
    />
  );
}

export function NavList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ritual-sidebar-list", className)} {...props} />;
}

export function NavRowSurface({
  active,
  expanded = true,
  className,
  style,
  ...props
}: NavRowSurfaceProps) {
  return (
    <div
      data-active={active ? "true" : undefined}
      data-expanded={expanded ? "true" : "false"}
      className={cn(
        "ritual-nav-row-surface",
        className,
      )}
      style={{
        width: expanded
          ? "calc(100% - (var(--sidebar-row-x) * 2))"
          : "var(--sidebar-icon-box)",
        marginLeft: "var(--sidebar-row-x)",
        marginRight: expanded ? "var(--sidebar-row-x)" : undefined,
        ...style,
      }}
      {...props}
    />
  );
}

export function ToolbarButton({
  asChild,
  className,
  ...props
}: PrimitiveProps<"button">) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "ritual-toolbar-button flex h-7 w-7 items-center justify-center",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ritual-panel", className)} {...props} />;
}

export function SettingsGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Panel
      className={cn(
        "settings-group-card overflow-visible",
        className,
      )}
      {...props}
    />
  );
}

export function SettingsRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "ritual-settings-row grid min-h-[48px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[16px] py-[8px]",
        className,
      )}
      {...props}
    />
  );
}
