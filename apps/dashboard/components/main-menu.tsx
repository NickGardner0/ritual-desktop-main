"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Timer,
  Settings,
  Plug2,
  ChevronDown,
  TableProperties,
  CalendarDays,
} from "lucide-react";
import TocIcon from "@mui/icons-material/Toc";
import { usePrefetchDashboard, usePrefetchAnalytics } from "@/hooks/use-prefetch";
import dynamic from 'next/dynamic';

const SettingsModal = dynamic(
  () => import("./settings-modal").then(m => ({ default: m.SettingsModal })),
  { ssr: false }
);

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

const icons = {
  "/dashboard": (props: React.SVGProps<SVGSVGElement>) => <ILetterIcon {...props} />,
  "/tasks": (props: React.SVGProps<SVGSVGElement>) => <TocIcon className={props.className} />,
  "/activity": (props: React.SVGProps<SVGSVGElement>) => <TableProperties {...props} />,
  "/calendar": (props: React.SVGProps<SVGSVGElement>) => <CalendarDays {...props} />,
  "/timer": (props: React.SVGProps<SVGSVGElement>) => <Timer {...props} />,
  "/integrations": (props: React.SVGProps<SVGSVGElement>) => <Plug2 {...props} />,
  "/settings": (props: React.SVGProps<SVGSVGElement>) => <Settings {...props} />,
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
    path: "/timer",
    name: "Timer",
  },
  {
    path: "/integrations",
    name: "Integrations",
    children: [
      { path: "/integrations?tab=available", name: "Available" },
      { path: "/integrations?tab=connected", name: "Connected" },
    ],
  },
  {
    path: "/settings",
    name: "Settings",
    children: [
      { path: "/settings", name: "General" },
      { path: "/settings/account", name: "Account" },
      { path: "/settings/notifications", name: "Notifications" },
    ],
  },
];

const itemGroups = [
  {
    label: "Workspace",
    items: items.slice(0, 4),
  },
  {
    label: "System",
    items: items.slice(4),
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
      className="block group/child"
      prefetch={true}
    >
      <div className="relative">
        {/* Child item text */}
        <div
          className={cn(
            "ml-[58px] mr-[14px] h-[30px] flex items-center rounded-[10px] pl-3",
            "border-l border-[rgba(32,32,28,0.10)]",
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
              "text-[12px] font-[450] transition-colors duration-200",
              "text-[#6f6b62] group-hover/child:text-[#1e1d1a]",
              "whitespace-nowrap overflow-hidden",
              isActive && "text-[#1e1d1a]",
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
  onSettingsClick,
}: ItemProps & { onSettingsClick?: () => void }) => {
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
    if (item.path === "/settings") {
      e.preventDefault();
      onSettingsClick?.();
    } else {
      // Let the Link handle navigation naturally
      // Just call onSelect for any sidebar collapse behavior
      onSelect?.();
    }
  };

  return (
    <div className="group">
      <Link
        href={item.path === "/settings" || item.path === "/timer" ? "#" : item.path}
        onClick={handleItemClick}
        className="group"
        prefetch={true}
        {...getPrefetchProps()}
      >
        <div className="relative">
          <div
            className={cn(
              "h-[42px] transition-all duration-200 ease-standard rounded-[13px] border",
              isExpanded 
                ? "ml-[10px] mr-[10px] w-[calc(100%-20px)]" 
                : "mx-auto w-[44px]",
              isActive
                ? "border-[rgba(17,24,39,0.06)] bg-[rgba(255,255,255,0.78)] shadow-[0_1px_0_rgba(255,255,255,0.75),0_10px_26px_rgba(15,23,42,0.04)]"
                : "border-transparent bg-transparent group-hover:border-[rgba(17,24,39,0.04)] group-hover:bg-[rgba(255,255,255,0.46)]",
            )}
          />

          <div className={cn(
            "absolute top-0 left-[12px] w-[40px] h-[42px] flex items-center justify-center transition-[color,transform] duration-200 pointer-events-none",
            isActive ? "text-[#161616]" : "text-[#58554e]",
            isCollapsedActive && "scale-[1.03]"
          )}>
            <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.45 : 2.05} />
          </div>

          {isExpanded && (
            <div className="absolute top-0 left-[52px] right-[12px] h-[42px] flex items-center pointer-events-none">
              <span
                className={cn(
                  "text-[14px] font-[500] transition-colors duration-200 text-[#35322c] group-hover:text-[#111111]",
                  "whitespace-nowrap overflow-hidden",
                  hasChildren ? "pr-2" : "",
                  isActive && "text-[#111111] font-[560]",
                )}
              >
                {item.name}
              </span>
              {hasChildren && (
                <button
                  type="button"
                  onClick={handleChevronClick}
                  className={cn(
                    "w-8 h-8 flex items-center justify-center transition-all duration-200 ml-auto rounded-[10px] mr-0",
                    "text-[#6a665e] hover:text-[#111111] pointer-events-auto hover:bg-[rgba(255,255,255,0.48)]",
                    isActive && "text-[#111111]",
                    shouldShowChildren && "rotate-180",
                  )}
                >
                  <ChevronDown className="w-4 h-4" strokeWidth={2.1} />
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
  onCloseSidebar?: () => void;
};

export function MainMenu({ onSelect, isExpanded = false, onCloseSidebar }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<'account' | 'computer-tracking' | 'apple-health' | undefined>(undefined);

  // Open Settings modal from URL param (e.g. /integrations?openSettings=computer-tracking)
  useEffect(() => {
    const view = searchParams.get('openSettings');
    if (
      view === 'account' ||
      view === 'computer-tracking' ||
      view === 'apple-health'
    ) {
      setSettingsInitialView(view);
      setShowSettingsModal(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('openSettings');
      const qs = params.toString();
      router.replace(qs ? `${pathname || ''}?${qs}` : pathname || '/');
    }
  }, [searchParams, pathname, router]);

  // Reset expanded item when sidebar expands/collapses
  useEffect(() => {
    setExpandedItem(null);
  }, [isExpanded]);

  return (
    <div className="mt-2 w-full">
      <nav className="w-full">
        <div className="flex flex-col gap-4">
          {itemGroups.map((group) => (
            <div key={group.label} className="w-full">
              {isExpanded && (
                <div className="px-4 pb-2">
                  <span className="text-[10px] font-[560] uppercase tracking-[0.16em] text-[#8b867d]">
                    {group.label}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
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
                      onSettingsClick={() => setShowSettingsModal(true)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      
      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal 
          isOpen={showSettingsModal} 
          onClose={() => {
            setShowSettingsModal(false);
            setSettingsInitialView(undefined);
            onCloseSidebar?.();
          }}
          onOpen={onCloseSidebar}
          initialView={settingsInitialView}
        />
      )}
    </div>
  );
}
