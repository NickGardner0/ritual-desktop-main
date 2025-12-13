"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  LineChart,
  Timer,
  Settings,
  Download,
  Plug2,
  ChevronDown,
  TableProperties,
} from "lucide-react";
import { usePrefetchDashboard, usePrefetchAnalytics } from "@/hooks/use-prefetch";
import { useAuth } from "@clerk/nextjs";
import { toast } from "sonner";

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
  "/activity": () => <TableProperties className="w-5 h-5" strokeWidth={2.1} />,
  "/timer": () => <Timer className="w-5 h-5" strokeWidth={2.1} />,
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
    path: "/activity",
    name: "Logs",
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
  onTimerClick,
  onDataExportClick,
}: ItemProps & { onSettingsClick?: () => void; onTimerClick?: () => void; onDataExportClick?: () => void }) => {
  const Icon = icons[item.path as keyof typeof icons];
  const pathname = usePathname();
  const router = useRouter();
  const hasChildren = item.children && item.children.length > 0;
  
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
    } else if (item.path === "/data-export") {
      e.preventDefault();
      onDataExportClick?.();
    } else {
      // Use explicit router navigation to ensure it works
      e.preventDefault();
      onSelect?.();
      router.push(item.path);
    }
  };

  return (
    <div className="group">
      <Link
        href={item.path === "/settings" || item.path === "/timer" || item.path === "/data-export" ? "#" : item.path}
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
  const { getToken } = useAuth();

  // Reset expanded item when sidebar expands/collapses
  useEffect(() => {
    setExpandedItem(null);
  }, [isExpanded]);

  // Export habit data as CSV
  const exportHabitData = async () => {
    console.log('📊 Data Export clicked - exporting habit data as CSV');
    
    // Show loading toast
    const toastId = toast.loading('Preparing your data export...');
    
    try {
      const token = await getToken();
      console.log('🔐 Got auth token:', token ? 'yes' : 'no');
      
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      console.log('🌐 Backend URL:', backendUrl);
      
      // Fetch habits and logs in parallel
      const [habitsRes, logsRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        }),
        fetch(`${backendUrl}/api/habit-logs`, {
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        })
      ]);
      
      console.log('📡 Response status - habits:', habitsRes.status, 'logs:', logsRes.status);
      
      if (!habitsRes.ok || !logsRes.ok) {
        throw new Error(`Failed to fetch data: habits=${habitsRes.status}, logs=${logsRes.status}`);
      }
      
      const [habits, logs] = await Promise.all([habitsRes.json(), logsRes.json()]);
      console.log('📦 Fetched habits:', habits.length, 'logs:', logs.length);
      
      // Create a map of habit_id -> habit details for quick lookup
      const habitMap = new Map<string, any>();
      habits.forEach((habit: any) => {
        habitMap.set(habit.id, habit);
      });
      
      if (!logs || logs.length === 0) {
        toast.dismiss(toastId);
        toast.info('No habit data to export yet.');
        return;
      }
      
      // Define CSV headers
      const headers = ['Date', 'Time', 'Habit Name', 'Category', 'Value', 'Unit', 'Source', 'Notes'];
      
      // Convert logs to CSV rows
      const rows = logs.map((log: any) => {
        // Get habit details from the map
        const habit = habitMap.get(log.habit_id) || {};
        
        const date = log.date || '';
        const time = log.completed_at 
          ? new Date(log.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          : '';
        const habitName = habit.name || '';
        const category = habit.category || '';
        
        // Format value based on type
        let value = '';
        if (log.duration) {
          const hours = Math.floor(log.duration / 3600);
          const mins = Math.floor((log.duration % 3600) / 60);
          value = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        } else if (log.amount !== undefined && log.amount !== null) {
          value = String(log.amount);
        }
        
        const unit = habit.unit_type || '';
        const source = habit.integration_source || 'Manual';
        const notes = (log.notes || '').replace(/"/g, '""'); // Escape quotes
        
        // Escape fields that might contain commas
        const escapeField = (field: string) => {
          if (field.includes(',') || field.includes('"') || field.includes('\n')) {
            return `"${field}"`;
          }
          return field;
        };
        
        return [date, time, habitName, category, value, unit, source, notes].map(escapeField).join(',');
      });
      
      // Combine headers and rows
      const csvContent = [headers.join(','), ...rows].join('\n');
      
      // Generate filename with date
      const today = new Date().toISOString().split('T')[0];
      const filename = `ritual-habit-data-${today}.csv`;
      
      // Try Tauri's save dialog first (for desktop app)
      let saved = false;
      if (typeof window !== 'undefined' && '__TAURI__' in window) {
        try {
          const { save } = await import('@tauri-apps/api/dialog');
          const { writeTextFile } = await import('@tauri-apps/api/fs');
          
          const filePath = await save({
            defaultPath: filename,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
          });
          
          if (filePath) {
            await writeTextFile(filePath, csvContent);
            saved = true;
            toast.dismiss(toastId);
            toast.success(`Exported ${logs.length} habit logs to ${filePath.split('/').pop()}`);
            console.log(`✅ Exported ${logs.length} habit logs to ${filePath}`);
          } else {
            // User cancelled the save dialog
            toast.dismiss(toastId);
            toast.info('Export cancelled');
            return;
          }
        } catch (tauriError) {
          console.log('Tauri save failed, falling back to browser download:', tauriError);
        }
      }
      
      // Fallback to browser download (for web)
      if (!saved) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        toast.dismiss(toastId);
        toast.success(`Exported ${logs.length} habit logs to CSV`);
        console.log(`✅ Exported ${logs.length} habit logs to CSV`);
      }
      
    } catch (error) {
      console.error('❌ Failed to export habit data:', error);
      toast.dismiss(toastId);
      toast.error('Failed to export data. Please try again.');
    }
  };

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
                onDataExportClick={exportHabitData}
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
