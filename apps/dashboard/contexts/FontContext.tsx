'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type FontOption = 'fk-grotesk' | 'system-ui';

interface FontContextType {
  font: FontOption;
  setFont: (font: FontOption) => void;
  fontClass: string;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

const FONT_STORAGE_KEY = 'ritual-font-preference';

const fontClasses: Record<FontOption, string> = {
  'fk-grotesk': 'font-sans',
  'system-ui': 'font-system-ui',
};

export function FontProvider({ children }: { children: ReactNode }) {
  const [font, setFontState] = useState<FontOption>(() => {
    if (typeof window === 'undefined') {
      return 'fk-grotesk';
    }

    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (stored === 'geist-sans' || stored === 'neue-haas') {
      localStorage.setItem(FONT_STORAGE_KEY, 'system-ui');
      return 'system-ui';
    }

    if (stored === 'fk-grotesk' || stored === 'system-ui') {
      return stored;
    }

    return 'fk-grotesk';
  });

  // Save font preference to localStorage when it changes
  const setFont = (newFont: FontOption) => {
    setFontState(newFont);
    localStorage.setItem(FONT_STORAGE_KEY, newFont);
  };

  const fontClass = fontClasses[font];

  return (
    <FontContext.Provider value={{ font, setFont, fontClass }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont() {
  const context = useContext(FontContext);
  if (context === undefined) {
    throw new Error('useFont must be used within a FontProvider');
  }
  return context;
}
