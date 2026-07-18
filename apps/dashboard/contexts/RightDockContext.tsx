'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const RightDockTargetContext = createContext<HTMLElement | null>(null);

type RightDockRegistration = {
  close: () => void;
};

type RightDockUiContextValue = {
  isOpen: boolean;
  close: (() => void) | null;
  setRegistration: (registration: RightDockRegistration | null) => void;
};

const RightDockUiContext = createContext<RightDockUiContextValue>({
  isOpen: false,
  close: null,
  setRegistration: () => {},
});

export function RightDockTargetProvider({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: React.ReactNode;
}) {
  const [registration, setRegistration] = useState<RightDockRegistration | null>(null);

  const value = useMemo<RightDockUiContextValue>(
    () => ({
      isOpen: Boolean(registration),
      close: registration?.close ?? null,
      setRegistration,
    }),
    [registration],
  );

  return (
    <RightDockTargetContext.Provider value={target}>
      <RightDockUiContext.Provider value={value}>{children}</RightDockUiContext.Provider>
    </RightDockTargetContext.Provider>
  );
}

export function useRightDockTarget() {
  return useContext(RightDockTargetContext);
}

export function useRightDockUi() {
  return useContext(RightDockUiContext);
}

/** Register the active right-dock panel so window chrome can hide it. */
export function useRegisterRightDockClose(open: boolean, onClose: () => void) {
  const { setRegistration } = useRightDockUi();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stableClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) {
      setRegistration(null);
      return;
    }
    setRegistration({ close: stableClose });
    return () => setRegistration(null);
  }, [open, setRegistration, stableClose]);
}
