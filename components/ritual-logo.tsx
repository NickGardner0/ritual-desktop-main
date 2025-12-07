'use client';

import { useState } from 'react';

export function RitualLogo({ className }: { className?: string }) {
  const [isSpinning, setIsSpinning] = useState(false);

  return (
    <img
      className={`${className || ''} cursor-pointer`}
      src="/images/logo_fix1.svg"
      alt="Ritual Logo"
      style={{
        transform: isSpinning ? 'rotate(360deg)' : 'rotate(0deg)',
        transition: 'transform 500ms ease-in-out'
      }}
      onClick={() => setIsSpinning(prev => !prev)}
      onMouseEnter={() => setIsSpinning(true)}
      onMouseLeave={() => setIsSpinning(false)}
    />
  )
}
