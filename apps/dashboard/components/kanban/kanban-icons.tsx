'use client';

import React from 'react';
import type { Priority } from '@/types/kanban';

/**
 * Monochrome status circle icons — all gray, no color.
 */

type StatusType = 'empty' | 'half' | 'full' | 'dotted' | 'cancelled';

const STATUS_MAP: Record<string, StatusType> = {
  'todo': 'empty',
  'in-progress': 'half',
  'in-review': 'half',
  'complete': 'full',
  'done': 'full',
  'cancelled': 'cancelled',
};

interface StatusIconProps {
  columnId: string;
  size?: number;
  className?: string;
}

export function StatusIcon({ columnId, size = 14, className }: StatusIconProps) {
  const type = STATUS_MAP[columnId] ?? 'dotted';
  const r = size / 2 - 1.5;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = '#b4b4b4';
  const fill = '#b4b4b4';

  if (type === 'dotted') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={1.3} strokeDasharray="1.8 1.8" opacity={0.7} />
      </svg>
    );
  }

  if (type === 'empty') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={1.3} />
      </svg>
    );
  }

  if (type === 'half') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={1.3} />
        <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`} fill={fill} opacity={0.45} />
      </svg>
    );
  }

  if (type === 'full') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={1.3} opacity={0.55} />
        <path
          d={`M ${cx - r * 0.3} ${cy + r * 0.02} L ${cx - r * 0.02} ${cy + r * 0.32} L ${cx + r * 0.38} ${cy - r * 0.22}`}
          fill="none" stroke="white" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }

  // cancelled
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={1.3} opacity={0.5} />
      <line x1={cx - r * 0.3} y1={cy - r * 0.3} x2={cx + r * 0.3} y2={cy + r * 0.3} stroke={stroke} strokeWidth={1.3} strokeLinecap="round" opacity={0.5} />
      <line x1={cx + r * 0.3} y1={cy - r * 0.3} x2={cx - r * 0.3} y2={cy + r * 0.3} stroke={stroke} strokeWidth={1.3} strokeLinecap="round" opacity={0.5} />
    </svg>
  );
}

/**
 * Monochrome priority bar icon — all gray, varying bar count.
 */

const BAR_COUNT: Record<Priority, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };

interface PriorityIconProps {
  priority: Priority;
  size?: number;
  className?: string;
}

export function PriorityIcon({ priority, size = 14, className }: PriorityIconProps) {
  const count = BAR_COUNT[priority];
  const total = 4;
  const barW = 1.8;
  const gap = 1.4;
  const totalW = total * barW + (total - 1) * gap;
  const ox = (size - totalW) / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      {Array.from({ length: total }).map((_, i) => {
        const h = 3 + i * 1.8;
        const x = ox + i * (barW + gap);
        const y = size - 2 - h;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} rx={0.5}
            fill={i < count ? '#999' : '#e0e0e0'}
          />
        );
      })}
    </svg>
  );
}

/**
 * No-priority dots `···`
 */
export function NoPriorityIcon({ size = 14, className }: { size?: number; className?: string }) {
  const cy = size / 2;
  const gap = 3.5;
  const sx = size / 2 - gap;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
      <circle cx={sx} cy={cy} r={1} fill="#bbb" />
      <circle cx={sx + gap} cy={cy} r={1} fill="#bbb" />
      <circle cx={sx + gap * 2} cy={cy} r={1} fill="#bbb" />
    </svg>
  );
}
