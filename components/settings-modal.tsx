'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, User, Palette, Globe, Bell, Shield, Database, HelpCircle, LogOut, Upload, Key, MessageSquare, Link, FileText, Settings } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

type SettingsSection = 'general' | 'import' | 'system-prompt' | 'api-keys' | 'ambient-chat' | 'connections' | 'tool-permissions' | 'base-url' | 'documentation';

export function SettingsModal({ isOpen, onClose, onOpen }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  
  // Call onOpen when modal opens to close sidebar
  useEffect(() => {
    if (isOpen && onOpen) {
      onOpen();
    }
  }, [isOpen, onOpen]);
  
  if (!isOpen) return null;

  const navigationItems = [
    {
      id: 'general' as SettingsSection,
      icon: User,
      title: 'General'
    },
    {
      id: 'import' as SettingsSection,
      icon: Upload,
      title: 'Import'
    },
    {
      id: 'system-prompt' as SettingsSection,
      icon: MessageSquare,
      title: 'System Prompt'
    },
    {
      id: 'api-keys' as SettingsSection,
      icon: Key,
      title: 'API Keys'
    },
    {
      id: 'ambient-chat' as SettingsSection,
      icon: MessageSquare,
      title: 'Ambient Chat'
    },
    {
      id: 'connections' as SettingsSection,
      icon: Link,
      title: 'Connections'
    },
    {
      id: 'tool-permissions' as SettingsSection,
      icon: Settings,
      title: 'Tool Permissions'
    },
    {
      id: 'base-url' as SettingsSection,
      icon: Globe,
      title: 'Base URL'
    },
    {
      id: 'documentation' as SettingsSection,
      icon: FileText,
      title: 'Documentation'
    }
  ];

  const renderGeneralContent = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">General</h3>
        <div className="text-sm text-gray-600 mb-6">nickgardner0651@gmail.com</div>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-50 p-4 rounded-none border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-medium text-gray-900">Free Plan</h4>
              <p className="text-sm text-gray-600">10 / 50 free requests</p>
            </div>
            <button className="px-4 py-2 bg-black text-white text-sm rounded-none hover:bg-gray-800 transition-colors">
              Upgrade to Plus
            </button>
          </div>
          <p className="text-sm text-gray-600">
            Upgrade to Plus for access to more models, or bring your own API keys.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
            <select className="w-full p-2 border border-gray-300 rounded-none bg-white text-sm focus:outline-none focus:border-gray-400">
              <option>System</option>
              <option>Light</option>
              <option>Dark</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sans Font</label>
            <select className="w-full p-2 border border-gray-300 rounded-none bg-white text-sm focus:outline-none focus:border-gray-400">
              <option>Geist</option>
              <option>Inter</option>
              <option>Roboto</option>
            </select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-gray-900">Auto-convert long text</h4>
                <p className="text-xs text-gray-500">Automatically convert pasted text longer than 5000 characters to a file attachment</p>
              </div>
              <button className="relative inline-flex h-5 w-9 items-center rounded-full bg-black transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2">
                <span className="inline-block h-3 w-3 transform rounded-full bg-white translate-x-5 transition-transform" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-gray-900">Auto-scrape URLs</h4>
                <p className="text-xs text-gray-500">Automatically scrape and attach content from URLs in your messages</p>
              </div>
              <button className="relative inline-flex h-5 w-9 items-center rounded-full bg-black transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2">
                <span className="inline-block h-3 w-3 transform rounded-full bg-white translate-x-5 transition-transform" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-gray-900">Cautious Enter key</h4>
                <p className="text-xs text-gray-500">Use Cmd+Enter to send messages instead of Enter</p>
              </div>
              <button className="relative inline-flex h-5 w-9 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2">
                <span className="inline-block h-3 w-3 transform rounded-full bg-white translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneralContent();
      case 'import':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Import</h3>
            <p className="text-gray-600">Import settings and data from other sources.</p>
          </div>
        );
      case 'system-prompt':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">System Prompt</h3>
            <p className="text-gray-600">Configure system prompts and AI behavior.</p>
          </div>
        );
      case 'api-keys':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">API Keys</h3>
            <p className="text-gray-600">Manage your API keys and integrations.</p>
          </div>
        );
      case 'ambient-chat':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Ambient Chat</h3>
            <p className="text-gray-600">Configure ambient chat settings.</p>
          </div>
        );
      case 'connections':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Connections</h3>
            <p className="text-gray-600">Manage external connections and integrations.</p>
          </div>
        );
      case 'tool-permissions':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Tool Permissions</h3>
            <p className="text-gray-600">Configure tool access and permissions.</p>
          </div>
        );
      case 'base-url':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Base URL</h3>
            <p className="text-gray-600">Configure base URL settings.</p>
          </div>
        );
      case 'documentation':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Documentation</h3>
            <p className="text-gray-600">Access help and documentation resources.</p>
          </div>
        );
      default:
        return renderGeneralContent();
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-[#f6f6f3]/60 dark:bg-[#121212]/80" 
        onClick={onClose}
      />
      
      {/* Main Modal Container - Extra Tall */}
      <div className="relative bg-white w-[80vw] max-w-4xl h-[75vh] flex shadow-xl border border-gray-300 z-10 transition-all duration-300 rounded-none overflow-hidden">
        
        {/* Side Navigation */}
        <div className="w-48 bg-white border-r border-gray-200 flex-shrink-0">
          
          <nav className="p-2">
            {navigationItems.map((item) => {
              const IconComponent = item.icon;
              const isActive = activeSection === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-none transition-colors ${
                    isActive 
                      ? 'text-gray-900' 
                      : 'text-gray-600 hover:bg-[#F3F3F3] hover:text-gray-900'
                  }`}
                >
                  <IconComponent className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium">{item.title}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col">
          {/* Header with Close Button */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
            <h2 className="text-lg font-semibold text-gray-900">
              Settings
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Area - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            {renderSectionContent()}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
