'use client';

/**
 * DynamicIcon - Lazily loads Lucide icons to avoid slow compilation
 * 
 * This component is loaded via next/dynamic with ssr: false,
 * so the full lucide-react library is only loaded client-side
 * AFTER the page has rendered.
 */

import * as Lucide from 'lucide-react';
import { LayoutDashboard } from 'lucide-react';

// Helper to convert kebab-case to PascalCase for Lucide icons
const kebabToPascal = (k: string) => 
  k.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');

interface DynamicIconProps {
  name: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function DynamicIcon({ name, className = "w-4 h-4", fallback }: DynamicIconProps) {
  const pascalName = kebabToPascal(name);
  const IconComponent = (Lucide as any)[pascalName];
  
  if (IconComponent) {
    return <IconComponent className={className} />;
  }
  
  // Return fallback or default icon
  if (fallback) return <>{fallback}</>;
  return <LayoutDashboard className={className} />;
}

export default DynamicIcon;
