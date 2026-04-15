'use client';

import React, { startTransition, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  User2,
  Monitor,
  Watch,
  X,
  Type,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Database,
  Trash2,
  LogOut,
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useFont, FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleWatchSettings } from './apple-watch-settings';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type SettingsTabId = 'account' | 'computer-tracking' | 'apple-health';

// Keep external interface compatible
type SettingsView = SettingsTabId;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  initialView?: SettingsView;
}

interface TabConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Record<SettingsTabId, TabConfig> = {
  account: { label: 'General', icon: User2 },
  'computer-tracking': { label: 'Computer Use', icon: Monitor },
  'apple-health': { label: 'Apple Watch', icon: Watch },
};

const TAB_ORDER: SettingsTabId[] = ['account', 'computer-tracking', 'apple-health'];

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'geist-sans', label: 'Geist Sans' },
  { value: 'system-ui', label: 'System UI' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'hover', label: 'Expand on Hover' },
  { value: 'expanded', label: 'Always Expanded' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsModal({ isOpen, onClose, onOpen, initialView }: SettingsModalProps) {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebarMode();

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialView ?? 'account');
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [showRetrievalHealth, setShowRetrievalHealth] = useState(false);
  const wasOpenRef = useRef(false);

  // Sync tab when opening with initialView
  useEffect(() => {
    if (isOpen && initialView) {
      startTransition(() => setActiveTab(initialView));
    }
  }, [isOpen, initialView]);

  // Call onOpen when modal first opens (closes sidebar)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) onOpen();
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  // Dev-only retrieval health flag
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled =
      email.includes('nickgardner') ||
      window.localStorage.getItem('ritual-show-retrieval-health') === '1';
    setShowRetrievalHealth(enabled);
  }, [user]);

  // Close dropdowns when switching tabs
  useEffect(() => {
    setShowFontDropdown(false);
    setShowSidebarDropdown(false);
  }, [activeTab]);

  const handleClose = () => {
    setActiveTab('account');
    setShowDeleteConfirm(false);
    onClose();
  };

  if (!isOpen) return null;

  // ---------- derived user info ----------
  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0];
  const userInitial = (userName || userEmail).charAt(0).toUpperCase();

  const handleManageAccount = () => {
    if (user) openUserProfile();
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const handleDeleteAccount = () => setShowDeleteConfirm(true);

  const confirmDeleteAccount = async () => {
    console.log('Account deletion confirmed');
    setShowDeleteConfirm(false);
  };

  const handleClearHistory = () => {
    console.log('Clear history clicked');
  };

  // ---------- render ----------
  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#e8e5df]/70" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative bg-[#FCFCFB] w-full max-w-[720px] border border-gray-200/90 shadow-[0_16px_48px_rgba(15,23,42,0.08)] rounded-xl z-10 overflow-hidden h-[min(520px,calc(100vh-3rem))] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200/70 bg-[#FCFCFB] flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900">Settings</h2>
          <button onClick={handleClose} className="p-1 rounded-sm transition-colors hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar nav */}
          <nav className="w-44 flex-shrink-0 border-r border-gray-200/70 bg-[#F8F8F7] py-2 px-2 overflow-y-auto">
            <div className="flex flex-col gap-0.5">
              {TAB_ORDER.map((id) => {
                const { label, icon: Icon } = TABS[id];
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-[7px] text-[13px] text-left rounded-md transition-colors',
                      'hover:bg-gray-200/50',
                      activeTab === id
                        ? 'bg-gray-200/60 text-gray-900 font-medium'
                        : 'text-gray-500',
                    )}
                  >
                    <Icon className="w-[15px] h-[15px] flex-shrink-0" />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto">
            {/* General tab */}
            {activeTab === 'account' && (
              <div className="p-4 space-y-0">
                {/* Profile */}
                <div className="pb-3 mb-0 flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-[13px] font-medium flex-shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
                    <button
                      onClick={handleManageAccount}
                      className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Manage Account
                    </button>
                  </div>
                </div>

                {/* AI Data Retention */}
                <SettingsRow label="AI Data Retention" icon={<Database className="w-4 h-4 text-gray-500" />}>
                  <button
                    onClick={() => setAiDataRetention(!aiDataRetention)}
                    className={cn(
                      'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
                      aiDataRetention ? 'bg-black' : 'bg-gray-300',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        aiDataRetention ? 'translate-x-[18px]' : 'translate-x-1',
                      )}
                    />
                  </button>
                </SettingsRow>

                {/* App Font */}
                <SettingsRow label="App Font" icon={<Type className="w-4 h-4 text-gray-500" />}>
                  <div className="relative">
                    <button
                      onClick={() => setShowFontDropdown(!showFontDropdown)}
                      className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                        {fontOptions.find((f) => f.value === font)?.label}
                      </span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    {showFontDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowFontDropdown(false)} />
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg rounded-lg z-20 min-w-[170px] py-1">
                          {fontOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setFont(option.value);
                                setShowFontDropdown(false);
                              }}
                              className={cn(
                                'w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 flex items-center justify-between',
                                font === option.value ? 'text-gray-900' : 'text-gray-600',
                                option.value === 'system-ui' && 'font-system-ui',
                              )}
                            >
                              {option.label}
                              {font === option.value && <span className="text-black text-xs">✓</span>}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </SettingsRow>

                {/* Sidebar */}
                <SettingsRow
                  label="Sidebar"
                  icon={
                    <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                  }
                >
                  <div className="relative">
                    <button
                      onClick={() => setShowSidebarDropdown(!showSidebarDropdown)}
                      className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      <span>{sidebarModeOptions.find((o) => o.value === sidebarMode)?.label}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    {showSidebarDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowSidebarDropdown(false)} />
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg rounded-lg z-20 min-w-[170px] py-1">
                          {sidebarModeOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSidebarMode(option.value);
                                setShowSidebarDropdown(false);
                              }}
                              className={cn(
                                'w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 flex items-center justify-between',
                                sidebarMode === option.value ? 'text-gray-900' : 'text-gray-600',
                              )}
                            >
                              {option.label}
                              {sidebarMode === option.value && <span className="text-black text-xs">✓</span>}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </SettingsRow>

                {/* Clear History */}
                <SettingsActionRow
                  label="Clear History"
                  icon={<Trash2 className="w-4 h-4 text-gray-500" />}
                  onClick={handleClearHistory}
                />

                {/* Delete Account */}
                <SettingsActionRow
                  label="Delete Account"
                  icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
                  onClick={handleDeleteAccount}
                  destructive
                />

                {/* Sign Out */}
                <SettingsActionRow
                  label="Sign Out"
                  icon={<LogOut className="w-4 h-4 text-gray-500" />}
                  onClick={handleSignOut}
                  last
                />
              </div>
            )}

            {/* Computer Use tab */}
            {activeTab === 'computer-tracking' && (
              <div className="p-4">
                <ComputerTrackingSettings
                  userId={user?.id || ''}
                  showRetrievalHealth={showRetrievalHealth}
                  onClose={() => setActiveTab('account')}
                />
              </div>
            )}

            {/* Apple Watch tab */}
            {activeTab === 'apple-health' && (
              <div className="p-4">
                <AppleWatchSettings />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="absolute inset-0 bg-[#f6f6f3]/80" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white border border-gray-300 p-5 max-w-xs mx-4 rounded-lg">
            <h3 className="text-base font-medium text-gray-900 mb-2">Delete Account?</h3>
            <p className="text-sm text-gray-500 mb-4">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}

// ---------------------------------------------------------------------------
// Helpers – small row components to reduce JSX repetition
// ---------------------------------------------------------------------------

function SettingsRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm font-normal text-gray-900">{label}</span>
      </div>
      {children}
    </div>
  );
}

function SettingsActionRow({
  label,
  icon,
  onClick,
  destructive,
  last,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full py-3 flex items-center gap-2.5 hover:bg-gray-50/40 transition-colors',
        '',
      )}
    >
      {icon}
      <span className={cn('text-sm font-normal', destructive ? 'text-red-500' : 'text-gray-900')}>
        {label}
      </span>
    </button>
  );
}
