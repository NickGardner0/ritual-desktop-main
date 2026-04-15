'use client';

import React, { startTransition, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  User2,
  Monitor,
  Watch,
  X,
  ChevronDown,
  AlertTriangle,
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

  useEffect(() => {
    if (isOpen && initialView) {
      startTransition(() => setActiveTab(initialView));
    }
  }, [isOpen, initialView]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) onOpen();
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled =
      email.includes('nickgardner') ||
      window.localStorage.getItem('ritual-show-retrieval-health') === '1';
    setShowRetrievalHealth(enabled);
  }, [user]);

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

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative flex h-[min(540px,calc(100vh-3rem))] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-[#FCFCFB] shadow-[0_24px_64px_rgba(0,0,0,0.08)] z-10">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200/60 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-gray-900">Settings</h2>
          <button onClick={handleClose} className="rounded-lg p-1.5 transition-colors hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar nav */}
          <nav className="w-44 flex-shrink-0 border-r border-gray-200/60 bg-[#F8F8F7] px-2.5 py-3 overflow-y-auto">
            <div className="flex flex-col gap-0.5">
              {TAB_ORDER.map((id) => {
                const { label, icon: Icon } = TABS[id];
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-left transition-colors',
                      'hover:bg-gray-200/50',
                      activeTab === id
                        ? 'bg-gray-200/60 text-gray-900 font-medium'
                        : 'text-gray-500',
                    )}
                  >
                    <Icon className="h-[15px] w-[15px] flex-shrink-0" />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-y-auto">
            {/* ============================================================ */}
            {/* General tab                                                   */}
            {/* ============================================================ */}
            {activeTab === 'account' && (
              <div className="p-5 space-y-5">
                {/* Profile */}
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6366F1] text-[13px] font-medium text-white flex-shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
                    <button
                      onClick={handleManageAccount}
                      className="text-[13px] text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Manage account
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Preferences */}
                <div className="space-y-1">
                  {/* AI Data Retention */}
                  <div className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-[13px] font-medium text-gray-900">AI data retention</p>
                      <p className="text-[13px] text-gray-500">Let Ritual save and use memories when answering.</p>
                    </div>
                    <Toggle checked={aiDataRetention} onChange={() => setAiDataRetention(!aiDataRetention)} />
                  </div>

                  {/* App Font */}
                  <div className="flex items-center justify-between py-2.5">
                    <p className="text-[13px] font-medium text-gray-900">App font</p>
                    <div className="relative">
                      <button
                        onClick={() => { setShowFontDropdown(!showFontDropdown); setShowSidebarDropdown(false); }}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                          {fontOptions.find((f) => f.value === font)?.label}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                      {showFontDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowFontDropdown(false)} />
                          <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {fontOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => { setFont(option.value); setShowFontDropdown(false); }}
                                className={cn(
                                  'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left transition-colors hover:bg-gray-50',
                                  font === option.value ? 'text-gray-900 font-medium' : 'text-gray-600',
                                  option.value === 'system-ui' && 'font-system-ui',
                                )}
                              >
                                {option.label}
                                {font === option.value && <span className="text-[13px] text-gray-900">✓</span>}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sidebar Mode */}
                  <div className="flex items-center justify-between py-2.5">
                    <p className="text-[13px] font-medium text-gray-900">Sidebar</p>
                    <div className="relative">
                      <button
                        onClick={() => { setShowSidebarDropdown(!showSidebarDropdown); setShowFontDropdown(false); }}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <span>{sidebarModeOptions.find((o) => o.value === sidebarMode)?.label}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                      {showSidebarDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowSidebarDropdown(false)} />
                          <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                            {sidebarModeOptions.map((option) => (
                              <button
                                key={option.value}
                                onClick={() => { setSidebarMode(option.value); setShowSidebarDropdown(false); }}
                                className={cn(
                                  'flex w-full items-center justify-between px-3 py-2 text-[13px] text-left transition-colors hover:bg-gray-50',
                                  sidebarMode === option.value ? 'text-gray-900 font-medium' : 'text-gray-600',
                                )}
                              >
                                {option.label}
                                {sidebarMode === option.value && <span className="text-[13px] text-gray-900">✓</span>}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100" />

                {/* Account actions */}
                <div className="space-y-1">
                  <button
                    onClick={handleClearHistory}
                    className="flex w-full items-center py-2.5 text-[13px] text-gray-700 transition-colors hover:text-gray-900"
                  >
                    Clear history
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center py-2.5 text-[13px] text-gray-700 transition-colors hover:text-gray-900"
                  >
                    Sign out
                  </button>

                  <button
                    onClick={handleDeleteAccount}
                    className="flex w-full items-center py-2.5 text-[13px] text-red-500 transition-colors hover:text-red-600"
                  >
                    Delete account
                  </button>
                </div>
              </div>
            )}

            {/* Computer Use tab */}
            {activeTab === 'computer-tracking' && (
              <div className="p-5">
                <ComputerTrackingSettings
                  userId={user?.id || ''}
                  showRetrievalHealth={showRetrievalHealth}
                  onClose={() => setActiveTab('account')}
                />
              </div>
            )}

            {/* Apple Watch tab */}
            {activeTab === 'apple-health' && (
              <div className="p-5">
                <AppleWatchSettings />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px]" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative mx-4 max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
            <h3 className="text-base font-semibold text-gray-900">Delete account?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 rounded-lg bg-red-500 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-600"
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
// Shared toggle component
// ---------------------------------------------------------------------------

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-gray-900' : 'bg-gray-200',
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
