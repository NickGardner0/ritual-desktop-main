'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { RitualLogo } from '@/components/ritual-logo';
import { ChatAssistantWidget } from '@/components/chat-assistant';
import { TimeTrackerWidget } from '@/components/timer/TimeTrackerWidget';
import { HabitSelector } from '@/components/habit-selector';
import {
  LineChart,
  Timer,
  Calendar,
  Settings,
  Download,
  Plug2,
  Bot,
  ChevronRight,
  Home,
  LogOut,
  User,
  LayoutDashboard,
  Menu,
  Pin,
  PanelLeft,
  Check,
  Search,
  Plus,
  Sun,
  Moon,
  ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';
// Conditional import for Tauri API to prevent SSR errors
// import { WebviewWindow } from '@tauri-apps/api/window';

const COLLAPSED_WIDTH = 72;
const EXPANDED_WIDTH = 165;

// Custom "I" letter icon component
const ILetterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    strokeWidth="2"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path
      d="M9 6h6M12 6v12M9 18h6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

const sidebarLinks = [
  { href: '/dashboard', icon: ILetterIcon, label: 'Index' },
  { href: '/analytics', icon: LineChart, label: 'Analytics' },
  { href: '/timer', icon: Timer, label: 'Timer' },
  { href: '/calendar', icon: Calendar, label: 'Calendar' },
  { href: '/integrations', icon: Plug2, label: 'Integrations' },
  { href: '/data-export', icon: Download, label: 'Data Export' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

type SidebarBehaviorMode = 'alwaysExpanded' | 'alwaysCollapsed' | 'expandOnHover';

interface SidebarLayoutProps {
  children: React.ReactNode;
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  
  const [sidebarBehaviorMode, setSidebarBehaviorMode] = useState<SidebarBehaviorMode>('alwaysCollapsed');
  const [isSidebarModeLoaded, setIsSidebarModeLoaded] = useState(false);
  const [tooltipOpenStates, setTooltipOpenStates] = useState<Record<string, boolean>>({});
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [user, setUser] = useState<any>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  // Basic state for HabitSelector component
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [habitOrder, setHabitOrder] = useState<string[]>([]);
  const [customHabits, setCustomHabits] = useState<Array<{ value: string; label: string; emoji: string; stat: string }>>([]);

  const addCustomHabit = (habit: { value: string; label: string; emoji: string; stat: string }) => {
    setCustomHabits(prev => [...prev, habit]);
  };

  const fetchHabitsFromApi = async () => {
    // Placeholder function for HabitSelector
    console.log('Fetching habits from API...');
  };

  async function openTimeTrackerWindow() {
    console.log('🖱️ Tracker button clicked - creating native Swift timer widget');
    
    // Create native Swift timer widget with real authentication
    if (typeof window !== 'undefined') {
      try {
        console.log('🔍 Creating native Swift timer widget...');
        const { invoke } = await import('@tauri-apps/api/tauri');
        
        // First, get the current auth token and write it to a file for Swift widget
        const { supabase } = await import('@/lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.access_token) {
          console.log('🔐 Writing auth token for Swift widget...');
          await invoke('write_auth_token_to_file', { token: session.access_token });
        } else {
          console.warn('⚠️ No auth token found - Swift widget may not work properly');
        }
        
        // Launch the native Swift widget
        await invoke('create_native_timer_widget');
        console.log('✅ Native Swift timer widget created successfully!');
        
      } catch (error) {
        console.error('❌ Failed to create native Swift timer widget:', error);
        console.error('❌ Falling back to Tauri widget...');
        
        // Fallback to Tauri widget
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
      }
    }
  }

  // Load sidebar behavior mode from localStorage after component mounts
  useEffect(() => {
    const savedMode = typeof window !== 'undefined' ? localStorage.getItem('sidebarBehaviorMode') as SidebarBehaviorMode | null : null;
    if (savedMode && ['alwaysExpanded', 'alwaysCollapsed', 'expandOnHover'].includes(savedMode)) {
      setSidebarBehaviorMode(savedMode);
    }
    setIsSidebarModeLoaded(true);
    // Remove old isSidebarPinned from localStorage if it exists
          if (typeof window !== 'undefined') {
        localStorage.removeItem('isSidebarPinned');
      } 
  }, []);

  // Save sidebar behavior mode to localStorage - only when value changes
  const prevSidebarModeRef = useRef<SidebarBehaviorMode | null>(null);
  
  useEffect(() => {
    if (sidebarBehaviorMode && prevSidebarModeRef.current !== sidebarBehaviorMode) {
      if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarBehaviorMode', sidebarBehaviorMode);
    }
      prevSidebarModeRef.current = sidebarBehaviorMode;
    }
  }, [sidebarBehaviorMode]);

  // Determine sidebar effective open state (needed by tooltip effect and rendering)
  let isSidebarEffectivelyOpen: boolean;
  if (sidebarBehaviorMode === 'alwaysExpanded') {
    isSidebarEffectivelyOpen = true;
  } else if (sidebarBehaviorMode === 'alwaysCollapsed') {
    isSidebarEffectivelyOpen = false;
  } else { // expandOnHover
    isSidebarEffectivelyOpen = isSidebarHovered;
  }

  // Effect to close all tooltips when sidebar opens effectively
  useEffect(() => {
    if (isSidebarEffectivelyOpen) {
      setTooltipOpenStates({});
    }
  }, [isSidebarEffectivelyOpen]);

  const handleSignOut = async () => {
    // Handle sign out for desktop app
    console.log('Signing out...');
    // Clear the user state and redirect to home page
    setUser(null);
    // Redirect to the home page
    if (typeof window !== 'undefined') {
      if (typeof window !== 'undefined') {
        window.location.href = '/home';
      }
    }
  };

  const handleAccount = () => {
    // Handle account action
    console.log('Account clicked');
  };

  const handleSupport = () => {
    // Handle support action
    console.log('Support clicked');
  };

  const handleTeams = () => {
    // Handle teams action
    console.log('Teams clicked');
  };

  const handleThemeClick = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const getUserInitials = () => {
    if (!user?.email) return 'N';
    return user.email.charAt(0).toUpperCase();
  };

  // Set up keyboard shortcut for assistant only
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        e.stopPropagation();
        // Toggle the chat assistant (close if open, open if closed)
        setIsAssistantOpen(prev => !prev);
      }
    };
    
    // Use the capture phase to ensure this handler runs before others
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown, true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown, true);
      }
    };
  }, []);

  const handleSidebarMouseEnter = () => {
    if (sidebarBehaviorMode === 'expandOnHover') {
      setIsSidebarHovered(true);
    }
  };

  const handleSidebarMouseLeave = () => {
    if (sidebarBehaviorMode === 'expandOnHover') {
      setIsSidebarHovered(false);
    }
  };
  
  const currentSidebarWidth = isSidebarEffectivelyOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const router = useRouter();

  return (
    <div className="app-container flex h-screen bg-white overflow-x-hidden max-w-full w-full border-0">
      {/* Window Drag Region - positioned to avoid button area */}
      <div 
        className="tauri-drag-region" 
        data-tauri-drag-region 
        style={{ 
          height: '32px', 
          top: '0', 
          left: '200px', 
          right: '0', 
          zIndex: 1000 
        }} 
      />
      
      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className='flex flex-col bg-white border-r border-gray-200 shadow-sm transition-all duration-300 relative h-full'
        style={{ width: `${currentSidebarWidth}px` }}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        {/* Sidebar Header - Logo only */}
        <div className="flex items-center h-16 px-4 border-b border-gray-200 justify-center">
          <div className="flex items-center cursor-pointer hover:opacity-80 transition-opacity">
            <RitualLogo className="w-6 h-6 text-primary" /> 
          </div>
        </div>
        
        {/* Navigation Links */}
        <nav className="flex-1 p-2 pt-4 space-y-3 overflow-y-auto">
          <TooltipProvider delayDuration={100}>
            {sidebarLinks.map((link) => {
              const Icon = link.icon;
              const isActive = typeof window !== 'undefined' && window.location.pathname === link.href;

              return (
                <Tooltip 
                  key={link.href}
                  open={!isSidebarEffectivelyOpen && (tooltipOpenStates[link.href] ?? false)}
                  onOpenChange={(isOpen) => {
                    if (!isSidebarEffectivelyOpen) { // Only allow user-triggered changes if sidebar is collapsed
                      setTooltipOpenStates(prev => ({ ...prev, [link.href]: isOpen }));
                    } else if (!isOpen && tooltipOpenStates[link.href]) { // If sidebar is open and a tooltip tries to close itself
                      setTooltipOpenStates(prev => ({ ...prev, [link.href]: false }));
                    }
                    // If sidebar is open, the `open` prop already forces tooltips closed by its first condition.
                  }}
                >
                  <TooltipTrigger asChild>
                    {isSidebarEffectivelyOpen ? (
                                            <div
                        className={cn(
                          "flex items-center px-3 py-1 cursor-default transition-colors",
                          isActive
                            ? 'text-black'
                            : 'text-gray-500 hover:text-black'
                        )}
                        onClick={() => {
                          router.push(link.href);
                        }}
                      >
                        <Icon className="h-5 w-5 text-black" />
                        <span className="ml-3 whitespace-nowrap overflow-hidden text-ellipsis">{link.label}</span>
                      </div>
                    ) : (
                      <button
                        className={cn(
                          "flex items-center justify-center p-1.5 mx-auto w-9 h-9 transition-colors cursor-default",
                          isActive
                            ? 'bg-[#F5F5F5] text-primary border border-gray-200'
                            : 'hover:bg-[#F5F5F5] hover:border hover:border-gray-200'
                        )}
                        onClick={() => {
                          router.push(link.href);
                        }}
                      >
                        <Icon className="h-5 w-5 mx-auto" />
                      </button>
                    )}
                  </TooltipTrigger>
                  {!isSidebarEffectivelyOpen && (
                    <TooltipContent side="right" className="py-1 px-2 text-xs h-7 flex items-center">
                      {link.label}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </nav>

        {/* Sidebar Footer - Control Button & Dropdown */}
        <div className="p-2 border-t border-gray-200">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "w-full h-9 flex items-center text-gray-600 transition-colors",
                  isSidebarEffectivelyOpen ? "justify-start px-3 rounded-none" : "justify-center px-0 w-10 mx-auto",
                  "hover:bg-[#F5F5F5] hover:border hover:border-gray-200 focus:bg-[#F5F5F5] focus:border focus:border-gray-200 active:bg-[#F5F5F5] active:border active:border-gray-200"
                )}
                title="Sidebar control"
              >
                <PanelLeft className="h-4 w-4" />
                {isSidebarEffectivelyOpen && <span className="ml-2 text-sm">Sidebar control</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-40 mb-1 ml-1">
              <DropdownMenuLabel>Sidebar</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSidebarBehaviorMode('alwaysExpanded')} className="flex justify-between items-center">
                Expanded
                {sidebarBehaviorMode === 'alwaysExpanded' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSidebarBehaviorMode('alwaysCollapsed')} className="flex justify-between items-center">
                Collapsed
                {sidebarBehaviorMode === 'alwaysCollapsed' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSidebarBehaviorMode('expandOnHover')} className="flex justify-between items-center">
                Expand on hover
                {sidebarBehaviorMode === 'expandOnHover' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden border-0">
        {/* Top Header - Midday Style */}
        <header
          className="px-6 h-16 flex items-center border-b border-gray-200 no-drag"
          style={{ '--webkit-app-region': 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center justify-between w-full">
            {/* Left side - Assistant and Quick Actions buttons */}
            <div className="flex items-center space-x-3 no-drag" style={{ '--webkit-app-region': 'no-drag' } as React.CSSProperties}>
              {/* Assistant Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAssistantOpen(true)}
                className="flex items-center gap-2 text-sm text-gray-600 px-3 py-2 h-9 border border-gray-200 shadow-sm hover:bg-[#F5F5F5] focus-visible:outline-none focus-visible:ring-0 rounded-none no-drag"
                style={{ cursor: 'pointer', '--webkit-app-region': 'no-drag' } as React.CSSProperties}
              >
                <span>Assistant</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 border bg-[#fafaf9] px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>A
                </kbd>
              </Button>

              {/* Quick Actions Button - HabitSelector */}
              <div style={{ '--webkit-app-region': 'no-drag' } as React.CSSProperties}>
                <HabitSelector 
                  className="h-9 w-auto px-3 py-2 text-sm text-gray-600 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-0 border border-gray-200 shadow-sm hover:bg-[#F5F5F5] rounded-none no-drag"
                />
              </div>

              {/* Tracker Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={openTimeTrackerWindow}
                className="flex items-center gap-2 text-sm text-gray-600 px-3 py-2 h-9 border border-gray-200 shadow-sm hover:bg-[#F5F5F5] focus-visible:outline-none focus-visible:ring-0 rounded-none no-drag"
                style={{ cursor: 'pointer', '--webkit-app-region': 'no-drag' } as React.CSSProperties}
              >
                <span>Tracker</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 border bg-[#fafaf9] px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>T
                </kbd>
              </Button>
            </div>

            {/* Right side - User dropdown */}
            <div className="flex items-center space-x-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 h-9 rounded-none px-2 bg-[#F5F5F5] w-10 min-w-0 p-0 justify-center hover:bg-[#DCDAD2] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-0">
                    <span className="text-gray-900 font-medium text-base transition-colors">{getUserInitials()}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[230px] p-0">
                  <div className="p-2 border-b">
                    <h3 className="text-sm font-medium">Nick Gardner</h3>
                    <p className="text-xs text-gray-500">{user?.email || 'nickgardner0651@gmail.com'}</p>
                  </div>
                  
                  <div className="p-0.5">
                    <DropdownMenuItem className="py-1 px-2 focus:bg-gray-100 cursor-pointer flex items-center text-sm">
                      <span>Account</span>
                      <div className="ml-auto text-xs text-gray-500">⌘P</div>
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem className="py-1 px-2 focus:bg-gray-100 cursor-pointer flex items-center text-sm">
                      <span>Support</span>
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem className="py-1 px-2 focus:bg-gray-100 cursor-pointer flex items-center text-sm">
                      <span>Teams</span>
                      <div className="ml-auto text-xs text-gray-500">⌘E</div>
                    </DropdownMenuItem>
                  </div>
                  
                  <DropdownMenuSeparator className="my-0.5" />
                  
                  <div className="p-0.5">
                    <DropdownMenuItem onClick={handleSignOut} className="py-1 px-2 focus:bg-gray-100 cursor-pointer flex items-center text-black text-sm"
                      style={{ backgroundColor: undefined }}
                      onMouseOver={e => e.currentTarget.style.backgroundColor = '#F5F5F5'}
                      onMouseOut={e => e.currentTarget.style.backgroundColor = ''}
                      onFocus={e => e.currentTarget.style.backgroundColor = '#F5F5F5'}
                      onBlur={e => e.currentTarget.style.backgroundColor = ''}
                    >
                      <span>Sign out</span>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-white border-0">
          {children}
        </main>
      </div>

      {/* Chat Assistant Widget */}
      <ChatAssistantWidget 
        open={isAssistantOpen} 
        onClose={() => setIsAssistantOpen(false)} 
      />

      {/* Time Tracker Widget */}
      <TimeTrackerWidget 
        open={false} 
        onClose={() => {}} 
      />

    </div>
  );
} 