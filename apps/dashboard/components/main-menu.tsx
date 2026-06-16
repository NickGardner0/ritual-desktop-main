"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FlaskConical,
  Plug2,
  ChevronDown,
  TableProperties,
  CalendarDays,
  ChartNoAxesCombined,
} from "lucide-react";
import TocIcon from "@mui/icons-material/Toc";
import { usePrefetchDashboard, usePrefetchAnalytics } from "@/hooks/use-prefetch";

// Custom "I" letter icon component for Index
const ILetterIcon = ({ strokeWidth = 2.1, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    strokeWidth={strokeWidth}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path
      d="M9 6h6M12 6v12M9 18h6"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

const MiddayInvoiceIcon = ({
  strokeWidth: _strokeWidth,
  ...props
}: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    stroke="currentColor"
    strokeWidth={0.25}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <g transform="translate(10 10) scale(1.16) translate(-10 -10)">
      <path d="M6.875 14.7916H13.125V13.5416H6.875V14.7916ZM6.875 11.4583H13.125V10.2083H6.875V11.4583ZM3.75 17.9166V2.08331H11.875L16.25 6.45831V17.9166H3.75ZM11.25 7.08331V3.33331H5V16.6666H15V7.08331H11.25Z" />
    </g>
  </svg>
);

const icons = {
  "/dashboard": (props: React.SVGProps<SVGSVGElement>) => <ILetterIcon {...props} />,
  "/tasks": (props: React.SVGProps<SVGSVGElement>) => <TocIcon className={props.className} />,
  "/activity": (props: React.SVGProps<SVGSVGElement>) => <TableProperties {...props} />,
  "/calendar": (props: React.SVGProps<SVGSVGElement>) => <CalendarDays {...props} />,
  "/reports": (props: React.SVGProps<SVGSVGElement>) => <MiddayInvoiceIcon {...props} />,
  "/analytics": (props: React.SVGProps<SVGSVGElement>) => <ChartNoAxesCombined {...props} />,
  "/experiments": (props: React.SVGProps<SVGSVGElement>) => <FlaskConical {...props} />,
  "/integrations": (props: React.SVGProps<SVGSVGElement>) => <Plug2 {...props} />,
} as const;

const items = [
  {
    path: "/dashboard",
    name: "Index",
  },
  // {
  //   path: "/tasks",
  //   name: "Tasks",
  // },
  {
    path: "/activity",
    name: "Logs",
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
          "sidebar-nav-child-row relative ml-[29px] mr-[9px] rounded-md transition-colors duration-75 ease-standard",
          "hover:bg-[#e8e8e8]/80",
          isActive && "bg-[#e4e4e4]/85",
        )}
        data-active={isActive ? "true" : undefined}
      >
        {/* Child item text */}
        <div
          className={cn(
            "h-[32px] flex items-center",
            "border-l border-[#DCDAD2] dark:border-[#2C2C2C] pl-3",
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
              "text-xs font-[450] transition-colors duration-200",
              "text-[#7a7a7a] group-hover/child:text-[#343434]",
              "whitespace-nowrap overflow-hidden",
              isActive && "text-[#111111]",
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
  const Icon = icons[item.path as keyof typeof icons];
  const pathname = usePathname();
  const hasChildren = item.children && item.children.length > 0;
  const isCollapsedActive = isActive && !isExpanded;
  
  // Prefetch data on hover (Midday-style optimization)
  const prefetchDashboard = usePrefetchDashboard();
  const prefetchAnalytics = usePrefetchAnalytics();
  
  // Get the right prefetch function for this item
  const getPrefetchProps = () => {
    switch (item.path) {
      case '/dashboard': return prefetchDashboard;
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

  const handleItemClick = (e: React.MouseEvent) => {
    if (item.path === "/experiments") {
      e.preventDefault();
      onSelect?.();
    } else {
      // Let the Link handle navigation naturally
      // Just call onSelect for any sidebar collapse behavior
      onSelect?.();
    }
  };

  return (
    <div className="group">
      <Link
        href={item.path === "/experiments" ? "#" : item.path}
        onClick={handleItemClick}
        className="group/nav-item block"
        prefetch={true}
        {...getPrefetchProps()}
      >
        <div className="relative">
          <div
            className={cn(
              "sidebar-nav-row h-[32px] rounded-md transition-[background-color,width,margin] duration-75 ease-standard",
              "group-hover/nav-item:bg-[#e8e8e8]/80",
              isActive && "bg-[#e4e4e4]/85 group-hover/nav-item:bg-[#dddddd]/90",
              isExpanded 
                ? "ml-[9px] mr-[9px] w-[calc(100%-18px)]" 
                : "ml-[15px] w-[40px]",
            )}
            data-active={isActive ? "true" : undefined}
          />

          <div className={cn(
            "absolute top-1/2 left-[15px] flex h-[32px] w-[40px] -translate-y-1/2 items-center justify-center transition-[color,transform] duration-200 pointer-events-none",
            "text-[#5f6368] group-hover/nav-item:text-[#252525]",
            isActive && "text-[#111111]",
            isCollapsedActive && "scale-[1.04]"
          )}>
            <Icon className="relative -translate-y-px h-[18px] w-[18px]" strokeWidth={isActive ? 2.35 : 2.1} />
          </div>

          {isExpanded && (
            <div className="absolute top-1/2 left-[55px] right-[4px] flex h-[32px] -translate-y-1/2 items-center pointer-events-none">
              <span
                className={cn(
                  "text-sm font-[450] leading-none transition-colors duration-200 text-[#666] group-hover/nav-item:text-[#252525]",
                  "whitespace-nowrap overflow-hidden",
                  hasChildren ? "pr-2" : "",
                  isActive && "text-[#111111]",
                )}
              >
                {item.name}
              </span>
              {hasChildren && (
                <button
                  type="button"
                  onClick={handleChevronClick}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center transition-all duration-200 ml-auto mr-3",
                    "text-[#888] hover:text-[#111111] pointer-events-auto",
                    isActive && "text-[#111111]",
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
            const isChildActive = pathname === child.path;
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
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Reset expanded item when sidebar expands/collapses
  useEffect(() => {
    setExpandedItem(null);
  }, [isExpanded]);

  return (
    <div className="mt-3 w-full">
      <nav className="w-full">
        <div className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = pathname === item.path || 
              pathname === item.path + "/" ||
              (pathname === "/" && item.path === "/dashboard") ||
              (pathname === "/dashboard/" && item.path === "/dashboard") ||
              (pathname?.startsWith(item.path) && item.path !== "/dashboard");

            return (
              <Item
                key={item.path}
                item={item}
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
        </div>
      </nav>
    </div>
  );
}
