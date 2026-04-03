'use client';

import React, { startTransition, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, X, ChevronDown, Monitor, Type, Database, Trash2, LogOut, Watch } from 'lucide-react';
import { useUser, useClerk, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useFont, FontOption } from '@/contexts/FontContext';
import { ComputerTrackingSettings } from './computer-tracking-settings';
import { AppleHealthSyncStatus } from './apple-health-sync-status';

type SettingsView = 'account' | 'computer-tracking' | 'apple-health';
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

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

const SETTINGS_PANEL_CLASS =
  'relative bg-[#FCFCFB] w-full max-w-[520px] border border-gray-200/90 shadow-[0_16px_48px_rgba(15,23,42,0.08)] rounded-xl z-10 overflow-hidden max-h-[min(560px,calc(100vh-2rem))] flex flex-col';
const SETTINGS_HEADER_CLASS =
  'flex items-center justify-between pl-2.5 pr-4 py-2.5 border-b border-gray-200/70 bg-[#FCFCFB]';
const SETTINGS_HEADER_BUTTON_CLASS = 'p-1 rounded-sm transition-colors';

export function SettingsModal({ isOpen, onClose, onOpen, initialView }: SettingsModalProps) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut, openUserProfile } = useClerk();
  const router = useRouter();
  const { font, setFont } = useFont();
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [currentView, setCurrentView] = useState<SettingsView>('account');
  const [showRetrievalHealth, setShowRetrievalHealth] = useState(false);
  const [retrievalHealth, setRetrievalHealth] = useState<any>(null);
  const [retrievalHealthLoading, setRetrievalHealthLoading] = useState(false);
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

  useEffect(() => {
    if (!isOpen || !showRetrievalHealth) return;
    let cancelled = false;

    const loadDiagnostics = async () => {
      setRetrievalHealthLoading(true);
      try {
        const token = await getToken();
        const response = await fetch(`${PYTHON_API_BASE}/api/memory/diagnostics`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`Diagnostics failed: ${response.status}`);
        const payload = await response.json();
        if (!cancelled) {
          setRetrievalHealth(payload?.retrieval_health || null);
        }
      } catch (error) {
        console.error('Failed to load retrieval health:', error);
        if (!cancelled) setRetrievalHealth(null);
      } finally {
        if (!cancelled) setRetrievalHealthLoading(false);
      }
    };

    loadDiagnostics();
    return () => { cancelled = true; };
  }, [getToken, isOpen, showRetrievalHealth]);

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

            {showRetrievalHealth && (
              <div className="py-3 border-t border-gray-200/60">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <Database className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-900">Retrieval Health</span>
                  </div>
                  <div className={`text-[11px] px-2 py-1 rounded-full border ${
                    retrievalHealth?.summary?.overall_status === 'Healthy'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : retrievalHealth?.summary?.overall_status === 'Catching up'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : retrievalHealth?.summary?.overall_status === 'Degraded but usable'
                          ? 'border-orange-200 bg-orange-50 text-orange-700'
                          : 'border-red-200 bg-red-50 text-red-700'
                  }`}>
                    {retrievalHealthLoading ? 'Loading…' : (retrievalHealth?.summary?.overall_status || 'Unavailable')}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-2">
                  <RetrievalHealthRow
                    label="Latest context capture"
                    value={formatDebugTimestamp(retrievalHealth?.latest_context_snapshots_ts)}
                  />
                  <RetrievalHealthRow
                    label="Latest session doc"
                    value={formatDebugTimestamp(retrievalHealth?.latest_session_retrieval_docs_ts)}
                  />
                  <RetrievalHealthRow
                    label="Latest cloud chunk"
                    value={formatDebugTimestamp(retrievalHealth?.cloud_embedding_freshness?.latest_cloud_chunk_ts)}
                  />
                  <RetrievalHealthRow
                    label="Outbox backlog"
                    value={String(retrievalHealth?.memory_upload_outbox?.pending ?? 0)}
                  />
                  <RetrievalHealthRow
                    label="Cloud embedded docs"
                    value={`${String(retrievalHealth?.cloud_index?.current_user_embedded_chunk_count ?? 0)} / ${String(retrievalHealth?.cloud_index?.current_user_chunk_count ?? 0)}`}
                  />
                  <RetrievalHealthRow
                    label="Primary source"
                    value={String(retrievalHealth?.summary?.primary_source_selected || 'unknown')}
                  />
                  <RetrievalHealthRow
                    label="Fail-open mode"
                    value={retrievalHealth?.lane_readiness?.semantic_ready ? 'Cloud primary' : 'Cloud degraded'}
                  />
                  {Array.isArray(retrievalHealth?.summary?.degradation_reasons) && retrievalHealth.summary.degradation_reasons.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Degradation reasons</div>
                      <div className="flex flex-wrap gap-1">
                        {retrievalHealth.summary.degradation_reasons.map((reason: string) => (
                          <span key={reason} className="text-[11px] px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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

function formatDebugTimestamp(value: unknown): string {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 'Unavailable';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function RetrievalHealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  );
}
