import React from 'react';

interface WindowDragHandleProps {
  className?: string;
  style?: React.CSSProperties;
}

export function WindowDragHandle({ className = '', style = {} }: WindowDragHandleProps) {
  return (
    <div
      className={`tauri-drag-region w-full h-8 absolute top-0 left-0 z-50 ${className}`}
      data-tauri-drag-region
      style={{
        backgroundColor: 'rgba(255, 0, 0, 0.2)',
        ...style
      }}
    />
  );
} 