'use client';

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type FontOption = 'fk-grotesk' | 'gt-standard' | 'gt-america' | 'geist-sans';

interface FontContextType {
  font: FontOption;
  setFont: (font: FontOption) => void;
  fontClass: string;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

const FONT_STORAGE_KEY = 'ritual-font-preference';

const fontClasses: Record<FontOption, string> = {
  'fk-grotesk': 'ritual-font-fk',
  'gt-standard': 'ritual-font-gt',
  'gt-america': 'ritual-font-gt-america',
  'geist-sans': 'ritual-font-geist',
};

const legacyFontClasses = ['font-sans', 'font-gt-standard', 'font-system-ui', 'font-geist-sans'];

function normalizeFontOption(value: string | null): FontOption {
  if (value === 'geist-sans') return 'geist-sans';
  if (value === 'gt-standard' || value === 'font-gt-standard') return 'gt-standard';
  if (value === 'gt-america') return 'gt-america';
  return 'fk-grotesk';
}

export function FontProvider({ children }: { children: ReactNode }) {
  const [font, setFontState] = useState<FontOption>(() => {
    if (typeof window === 'undefined') {
      return 'fk-grotesk';
    }

    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    if (
      stored === 'fk-grotesk'
      || stored === 'gt-standard'
      || stored === 'gt-america'
      || stored === 'geist-sans'
    ) {
      return stored;
    }

    // Removed font choices migrate to the product default.
    if (stored) localStorage.setItem(FONT_STORAGE_KEY, 'fk-grotesk');
    return 'fk-grotesk';
  });

  // Save font preference to localStorage when it changes
  const setFont = (newFont: FontOption) => {
    setFontState(newFont);
    localStorage.setItem(FONT_STORAGE_KEY, newFont);
  };

  const fontClass = fontClasses[font];

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== FONT_STORAGE_KEY) return;
      setFontState(normalizeFontOption(event.newValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const allFontClasses = [...Object.values(fontClasses), ...legacyFontClasses];
    const targets = [document.documentElement, document.body];

    targets.forEach((target) => {
      allFontClasses.forEach((className) => target.classList.remove(className));
      target.classList.add(fontClass);
    });

    return () => {
      targets.forEach((target) => {
        target.classList.remove(fontClass);
      });
    };
  }, [fontClass]);

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
