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
import { useAuth } from "@clerk/nextjs";
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
              "text-gray-600 group-hover/child:text-gray-900",
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
  onTimerClick,
}: ItemProps & { onSettingsClick?: () => void; onTimerClick?: () => void }) => {
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
    } else if (item.path === "/timer") {
      e.preventDefault();
      onTimerClick?.();
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
          {/* Keep a stable click target in both modes without active borders */}
          <div
            className={cn(
              "h-[40px] transition-all duration-200 ease-standard",
              isExpanded 
                ? "ml-[15px] mr-[15px] w-[calc(100%-30px)]" 
                : "ml-[15px] w-[40px] rounded-none",
            )}
          />

          {/* Icon - always in same position from sidebar edge */}
          <div className={cn(
            "absolute top-0 left-[15px] w-[40px] h-[40px] flex items-center justify-center transition-[color,transform] duration-200 pointer-events-none",
            "text-[#111111]",
            isCollapsedActive && "scale-[1.04]"
          )}>
            <Icon className="w-5 h-5" strokeWidth={isActive ? 2.6 : 2.15} />
          </div>

          {isExpanded && (
            <div className="absolute top-0 left-[55px] right-[4px] h-[40px] flex items-center pointer-events-none">
              <span
                className={cn(
                  "text-sm font-[450] transition-colors duration-200 text-[#2a2a2a] group-hover:text-[#111111]",
                  "whitespace-nowrap overflow-hidden",
                  hasChildren ? "pr-2" : "",
                  isActive && "text-[#111111] font-[600]",
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
                    "text-[#3a3a3a] hover:text-[#111111] pointer-events-auto",
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
  const [settingsInitialView, setSettingsInitialView] = useState<'account' | 'computer-tracking' | 'apple-health' | 'voice-logging' | undefined>(undefined);
  const { getToken } = useAuth();

  // Open Settings modal from URL param (e.g. /integrations?openSettings=computer-tracking)
  useEffect(() => {
    const view = searchParams.get('openSettings');
    if (
      view === 'account' ||
      view === 'computer-tracking' ||
      view === 'apple-health' ||
      view === 'voice-logging'
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

  // Open native Swift timer widget
  const openNativeTimer = async () => {
    console.log('🖱️ Timer menu clicked - creating native Swift timer widget');
    
    if (typeof window !== 'undefined') {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        
        // Get Clerk JWT token for authentication
        const token = await getToken();
        
        if (token) {
          console.log('🔐 Writing auth token for Swift widget...');
          await invoke('write_auth_token_to_file', { token });
        }
        
        await invoke('create_native_timer_widget');
        console.log('✅ Native Swift timer widget created successfully!');
        
      } catch (error) {
        console.error('❌ Failed to create native Swift timer widget:', error);
        // Fallback to Tauri widget
        try {
          const { WebviewWindow } = await import('@tauri-apps/api/window');
          
          const windowLabel = `timer-widget-${Date.now()}`;
          const trackerWindow = new WebviewWindow(windowLabel, {
            url: '/widget',
            width: 320,
            height: 50,
            alwaysOnTop: true,
            decorations: false,
            resizable: false,
            skipTaskbar: true,
            center: true,
            title: 'Focus Timer',
            transparent: true,
          });
          
          trackerWindow.once('tauri://created', function () {
            console.log('✅ Fallback Tauri timer widget created successfully!');
          });
        } catch (fallbackError) {
          console.error('❌ Fallback also failed:', fallbackError);
        }
      }
    }
  };

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
                onTimerClick={openNativeTimer}
              />
            );
          })}
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
