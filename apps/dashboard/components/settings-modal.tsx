'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { SettingsFrame } from '@/components/settings-frame';
import { type DesktopSettingsView } from '@/lib/tauri-utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  initialView?: DesktopSettingsView;
}

export function SettingsModal({ isOpen, onClose, onOpen, initialView = 'account' }: SettingsModalProps) {
  const wasOpenRef = useRef(false);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current && onOpen) onOpen();
    wasOpenRef.current = isOpen;
  }, [isOpen, onOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 text-[#2c2c2c]">
      <div
        className="absolute inset-0 bg-[#f1f0ec]/70 backdrop-blur-[3px]"
        onClick={handleClose}
      />
      <SettingsFrame
        initialView={initialView}
        variant="modal"
        onClose={handleClose}
      />
    </div>
  );

  return createPortal(modalContent, document.body);
}
