'use client';

import { useState, useEffect } from 'react';

export function RitualLogo({ className }: { className?: string }) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <img
      className={`${className || ''} cursor-pointer transition-transform duration-500 ease-in-out ${mounted && isSpinning ? 'rotate-[360deg]' : 'rotate-0'}`}
      src="/images/Vector.svg"
      alt="Ritual Logo"
      onClick={() => setIsSpinning(prev => !prev)}
      onMouseEnter={() => setIsSpinning(true)}
      onMouseLeave={() => setIsSpinning(false)}
    />
  )
}
