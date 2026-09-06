import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router-dom';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

export default function Link({ href, prefetch: _prefetch, replace, scroll: _scroll, children, ...props }: NextLinkProps) {
  return (
    <RouterLink to={href} replace={replace} {...(props as Omit<RouterLinkProps, 'to'>)}>
      {children}
    </RouterLink>
  );
}
