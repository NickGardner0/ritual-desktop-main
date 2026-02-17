'use client';

import { useState } from 'react';

interface RitualLogoProps {
  className?: string;
  size?: number;
}

export function RitualLogo({ className, size = 44 }: RitualLogoProps) {
  const [isSpinning, setIsSpinning] = useState(false);

  return (
    <img
      className={`${className || ''} cursor-pointer transition-transform duration-500 ease-in-out ${isSpinning ? 'rotate-[360deg]' : 'rotate-0'}`}
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
