'use client';

import React, { startTransition, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, X, ChevronDown, Monitor, Type, Trash2, LogOut, Watch, Database } from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useFont, FontOption } from '@/contexts/FontContext';
import { useSidebarMode, type SidebarMode } from '@/contexts/SidebarModeContext';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleHealthSyncStatus } from './apple-health-sync-status';

type SettingsView = 'account' | 'computer-tracking' | 'apple-health';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  initialView?: SettingsView;
}

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'system-ui', label: 'System UI' },
];

const sidebarModeOptions: { value: SidebarMode; label: string }[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'compact', label: 'Compact' },
  { value: 'hover', label: 'Expand on Hover' },
  { value: 'expanded', label: 'Always Expanded' },
];

const SETTINGS_PANEL_CLASS =
  'relative bg-[#FCFCFB] w-full max-w-[520px] border border-gray-200/90 shadow-[0_16px_48px_rgba(15,23,42,0.08)] rounded-xl z-10 overflow-hidden max-h-[min(560px,calc(100vh-2rem))] flex flex-col';
const SETTINGS_HEADER_CLASS =
  'flex items-center justify-between pl-2.5 pr-4 py-2.5 border-b border-gray-200/70 bg-[#FCFCFB]';
const SETTINGS_HEADER_BUTTON_CLASS = 'p-1 rounded-sm transition-colors';

