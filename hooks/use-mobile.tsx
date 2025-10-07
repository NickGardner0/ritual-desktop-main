import * as React from "react"
import { useState, useEffect } from 'react';

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const MOBILE_BREAKPOINT = 768;
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  return isMobile;
}
