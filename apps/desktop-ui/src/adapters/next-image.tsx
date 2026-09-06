import type { ImgHTMLAttributes } from 'react';

type NextImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

export default function Image({ src, alt, fill: _fill, priority: _priority, unoptimized: _unoptimized, ...props }: NextImageProps) {
  return <img src={src} alt={alt} {...props} />;
}
