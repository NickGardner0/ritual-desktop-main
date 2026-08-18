"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { usePrefetchDashboard, usePrefetchAnalytics } from "@/hooks/use-prefetch";
import { NavList, NavRowSurface } from "@/components/ui/ritual-system";
import { listExperiments } from "@/lib/experiments";
import { SIDEBAR_ICONS } from "@/components/sidebar-icons";

const items = [
  {
    path: "/dashboard",
    name: "Index",
  },
  {
    path: "/dashboard?view=metrics",
    name: "Metrics",
  },
  {
    path: "/activity",
    name: "Logs",
  },
  {
    path: "/tasks",
    name: "Tasks",
  },
  {
    path: "/calendar",
    name: "Calendar",
  },
  {
    path: "/reports",
    name: "Reports",
  },
  {
    path: "/routines",
    name: "Routines",
  },
  {
    path: "/experiments",
    name: "Experiments",
  },
  {
    path: "/integrations",
    name: "Integrations",
    children: [
      { path: "/integrations?tab=available", name: "Available" },
      { path: "/integrations?tab=connected", name: "Connected" },
    ],
  },
];

interface ItemProps {
  item: {
    path: string;
    name: string;
    children?: { path: string; name: string }[];
  };
  isActive: boolean;
  isExpanded: boolean;
  isItemExpanded: boolean;
  onToggle: (path: string) => void;
  onSelect?: () => void;
}

const ChildItem = ({
  child,
  isActive,
  isExpanded,
  shouldShow,
  onSelect,
  index,
}: {
  child: { path: string; name: string };
  isActive: boolean;
  isExpanded: boolean;
  shouldShow: boolean;
  onSelect?: () => void;
  index: number;
}) => {
  const showChild = isExpanded && shouldShow;

  return (
    <Link
      href={child.path}
      onClick={() => onSelect?.()}
      className="group/child block"
      prefetch={true}
    >
      <div
        className={cn(
          "ritual-snappy-row group/child relative ml-[35px] mr-[15px] rounded-[var(--sidebar-row-radius)]",
          isActive && "bg-[var(--row-active)]",
        )}
      >
        {/* Child item text */}
        <div
          className={cn(
            "h-[var(--sidebar-row-height)] flex items-center",
            "border-l border-[var(--border-muted)] pl-3",
            "transition-all duration-200 ease-standard",
            showChild
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-2",
          )}
          style={{
            transitionDelay: showChild
              ? `${40 + index * 20}ms`
              : `${index * 20}ms`,
          }}
        >
          <span
            className={cn(
              "ritual-nav-child-label text-xs transition-none",
              "text-[var(--text-muted)] group-hover/child:text-[var(--text-primary)]",
              "whitespace-nowrap overflow-hidden",
              isActive && "text-[var(--text-primary)]",
            )}
          >
            {child.name}
          </span>
        </div>
      </div>
    </Link>
  );
};

