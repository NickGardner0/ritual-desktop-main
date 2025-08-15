import React from 'react';

interface PrismLogoProps {
  className?: string;
  size?: number;
}

export function PrismLogo({ className = "", size = 120 }: PrismLogoProps) {
  return (
    <div 
      className={`relative ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/images/shred.svg"
        alt="Ritual Shred Logo"
        width={size}
        height={size}
        className="object-contain"
        style={{ 
          width: '100%',
          height: '100%'
        }}
      />
    </div>
  );
} 