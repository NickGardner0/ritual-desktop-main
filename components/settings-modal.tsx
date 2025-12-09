'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

export function SettingsModal({ isOpen, onClose, onOpen }: SettingsModalProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [aiDataRetention, setAiDataRetention] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Call onOpen when modal opens to close sidebar
  useEffect(() => {
    if (isOpen && onOpen) {
      onOpen();
    }
  }, [isOpen, onOpen]);
  
  if (!isOpen) return null;

  const userEmail = user?.primaryEmailAddress?.emailAddress || '';
  const userName = user?.username || user?.firstName || userEmail.split('@')[0];
  const userInitial = userEmail.charAt(0).toUpperCase();

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
    router.push('/welcome');
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-[#fafaf8] w-full max-w-lg rounded-none shadow-xl border border-gray-200 z-10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60">
          <button
            onClick={onClose}
            className="p-1 rounded-none transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </button>
          <h2 className="text-base font-normal text-gray-900">Account</h2>
          <div className="w-7" /> {/* Spacer for centering */}
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Avatar */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-lg font-normal">
                {userInitial}
              </div>
              <button 
                onClick={handleManageAccount}
                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded-full border border-gray-200/80 flex items-center justify-center shadow-sm transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* User Info Rows */}
          <div className="space-y-0 border-t border-gray-200/50">
            {/* Username */}
            <button 
              onClick={handleManageAccount}
              className="w-full flex items-center justify-between py-3 border-b border-gray-200/50"
            >
              <span className="text-sm font-normal text-gray-900">Username</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{userName}</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </button>

            {/* Email */}
            <div className="flex items-center justify-between py-3 border-b border-gray-200/50">
              <span className="text-sm font-normal text-gray-900">Email</span>
              <span className="text-sm text-gray-500">{userEmail}</span>
            </div>

            {/* AI Data Retention */}
            <div className="py-3 border-b border-gray-200/50">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-4">
                  <h4 className="text-sm font-normal text-gray-900">AI Data Retention</h4>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    AI Data Retention allows Ritual to use your data to improve AI models. Turn this setting off if you wish to exclude your data from this process.
                  </p>
                </div>
                <button 
                  onClick={() => setAiDataRetention(!aiDataRetention)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
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
            </div>

            {/* Clear History */}
            <button
              onClick={handleClearHistory}
              className="w-full text-left py-3 text-red-500 text-sm font-normal transition-colors"
            >
              Clear history
            </button>
          </div>
        </div>

        {/* Delete Account Section */}
        <div className="px-6 py-3 border-t border-gray-200/50 bg-[#f5f5f3]">
          <button
            onClick={handleDeleteAccount}
            className="flex items-center gap-2 text-red-500 transition-colors"
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-normal">Delete account</span>
          </button>
          <p className="text-xs text-gray-500 mt-0.5">
            For deleting your account permanently
          </p>
        </div>

        {/* Sign Out */}
        <div className="px-6 py-2.5 border-t border-gray-200/50">
          <button
            onClick={handleSignOut}
            className="w-full py-1.5 text-sm font-normal text-gray-700 rounded-none transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-none border border-gray-200 p-6 max-w-sm mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-none bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-base font-normal text-gray-900">Delete Account?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              This action cannot be undone. All your data, habits, and history will be permanently deleted.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2 text-sm font-normal text-gray-700 bg-gray-100 rounded-none transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteAccount}
                className="flex-1 py-2 text-sm font-normal text-white bg-red-600 rounded-none transition-colors"
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