const Item = ({
  item,
  isActive,
  isExpanded,
  isItemExpanded,
  onToggle,
  onSelect,
}: ItemProps) => {
  const Icon = SIDEBAR_ICONS[item.path as keyof typeof SIDEBAR_ICONS];
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasChildren = item.children && item.children.length > 0;
  const isCollapsedActive = isActive && !isExpanded;

  // Prefetch data on hover (Midday-style optimization)
  const prefetchDashboard = usePrefetchDashboard();
  const prefetchAnalytics = usePrefetchAnalytics();
  
  // Get the right prefetch function for this item
  const getPrefetchProps = () => {
    switch (item.path) {
      case '/dashboard': return prefetchDashboard;
      case '/dashboard?view=metrics': return prefetchAnalytics;
      case '/analytics': return prefetchAnalytics;
      default: return {};
    }
  };

  // Children should be visible when: expanded sidebar AND this item is expanded
  const shouldShowChildren = isExpanded && isItemExpanded;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(item.path);
  };

  const handleItemClick = () => {
    // Let the Link handle navigation naturally and only collapse hover menus.
    onSelect?.();
  };

  return (
    <div className="group">
      <Link
        href={item.path}
        onClick={handleItemClick}
        className="group/nav-item block"
        prefetch={true}
        {...getPrefetchProps()}
      >
        <div className="relative">
          <NavRowSurface
            className={cn(
              "transition-[width,margin] duration-90 ease-out",
            )}
            active={isActive}
            expanded={isExpanded}
          />

          <div className={cn(
            "ritual-nav-icon absolute top-1/2 left-[var(--sidebar-icon-x)] flex h-[var(--sidebar-icon-box)] w-[var(--sidebar-icon-box)] -translate-y-1/2 items-center justify-center pointer-events-none",
            isCollapsedActive && "scale-[1.04]"
          )}
            data-active={isActive ? "true" : undefined}
            data-collapsed={!isExpanded ? "true" : undefined}
          >
            <Icon className="relative -translate-y-px h-[18px] w-[18px]" strokeWidth={isActive ? 2.35 : 2.1} />
          </div>

          {isExpanded && (
            <div className="absolute top-1/2 left-[55px] right-[4px] flex h-[var(--sidebar-row-height)] -translate-y-1/2 items-center pointer-events-none">
              <span
                className={cn(
                  "ritual-nav-label text-sm leading-none",
                  "whitespace-nowrap overflow-hidden",
                  hasChildren ? "pr-2" : "",
                )}
                data-active={isActive ? "true" : undefined}
              >
                {item.name}
              </span>
              {hasChildren && (
                <button
                  type="button"
                  onClick={handleChevronClick}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center transition-all duration-90 ml-auto mr-3",
                    "text-[var(--icon-muted)] hover:text-[var(--text-primary)] pointer-events-auto",
                    isActive && "text-[var(--text-primary)]",
                    shouldShowChildren && "rotate-180",
                  )}
                >
                  <ChevronDown className="h-[14px] w-[14px]" strokeWidth={2} />
                </button>
              )}
            </div>
          )}
        </div>
      </Link>

      {/* Children */}
      {hasChildren && (
        <div
          className={cn(
            "transition-all duration-300 ease-standard overflow-hidden",
            shouldShowChildren ? "max-h-96 mt-1" : "max-h-0",
          )}
        >
          {item.children!.map((child, index) => {
            const [childPathname, childQuery] = child.path.split("?");
            const childQueryParams = new URLSearchParams(childQuery || "");
            const isChildActive = pathname === childPathname &&
              Array.from(childQueryParams.entries()).every(
                ([key, value]) => searchParams.get(key) === value,
              );
            return (
              <ChildItem
                key={child.path}
                child={child}
                isActive={isChildActive}
                isExpanded={isExpanded}
                shouldShow={shouldShowChildren}
                onSelect={onSelect}
                index={index}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

type Props = {
  onSelect?: () => void;
  isExpanded?: boolean;
};

export function MainMenu({ onSelect, isExpanded = false }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const experimentsQuery = useQuery({
    queryKey: ["experiments", "sidebar"],
    queryFn: () => listExperiments(5),
    staleTime: 30_000,
    enabled: isExpanded,
  });

  const experimentChildren = [
    { path: "/experiments?new=1", name: "New experiment" },
    ...(experimentsQuery.data || []).map((experiment) => ({
      path: `/experiments/${experiment.id}`,
      name: experiment.title,
    })),
  ];

  // Reset expanded item when sidebar expands/collapses
  useEffect(() => {
    queueMicrotask(() => setExpandedItem(null));
  }, [isExpanded]);

  return (
    <div className="mt-3 w-full">
      <nav className="w-full">
        <NavList>
          {items.map((item) => {
            const [itemBasePath, itemQuery] = item.path.split("?");
            const itemQueryParams = new URLSearchParams(itemQuery || "");
            const matchingQueryItem = items.some((candidate) => {
              const [candidateBasePath, candidateQuery] = candidate.path.split("?");
              if (candidateBasePath !== item.path || !candidateQuery) return false;
              const candidateParams = new URLSearchParams(candidateQuery);
              return Array.from(candidateParams.entries()).every(
                ([key, value]) => searchParams.get(key) === value,
              );
            });
            const isQueryActive = itemQuery
              ? pathname === itemBasePath &&
                Array.from(itemQueryParams.entries()).every(
                  ([key, value]) => searchParams.get(key) === value,
                )
              : false;
            const isActive = isQueryActive || (
              !itemQuery &&
              !matchingQueryItem &&
              (pathname === item.path ||
                pathname === item.path + "/" ||
                (pathname === "/" && item.path === "/dashboard") ||
                (pathname === "/dashboard/" && item.path === "/dashboard") ||
                (pathname?.startsWith(item.path) && item.path !== "/dashboard"))
            );
            const menuItem = item.path === "/experiments"
              ? { ...item, children: experimentChildren }
              : item;

            return (
              <Item
                key={item.path}
                item={menuItem}
                isActive={isActive}
                isExpanded={isExpanded}
                isItemExpanded={expandedItem === item.path}
                onToggle={(path) => {
                  setExpandedItem(expandedItem === path ? null : path);
                }}
                onSelect={onSelect}
              />
            );
          })}
        </NavList>
      </nav>
    </div>
  );
}
