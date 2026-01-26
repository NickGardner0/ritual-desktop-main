'use client';

import { useState, useEffect } from 'react';

interface RitualLogoProps {
  className?: string;
  size?: number;
}

export function RitualLogo({ className, size = 44 }: RitualLogoProps) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <img
      className={`${className || ''} cursor-pointer transition-transform duration-500 ease-in-out ${mounted && isSpinning ? 'rotate-[360deg]' : 'rotate-0'}`}
      src="/images/new_logo4.svg"
      alt="Ritual Logo"
      width={size}
      height={size}
      onClick={() => setIsSpinning(prev => !prev)}
      onMouseEnter={() => setIsSpinning(true)}
      onMouseLeave={() => setIsSpinning(false)}
    />
  )
}
