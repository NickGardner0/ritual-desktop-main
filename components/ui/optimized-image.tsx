'use client';

import Image, { ImageProps } from 'next/image';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface OptimizedImageProps extends Omit<ImageProps, 'onLoad'> {
  fallbackSrc?: string;
  containerClassName?: string;
  withBlur?: boolean;
}

/**
 * OptimizedImage component with:
 * - Blur-up loading
 * - Fade-in animation
 * - Error handling with fallback
 * - Lazy loading with priority option
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  className,
  fallbackSrc = '/images/placeholder.webp', // Default fallback
  containerClassName,
  withBlur = true,
  priority = false,
  ...props
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [blurDataURL, setBlurDataURL] = useState<string | undefined>(undefined);
  
  // Generate a tiny placeholder for blur-up loading
  useEffect(() => {
    if (!withBlur || typeof src !== 'string' || priority) return;
    
    // Mini placeholder generator (you can replace with a more sophisticated solution)
    const createPlaceholder = () => {
      return `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'%3E%3Cfilter id='b' color-interpolation-filters='sRGB'%3E%3CfeGaussianBlur stdDeviation='20'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3C/svg%3E`;
    };
    
    setBlurDataURL(createPlaceholder());
  }, [src, width, height, withBlur, priority]);

  return (
    <div className={cn('relative overflow-hidden', containerClassName)}>
      <Image
        src={error ? fallbackSrc : src}
        alt={alt}
        width={width}
        height={height}
        className={cn(
          'transition-opacity duration-500',
          isLoading ? 'opacity-0' : 'opacity-100',
          className
        )}
        placeholder={blurDataURL ? 'blur' : 'empty'}
        blurDataURL={blurDataURL}
        onLoadingComplete={() => setIsLoading(false)}
        onError={() => {
          setError(true);
          setIsLoading(false);
        }}
        priority={priority}
        loading={priority ? 'eager' : 'lazy'}
        {...props}
      />
      
      {/* Show loading state */}
      {isLoading && (
        <div className="absolute inset-0 bg-gray-100 animate-pulse" />
      )}
    </div>
  );
} 