export function SettingsModal({ isOpen, onClose, onOpen, initialView }: SettingsModalProps) {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const { mode: sidebarMode, setMode: setSidebarMode } = useSidebarMode();
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showSidebarDropdown, setShowSidebarDropdown] = useState(false);
  const [currentView, setCurrentView] = useState<SettingsView>('account');
  const [showRetrievalHealth, setShowRetrievalHealth] = useState(false);
  const wasOpenRef = useRef(false);

  // When opening with initialView, switch to that view
  useEffect(() => {
    if (isOpen && initialView) {
      startTransition(() => {
        setCurrentView(initialView);
      });
    }
  }, [isOpen, initialView]);

  // Call onOpen when modal opens to close sidebar
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) {
      onOpen();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const enabled = (
      email.includes('nickgardner')
      || window.localStorage.getItem('ritual-show-retrieval-health') === '1'
    );
    setShowRetrievalHealth(enabled);
  }, [user]);

  const handleClose = () => {
    setCurrentView('account');
    onClose();
  };
  
  if (!isOpen) return null;

  // Computer Use View
  if (currentView === 'computer-tracking') {
    const modalContent = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop - beige overlay */}
        <div 
          className="absolute inset-0 bg-[#e8e5df]/70" 
          onClick={handleClose}
        />
        
        {/* Modal */}
        <div className={SETTINGS_PANEL_CLASS}>
          {/* Header */}
          <div className={SETTINGS_HEADER_CLASS}>
            <button
              onClick={() => setCurrentView('account')}
              className={SETTINGS_HEADER_BUTTON_CLASS}
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-[15px] font-semibold text-gray-900">Computer Use</h2>
            <div className="w-6" />
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto px-3 py-1.5">
            <ComputerTrackingSettings 
              userId={user?.id || ''} 
              showRetrievalHealth={showRetrievalHealth}
              onClose={() => setCurrentView('account')}
            />
          </div>
        </div>
      </div>
    );
    return createPortal(modalContent, document.body);
  }

  // Apple Health View
  if (currentView === 'apple-health') {
    const modalContent = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop - beige overlay */}
        <div 
          className="absolute inset-0 bg-[#e8e5df]/70" 
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className={SETTINGS_PANEL_CLASS}>
          {/* Header */}
          <div className={SETTINGS_HEADER_CLASS}>
            <button
              onClick={() => setCurrentView('account')}
              className={SETTINGS_HEADER_BUTTON_CLASS}
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-[15px] font-semibold text-gray-900">Apple Health Sync</h2>
            <div className="w-6" />
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-4">
            <AppleHealthSyncStatus showDevices={true} />
            
            {/* Help text */}
            <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-1">How it works</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Install the Ritual Companion app on your iPhone to sync Apple Watch data. 
                The app syncs automatically in the background when new health data is recorded.
              </p>
            </div>
            
            {/* Troubleshooting */}
            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <h4 className="text-sm font-medium text-gray-900 mb-1">Troubleshooting</h4>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>• Make sure the Companion app has Health permissions enabled</li>
                <li>• Check that background app refresh is enabled for Ritual</li>
                <li>• Try opening the Companion app to trigger a manual sync</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
    return createPortal(modalContent, document.body);
  }

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0];
  const userInitial = (userName || userEmail).charAt(0).toUpperCase();

  const handleClearHistory = () => {
    // TODO: Implement clear history functionality
    console.log('Clear history clicked');
  };

  const handleDeleteAccount = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAccount = async () => {
    // TODO: Implement account deletion
    console.log('Account deletion confirmed');
    setShowDeleteConfirm(false);
  };

  const handleManageAccount = () => {
    // Open Clerk's user profile management for the active instance/domain.
    if (user) {
      openUserProfile();
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - beige overlay */}
      <div 
        className="absolute inset-0 bg-[#e8e5df]/70" 
        onClick={handleClose}
      />
      
      {/* Modal - Compact and scrollable like Perplexity */}
      <div className={SETTINGS_PANEL_CLASS}>
        {/* Header */}
        <div className={SETTINGS_HEADER_CLASS}>
          <button
            onClick={handleClose}
            className={SETTINGS_HEADER_BUTTON_CLASS}
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
          <h2 className="text-[15px] font-semibold text-gray-900">Settings</h2>
          <div className="w-6" />
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Profile Section */}
          <div className="px-4 py-3 flex items-center gap-2.5 border-b border-gray-200/60">
            <div className="w-10 h-10 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
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

          {/* Settings Items */}
          <div className="px-4">
            {/* AI Data Retention */}
            <div className="py-3 flex items-center justify-between border-b border-gray-200/60">
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-normal text-gray-900">AI Data Retention</span>
              </div>
              <button
                onClick={() => setAiDataRetention(!aiDataRetention)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                  aiDataRetention ? 'bg-black' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    aiDataRetention ? 'translate-x-[18px]' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* App Font */}
            <div className="py-3 flex items-center justify-between border-b border-gray-200/60">
              <div className="flex items-center gap-2.5">
                <Type className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-normal text-gray-900">App Font</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowFontDropdown(!showFontDropdown)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <span className={font === 'system-ui' ? 'font-system-ui' : ''}>
                    {fontOptions.find(f => f.value === font)?.label}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </button>
                {showFontDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowFontDropdown(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg rounded-lg z-20 min-w-[170px] py-1">
                      {fontOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setFont(option.value);
                            setShowFontDropdown(false);
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 flex items-center justify-between ${
                            font === option.value ? 'text-gray-900' : 'text-gray-600'
                          } ${option.value === 'system-ui' ? 'font-system-ui' : ''}`}
                        >
                          {option.label}
                          {font === option.value && (
                            <span className="text-black text-xs">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Sidebar Mode */}
            <div className="py-3 flex items-center justify-between border-b border-gray-200/60">
              <div className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
                <span className="text-sm font-normal text-gray-900">Sidebar</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowSidebarDropdown(!showSidebarDropdown)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <span>
                    {sidebarModeOptions.find(o => o.value === sidebarMode)?.label}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </button>
                {showSidebarDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowSidebarDropdown(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg rounded-lg z-20 min-w-[170px] py-1">
                      {sidebarModeOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSidebarMode(option.value);
                            setShowSidebarDropdown(false);
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 flex items-center justify-between ${
                            sidebarMode === option.value ? 'text-gray-900' : 'text-gray-600'
                          }`}
                        >
                          {option.label}
                          {sidebarMode === option.value && (
                            <span className="text-black text-xs">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Computer Use */}
            <button
              onClick={() => setCurrentView('computer-tracking')}
              className="w-full py-3 flex items-center justify-between border-b border-gray-200/60 hover:bg-gray-50/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Monitor className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-normal text-gray-900">Computer Use</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Apple Health Sync */}
            <button
              onClick={() => setCurrentView('apple-health')}
              className="w-full py-3 flex items-center justify-between border-b border-gray-200/60 hover:bg-gray-50/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Watch className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-normal text-gray-900">Apple Health Sync</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Clear History */}
            <button
              onClick={handleClearHistory}
              className="w-full py-3 flex items-center gap-2.5 border-b border-gray-200/60 hover:bg-gray-50/40 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-normal text-gray-900">Clear History</span>
            </button>

            {/* Delete Account */}
            <button
              onClick={handleDeleteAccount}
              className="w-full py-3 flex items-center gap-2.5 border-b border-gray-200/60 hover:bg-gray-50/40 transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-normal text-red-500">Delete Account</span>
            </button>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              className="w-full py-3 flex items-center gap-2.5 hover:bg-gray-50/40 transition-colors"
            >
              <LogOut className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-normal text-gray-900">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="absolute inset-0 bg-[#f6f6f3]/80" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white border border-gray-300 p-5 max-w-xs mx-4">
            <h3 className="text-base font-medium text-gray-900 mb-2">Delete Account?</h3>
            <p className="text-sm text-gray-500 mb-4">
              This action cannot be undone. All your data will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 py-2 text-sm text-white bg-red-500 hover:bg-red-600 transition-colors"
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
