import { lazy, Suspense, type ComponentType } from 'react';

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => React.ReactNode;
};

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  options: DynamicOptions = {},
) {
  const Lazy = lazy(async () => {
    const mod = await loader();
    if (mod && typeof mod === 'object' && 'default' in mod) {
      return { default: (mod as { default: ComponentType<P> }).default };
    }
    return { default: mod as ComponentType<P> };
  });

  return function DynamicComponent(props: P) {
    return (
      <Suspense fallback={options.loading ? options.loading() : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
