'use client';

import React, { createContext, useContext } from 'react';

const RightDockTargetContext = createContext<HTMLElement | null>(null);

export function RightDockTargetProvider({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <RightDockTargetContext.Provider value={target}>
      {children}
    </RightDockTargetContext.Provider>
  );
}

export function useRightDockTarget() {
  return useContext(RightDockTargetContext);
}
