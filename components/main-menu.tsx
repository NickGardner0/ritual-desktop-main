"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  LineChart,
  Timer,
  Calendar,
  Settings,
  Download,
  Plug2,
  ChevronDown,
  LayoutDashboard,
} from "lucide-react";
import { usePrefetchDashboard, usePrefetchAnalytics, usePrefetchCalendar, usePrefetchTimer } from "@/hooks/use-prefetch";

// Lazy load SettingsModal since it's only shown when clicked
const SettingsModal = lazy(() => import("./settings-modal").then(m => ({ default: m.SettingsModal })));

// Custom "I" letter icon component for Index
const ILetterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    strokeWidth="2.1"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path
      d="M9 6h6M12 6v12M9 18h6"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

const icons = {
  "/dashboard": () => <ILetterIcon className="w-5 h-5" />,
  "/analytics": () => <LineChart className="w-5 h-5" strokeWidth={2.1} />,
  "/timer": () => <Timer className="w-5 h-5" strokeWidth={2.1} />,
  "/calendar": () => <Calendar className="w-5 h-5" strokeWidth={2.1} />,
  "/integrations": () => <Plug2 className="w-5 h-5" strokeWidth={2.1} />,
  "/data-export": () => <Download className="w-5 h-5" strokeWidth={2.1} />,
  "/settings": () => <Settings className="w-5 h-5" strokeWidth={2.1} />,
} as const;

const items = [
  {
    path: "/dashboard",
    name: "Index",
  },
  {
    path: "/analytics",
    name: "Analytics",
  },
  {
    path: "/timer",
    name: "Timer",
    children: [
      { path: "/timer?create=true", name: "Create new session" },
    ],
  },
  {
    path: "/calendar",
    name: "Calendar",
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
    path: "/data-export",
    name: "Data Export",
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
            "ml-[35px] mr-[15px] h-[32px] flex items-center",
            "border-l border-[#DCDAD2] dark:border-[#2C2C2C] pl-3",
            "transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
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
              "text-xs font-medium transition-colors duration-200",
              "text-gray-500 group-hover/child:text-gray-900",
              "whitespace-nowrap overflow-hidden",
              isActive && "text-gray-900",
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
  
  // Prefetch data on hover (Midday-style optimization)
  const prefetchDashboard = usePrefetchDashboard();
  const prefetchAnalytics = usePrefetchAnalytics();
  const prefetchCalendar = usePrefetchCalendar();
  const prefetchTimer = usePrefetchTimer();
  
  // Get the right prefetch function for this item
  const getPrefetchProps = () => {
    switch (item.path) {
      case '/dashboard': return prefetchDashboard;
      case '/analytics': return prefetchAnalytics;
      case '/calendar': return prefetchCalendar;
      case '/timer': return prefetchTimer;
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
      onSelect?.();
    }
  };

  return (
    <div className="group">
      <Link
        href={item.path === "/settings" ? "#" : item.path}
        onClick={handleItemClick}
        className="group"
        prefetch={true}
        {...getPrefetchProps()}
      >
        <div className="relative">
          {/* Background that expands - only for active state */}
          <div
            className={cn(
              "border border-transparent h-[40px] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isActive && "border-gray-200",
              isExpanded 
                ? "ml-[15px] mr-[15px] w-[calc(100%-30px)]" 
                : "ml-[15px] w-[40px] rounded-none",
            )}
            style={{
              backgroundColor: isActive ? '#F3F3F3' : 'transparent'
            }}
          />

          {/* Icon - always in same position from sidebar edge */}
          <div className={cn(
            "absolute top-0 left-[15px] w-[40px] h-[40px] flex items-center justify-center transition-colors pointer-events-none",
            "text-black"
          )}>
            <div className={cn(isActive && "text-black")}>
              <Icon />
            </div>
          </div>

          {isExpanded && (
            <div className="absolute top-0 left-[55px] right-[4px] h-[40px] flex items-center pointer-events-none">
              <span
                className={cn(
                  "text-sm font-medium transition-colors duration-200 text-gray-600 group-hover:text-gray-900",
                  "whitespace-nowrap overflow-hidden",
                  hasChildren ? "pr-2" : "",
                  isActive && "text-gray-900",
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
                    "text-gray-500 hover:text-gray-900 pointer-events-auto",
                    isActive && "text-gray-900",
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
            "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
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
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Reset expanded item when sidebar expands/collapses
  useEffect(() => {
    setExpandedItem(null);
  }, [isExpanded]);

  return (
    <div className="mt-6 w-full">
      <nav className="w-full">
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            // Improved active state logic
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
      </nav>
      
      {/* Settings Modal */}
      {showSettingsModal && (
        <Suspense fallback={null}>
          <SettingsModal 
            isOpen={showSettingsModal} 
            onClose={() => setShowSettingsModal(false)}
            onOpen={onCloseSidebar}
          />
        </Suspense>
      )}
    </div>
  );
}
