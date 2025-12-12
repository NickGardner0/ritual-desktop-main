'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FontOption = 'fk-grotesk' | 'geist-sans';

interface FontContextType {
  font: FontOption;
  setFont: (font: FontOption) => void;
  fontClass: string;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

const FONT_STORAGE_KEY = 'ritual-font-preference';

const fontClasses: Record<FontOption, string> = {
  'fk-grotesk': 'font-sans',
  'geist-sans': 'font-geist',
};

export function FontProvider({ children }: { children: ReactNode }) {
  const [font, setFontState] = useState<FontOption>('fk-grotesk');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load font preference from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (stored === 'fk-grotesk' || stored === 'geist-sans') {
      setFontState(stored);
    }
    setIsLoaded(true);
  }, []);

  // Save font preference to localStorage when it changes
  const setFont = (newFont: FontOption) => {
    setFontState(newFont);
    localStorage.setItem(FONT_STORAGE_KEY, newFont);
  };

  const fontClass = fontClasses[font];

  // Prevent flash of wrong font by not rendering until loaded
  if (!isLoaded) {
    return null;
  }

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
