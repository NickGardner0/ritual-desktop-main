import { cn } from '@/lib/utils';
import type { LucideProps } from 'lucide-react';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

export type SpinnerProps = LucideProps & {
  variant?:
    | 'default'
    | 'circle'
    | 'pinwheel'
    | 'circle-filled'
    | 'ellipsis'
    | 'ring'
    | 'bars'
    | 'infinite';
};

export const Spinner = ({ className, ...props }: SpinnerProps) => {
  return (
    <BrailleSpinner
      className={cn('text-xl', className)}
      aria-label={props['aria-label'] ?? 'Loading'}
    />
  );
};
