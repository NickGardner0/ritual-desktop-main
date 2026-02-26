'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, X, ChevronDown, Monitor, Type, Database, Trash2, LogOut, Watch, Video, Mic, Check } from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useFont, FontOption } from '@/contexts/FontContext';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleHealthSyncStatus } from './apple-health-sync-status';
import { RecorderSettings } from './screen-recorder';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

const fontOptions: { value: FontOption; label: string }[] = [
  { value: 'fk-grotesk', label: 'FK Grotesk Neue' },
  { value: 'geist-sans', label: 'Geist Sans' },
];

export function SettingsModal({ isOpen, onClose, onOpen }: SettingsModalProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [currentView, setCurrentView] = useState<'account' | 'computer-tracking' | 'apple-health' | 'screen-recording' | 'voice-logging'>('account');
  const wasOpenRef = useRef(false);

  // Call onOpen when modal opens to close sidebar
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) {
      onOpen();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  const handleClose = () => {
    setCurrentView('account');
    onClose();
  };
  
  if (!isOpen) return null;

  // Computer Tracking View
  if (currentView === 'computer-tracking') {
    const modalContent = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop - beige overlay */}
        <div 
          className="absolute inset-0 bg-[#e8e5df]/70" 
          onClick={handleClose}
        />
        
        {/* Modal */}
        <div className="relative bg-white w-full max-w-[440px] border border-gray-300 z-10 overflow-hidden max-h-[700px] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60 bg-white">
            <button
              onClick={() => setCurrentView('account')}
              className="p-0.5 transition-colors hover:bg-gray-100"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-sm font-medium text-gray-900">Computer Tracking</h2>
            <div className="w-6" />
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <ComputerTrackingSettings 
              userId={user?.id || ''} 
              onClose={() => setCurrentView('account')}
            />
          </div>
        </div>
      </div>
    );
    return createPortal(modalContent, document.body);
  }

  // Screen Recording View
  if (currentView === 'screen-recording') {
    const modalContent = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop - beige overlay */}
        <div 
          className="absolute inset-0 bg-[#e8e5df]/70" 
          onClick={handleClose}
        />
        
        {/* Modal */}
        <div className="relative bg-white w-full max-w-[440px] border border-gray-300 z-10 overflow-hidden max-h-[700px] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60 bg-white">
            <button
              onClick={() => setCurrentView('account')}
              className="p-0.5 transition-colors hover:bg-gray-100"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-sm font-medium text-gray-900">Screen Recording</h2>
            <div className="w-6" />
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            <RecorderSettings 
              userId={user?.id || ''} 
              deviceId={typeof window !== 'undefined' ? `${navigator.userAgent.slice(0, 20)}-${user?.id?.slice(0, 8)}` : ''} 
              onClose={() => setCurrentView('account')}
            />
          </div>
        </div>
      </div>
    );
    return createPortal(modalContent, document.body);
  }

  // Voice Logging View
  if (currentView === 'voice-logging') {
    return <VoiceLoggingSettings onBack={() => setCurrentView('account')} onClose={handleClose} />;
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
        <div className="relative bg-white w-full max-w-[440px] border border-gray-300 z-10 overflow-hidden max-h-[700px] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60 bg-white">
            <button
              onClick={() => setCurrentView('account')}
              className="p-0.5 transition-colors hover:bg-gray-100"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-sm font-medium text-gray-900">Apple Health Sync</h2>
            <div className="w-6" />
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-5">
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
    // Open Clerk's user profile management
    if (user) {
      window.open('https://accounts.clerk.dev/user', '_blank');
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
      <div className="relative bg-white w-full max-w-[440px] border border-gray-300 z-10 overflow-hidden max-h-[700px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200/60">
          <button
            onClick={handleClose}
            className="p-0.5 transition-colors hover:bg-gray-100"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-sm font-medium text-gray-900">Settings</h2>
          <div className="w-6" />
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Profile Section */}
          <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-200/50">
            <div className="w-11 h-11 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-base font-medium flex-shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
              <button 
                onClick={handleManageAccount}
                className="text-xs text-[#4B9EAA] hover:underline"
              >
                Manage Account
              </button>
            </div>
          </div>

          {/* Settings Items */}
          <div className="px-5">
            {/* AI Data Retention */}
            <div className="py-3.5 flex items-center justify-between border-b border-gray-200/50">
              <div className="flex items-center gap-2.5">
                <Database className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">AI Data Retention</span>
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
            <div className="py-3.5 flex items-center justify-between border-b border-gray-200/50">
              <div className="flex items-center gap-2.5">
                <Type className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">App Font</span>
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowFontDropdown(!showFontDropdown)}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                >
                  <span className={font === 'geist-sans' ? 'font-geist' : ''}>
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
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 shadow-lg z-20 min-w-[140px] py-1">
                      {fontOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setFont(option.value);
                            setShowFontDropdown(false);
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 flex items-center justify-between ${
                            font === option.value ? 'text-gray-900' : 'text-gray-600'
                          } ${option.value === 'geist-sans' ? 'font-geist' : ''}`}
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

            {/* Computer Tracking */}
            <button 
              onClick={() => setCurrentView('computer-tracking')}
              className="w-full py-3.5 flex items-center justify-between border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Monitor className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">Computer Tracking</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Screen Recording */}
            <button 
              onClick={() => setCurrentView('screen-recording')}
              className="w-full py-3.5 flex items-center justify-between border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Video className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">Screen Recording</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Voice Logging */}
            <button 
              onClick={() => setCurrentView('voice-logging')}
              className="w-full py-3.5 flex items-center justify-between border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Mic className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">Voice Logging</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Apple Health Sync */}
            <button 
              onClick={() => setCurrentView('apple-health')}
              className="w-full py-3.5 flex items-center justify-between border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Watch className="w-4 h-4 text-gray-500" />
                <span className="text-sm text-gray-900">Apple Health Sync</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>

            {/* Clear History */}
            <button
              onClick={handleClearHistory}
              className="w-full py-3.5 flex items-center gap-2.5 border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <Trash2 className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-900">Clear History</span>
            </button>

            {/* Delete Account */}
            <button
              onClick={handleDeleteAccount}
              className="w-full py-3.5 flex items-center gap-2.5 border-b border-gray-200/50 hover:bg-gray-50/50 transition-colors"
            >
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-500">Delete Account</span>
            </button>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              className="w-full py-3.5 flex items-center gap-2.5 hover:bg-gray-50/50 transition-colors"
            >
              <LogOut className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-900">Sign Out</span>
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

// MARK: - Voice Logging Settings Sub-View

const HOTKEY_OPTIONS = [
  { value: 'cmd_shift_l', label: '⌘⇧L', description: 'Command + Shift + L' },
  { value: 'cmd_shift_v', label: '⌘⇧V', description: 'Command + Shift + V' },
  { value: 'cmd_shift_m', label: '⌘⇧M', description: 'Command + Shift + M' },
] as const;

function VoiceLoggingSettings({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [selectedHotkey, setSelectedHotkey] = useState('cmd_shift_l');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadHotkey = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const current = await invoke<string>('get_voice_hotkey');
      setSelectedHotkey(current);
    } catch {
      // Not in Tauri context or command failed — use default
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHotkey(); }, [loadHotkey]);

  const handleSelect = async (value: string) => {
    if (value === selectedHotkey) return;
    setSaving(true);
    setSelectedHotkey(value);
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('set_voice_hotkey', { hotkey: value });
    } catch (e) {
      console.error('Failed to save voice hotkey:', e);
    } finally {
      setSaving(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#e8e5df]/70" onClick={onClose} />

      <div className="relative bg-white w-full max-w-[440px] border border-gray-300 z-10 overflow-hidden max-h-[700px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60 bg-white">
          <button onClick={onBack} className="p-0.5 transition-colors hover:bg-gray-100">
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-sm font-medium text-gray-900">Voice Logging</h2>
          <div className="w-6" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-gray-500 mb-4">
            Choose the keyboard shortcut to toggle voice logging in the notch widget. Press once to start listening, press again to stop and log.
          </p>

          {loading ? (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {HOTKEY_OPTIONS.map((option) => {
                const isSelected = selectedHotkey === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    disabled={saving}
                    className={`w-full flex items-center justify-between px-4 py-3 border transition-colors ${
                      isSelected
                        ? 'border-black bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                    } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base font-mono font-medium text-gray-900 w-12 text-left">
                        {option.label}
                      </span>
                      <span className="text-sm text-gray-500">{option.description}</span>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-black" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-5 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <h4 className="text-sm font-medium text-gray-900 mb-1">How it works</h4>
            <p className="text-xs text-gray-500 leading-relaxed">
              Press the shortcut to open the notch voice listener. Speak your habit log 
              (e.g. &quot;200mg of caffeine&quot;), then press the shortcut again to stop 
              and confirm. The habit will be matched and logged automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
