"use client";

import { Sidebar } from '@/components/sidebar';
import { TimeTrackerWidget } from '@/components/timer/TimeTrackerWidget';
import CommandPalette from '@/components/habit-selector';
import { Button } from '@/components/ui/button';
import { TeamDropdown } from '@/components/team-dropdown';
import { FeedbackModal } from '@/components/feedback-modal';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSearchParams } from 'next/navigation';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const searchParams = useSearchParams();
  const [shouldOpenWhoopModal, setShouldOpenWhoopModal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  
  useEffect(() => {
    // Check if we should open the Whoop modal
    const openWhoopModal = searchParams.get('open_whoop_modal');
    if (openWhoopModal === 'true') {
      setShouldOpenWhoopModal(true);
      // Clean up the URL parameter
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);
  const { user } = useAuth();

  const openTimeTrackerWindow = async () => {
    console.log('🖱️ Tracker button clicked - creating native Swift timer widget');
    
    if (typeof window !== 'undefined') {
      try {
        console.log('🔍 Creating native Swift timer widget...');
        const { invoke } = await import('@tauri-apps/api/tauri');
        
        const { supabase } = await import('@/lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.access_token) {
          console.log('🔐 Writing auth token for Swift widget...');
          await invoke('write_auth_token_to_file', { token: session.access_token });
        } else {
          console.warn('⚠️ No auth token found - Swift widget may not work properly');
        }
        
        await invoke('create_native_timer_widget');
        console.log('✅ Native Swift timer widget created successfully!');
        
      } catch (error) {
        console.error('❌ Failed to create native Swift timer widget:', error);
        console.error('❌ Falling back to Tauri widget...');
        
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
  };

  const getUserInitials = () => {
    if (!user?.email) return 'N';
    return user.email.charAt(0).toUpperCase();
  };

  return (
    <div className="app-container flex h-screen bg-white overflow-x-hidden max-w-full w-full border-0">
      {/* Window Drag Region - Midday's minimal top-only approach */}
      <div
        data-tauri-drag-region
        className="tauri-drag-region"
      />
      
      {/* Clean Midday-style Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden border-0 ml-[70px]">
        {/* Top Header - Midday Style */}
        <header className="px-6 h-[70px] flex items-center border-b border-gray-300">
          <div className="flex items-center justify-between w-full">
            {/* Left side - Quick Actions buttons */}
            <div className="flex items-center space-x-3">
              {/* Quick Actions Button - Command Palette */}
              <div>
                <CommandPalette 
                  className="h-9 w-auto px-3 py-2 text-sm text-gray-600 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-0 border border-gray-300 shadow-sm hover:bg-[#F5F5F5] rounded-none"
                  initialOpen={shouldOpenWhoopModal}
                  initialCategory={shouldOpenWhoopModal ? 'whoop' : null}
                />
              </div>

              {/* Tracker Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={openTimeTrackerWindow}
                className="flex items-center gap-2 text-sm text-gray-600 px-3 py-2 h-9 border border-gray-300 shadow-sm hover:bg-[#F5F5F5] focus-visible:outline-none focus-visible:ring-0 rounded-none"
              >
                <span>Tracker</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 border border-gray-300 bg-[#fafaf9] px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>T
                </kbd>
              </Button>
            </div>

            {/* Right side - Feedback button and User dropdown */}
            <div className="flex items-center space-x-3">
              {/* Feedback Button */}
              <button
                onClick={() => setShowFeedback(true)}
                className="px-3.5 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-full hover:bg-[#F5F5F5] transition-colors"
              >
                Feedback
              </button>
              
              <TeamDropdown isExpanded={true} placement="header" />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-white border-0">
          {children}
        </main>
      </div>


      {/* Time Tracker Widget */}
      <TimeTrackerWidget 
        open={false} 
        onClose={() => {}} 
      />

      {/* Feedback Modal */}
      <FeedbackModal 
        isOpen={showFeedback} 
        onClose={() => setShowFeedback(false)} 
      />
    </div>
  );
}
