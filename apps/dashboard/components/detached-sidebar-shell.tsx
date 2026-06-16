"use client";

import { useEffect, useState } from "react";
import { CalendarDays, FlaskConical, Plug2, Settings, TableProperties } from "lucide-react";
import TocIcon from "@mui/icons-material/Toc";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/tauri-utils";

type SidebarState = {
  path: string;
  width: number;
};

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
    <path d="M9 6h6M12 6v12M9 18h6" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
  </svg>
);

const items = [
  { path: "/dashboard", name: "Index", icon: ILetterIcon },
  { path: "/tasks", name: "Tasks", icon: TocIcon },
  { path: "/activity", name: "Logs", icon: TableProperties },
  { path: "/calendar", name: "Calendar", icon: CalendarDays },
  { path: "/experiments", name: "Experiments", icon: FlaskConical },
  { path: "/integrations", name: "Integrations", icon: Plug2 },
  { path: "/settings", name: "Settings", icon: Settings },
];

export function DetachedSidebarShell() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activePath, setActivePath] = useState("/dashboard");
  const collapsedWidth = 76;
  const expandedWidth = 202;
  const width = isExpanded ? expandedWidth : collapsedWidth;

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const state = await invoke<SidebarState>("sidebar_get_main_state");
        if (state?.path) setActivePath(state.path);
        if (typeof state?.width === "number") setIsExpanded(state.width > collapsedWidth);
      } catch (error) {
        console.error("Failed to read sidebar state:", error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("sidebar_set_width", { width });
      } catch (error) {
        console.error("Failed to sync sidebar width:", error);
      }
    })();
  }, [width]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<string>("sidebar:route", (event) => {
        if (typeof event.payload === "string" && event.payload.length > 0) {
          setActivePath(event.payload);
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const navigate = async (path: string) => {
    if (path === "/experiments") return;
    setActivePath(path);
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sidebar_navigate", { path });
  };

  return (
    <aside
      className={cn(
        "sidebar-vibrancy relative h-screen flex-shrink-0 flex-col justify-between fixed top-0 left-0 pb-4 items-stretch overflow-hidden flex z-[1002]",
        isExpanded ? "w-[202px]" : "w-[76px]",
      )}
      style={{ transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)' }}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div
        className="sidebar-header absolute top-0 left-0 z-[2] h-[70px] flex items-center justify-center transition-all duration-200 ease-standard"
        style={{ width: collapsedWidth }}
      >
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="flex h-full w-full items-center justify-center pt-[6px] transition-none"
        >
          <img src="/images/eclipse.svg" alt="Ritual Logo" className="w-[32px] h-[32px] flex-shrink-0" />
        </button>
      </div>

      <div className="flex flex-col w-full pt-[70px] flex-1 mt-6">
        <nav className="w-full">
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const isActive = activePath.startsWith(item.path);
              const isCollapsedActive = isActive && !isExpanded;
              const Icon = item.icon;
              return (
                <button key={item.path} type="button" onClick={() => navigate(item.path)} className="group/nav-item text-left">
                  <div className="relative">
                    <div
                      className={cn(
                        "sidebar-nav-row h-[32px] rounded-md transition-[background-color,width,margin] duration-75 ease-standard",
                        "group-hover/nav-item:bg-[#e8e8e8]/80",
                        isActive && "bg-[#e4e4e4]/85 group-hover/nav-item:bg-[#dddddd]/90",
                        isExpanded ? "ml-[9px] mr-[9px] w-[calc(100%-18px)]" : "ml-[15px] w-[40px]",
                      )}
                      data-active={isActive ? "true" : undefined}
                    />
                    <div
                      className={cn(
                        "absolute top-0 left-[15px] flex h-[32px] w-[40px] items-center justify-center transition-[color,transform] duration-200",
                        "text-[#5f6368] group-hover/nav-item:text-[#252525]",
                        isActive && "text-[#111111]",
                        isCollapsedActive && "scale-[1.04]",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.35 : 2.1} />
                    </div>
                    {isExpanded && (
                      <div className="absolute top-0 left-[55px] right-[8px] flex h-[32px] items-center">
                        <span
                          className={cn(
                            "text-sm font-[450] transition-colors duration-200 text-[#666] group-hover/nav-item:text-[#252525] whitespace-nowrap overflow-hidden",
                            isActive && "text-[#111111]",
                          )}
                        >
                          {item.name}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="w-full flex justify-center pb-1">
        <div className="h-12 w-12 rounded-full border border-[#3d3f43] bg-[#23262a] text-[#f2f2f2] flex items-center justify-center text-2xl font-medium">
          N
        </div>
      </div>
    </aside>
  );
}
