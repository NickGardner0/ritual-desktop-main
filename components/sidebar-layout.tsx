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
import { useAuth } from '@/contexts/AuthContext';
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
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  // Sidebar behavior state
  const [sidebarBehaviorMode, setSidebarBehaviorMode] = useState<SidebarBehaviorMode>('expandOnHover');
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarModeLoaded, setIsSidebarModeLoaded] = useState(false);
  const [tooltipOpenStates, setTooltipOpenStates] = useState<Record<string, boolean>>({});
  
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
    try {
      await signOut();
      // Redirect to the home page
      if (typeof window !== 'undefined') {
        window.location.href = '/home';
      }
    } catch (error) {
      console.error('Sign out error:', error);
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
      
      {/* Sidebar - Midday Style */}
      <aside
        className={cn(
          "h-screen flex-shrink-0 flex-col justify-between fixed top-0 pb-4 items-center hidden md:flex z-50 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "bg-background border-r border-gray-300",
          isExpanded ? "w-[240px]" : "w-[70px]",
        )}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        {/* Logo Header */}
        <div
          className={cn(
            "absolute top-0 left-0 h-[70px] flex items-center justify-center bg-background border-b border-gray-300 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]",
            isExpanded ? "w-full" : "w-[69px]",
          )}
        >
          <div className="absolute left-[22px] transition-none">
            <RitualLogo className="w-5 h-5 text-primary" />
          </div>
        </div>
        
        {/* Main Navigation */}
        <div className="flex flex-col w-full pt-[70px] flex-1">
          <nav className="flex flex-col gap-1 p-2">
            {sidebarLinks.map((link) => {
              const Icon = link.icon;
              const isActive = typeof window !== 'undefined' && window.location.pathname === link.href;

              return (
                <TooltipProvider key={link.href}>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          "hover:bg-accent hover:text-accent-foreground",
                          isActive && "bg-accent text-accent-foreground",
                          !isExpanded && "justify-center px-2"
                        )}
                        onClick={() => router.push(link.href)}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {isExpanded && (
                          <span className="truncate">{link.label}</span>
                        )}
                      </button>
                    </TooltipTrigger>
                    {!isExpanded && (
                      <TooltipContent side="right" className="ml-1">
                        {link.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </nav>
        </div>

        {/* User Dropdown */}
        <div className="p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "h-10 transition-all duration-200",
                  isExpanded ? "w-full justify-start px-3" : "w-10 justify-center px-0"
                )}
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user?.user_metadata?.picture} />
                  <AvatarFallback className="text-xs">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                {isExpanded && (
                  <div className="ml-3 text-left overflow-hidden">
                    <p className="text-sm font-medium truncate">
                      {user?.user_metadata?.name || user?.email || 'User'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56 mb-2">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleAccount}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSupport}>
                <Bot className="mr-2 h-4 w-4" />
                Support
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleThemeClick}>
                {theme === 'dark' ? (
                  <Sun className="mr-2 h-4 w-4" />
                ) : (
                  <Moon className="mr-2 h-4 w-4" />
                )}
                Toggle theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
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

              {/* Quick Actions Button - Command Palette */}
              <div style={{ '--webkit-app-region': 'no-drag' } as React.CSSProperties}>
                <CommandPalette 
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