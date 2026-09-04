'use client';

import { lazy, memo, Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import { cn } from '@ritual/ui/cn';

const STREAMDOWN_CLASS = cn(
  'w-full min-w-0 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&>p]:my-0 [&>p+p]:mt-3',
  '[&>h2]:mt-5 [&>h3]:mt-4 [&>h4]:mt-4 [&>h2]:mb-2 [&>h3]:mb-2 [&>h4]:mb-2',
  '[&>ul]:my-3 [&>ol]:my-3 [&>ul+*]:mt-3 [&>ol+*]:mt-3',
);

const STREAMDOWN_COMPONENTS = {
  ul: ({ children, ...props }: { children?: ReactNode }) => (
    <ul className="list-disc pl-5 m-0 leading-[1.6] text-[#535353]" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: { children?: ReactNode }) => (
    <ol className="list-decimal pl-5 m-0 leading-[1.6] text-[#535353]" data-streamdown="ordered-list" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: { children?: ReactNode }) => (
    <li className="my-1 leading-[1.6] text-[#535353] break-words" data-streamdown="list-item" {...props}>
      {children}
    </li>
  ),
  h2: ({ children, ...props }: { children?: ReactNode }) => (
    <h2 className="font-medium text-[13px] text-gray-900 tracking-wide mt-4 mb-1" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: { children?: ReactNode }) => (
    <h3 className="font-medium text-[13px] text-gray-900 tracking-wide mt-3 mb-1" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: { children?: ReactNode }) => (
    <h4 className="font-medium text-[13px] text-gray-900 tracking-wide mt-3 mb-1" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }: { children?: ReactNode }) => (
    <p className="leading-[1.55] text-[#535353] break-words" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }: { children?: ReactNode }) => (
    <strong className="font-medium text-gray-900" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, ...props }: { children?: ReactNode }) => (
    <code className="px-1 py-0.5 rounded bg-[#f0ede8] text-[#535353] font-mono text-[13px]" {...props}>
      {children}
    </code>
  ),
  table: () => null,
  thead: () => null,
  tbody: () => null,
  tr: () => null,
  th: () => null,
  td: () => null,
};

export function needsRichMarkdown(text: string): boolean {
  return /```/.test(text)
    || /^\s*\|.+\|/m.test(text)
    || /mermaid/i.test(text)
    || /\$\$/.test(text);
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={index} className="px-1 py-0.5 rounded bg-[#f0ede8] text-[#535353] font-mono text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-medium text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function PlainMarkdown({ children, className }: { children: string; className?: string }) {
  const blocks = children.split(/\n{2,}/);
  return (
    <div className={cn(STREAMDOWN_CLASS, className)}>
      {blocks.map((block, index) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*[-*]\s+/.test(line) || line.trim() === '');
        const isOrdered = lines.every((line) => /^\s*\d+\.\s+/.test(line) || line.trim() === '');
        if (isList && lines.some((line) => line.trim())) {
          return (
            <ul key={index} className="list-disc pl-5 m-0 leading-[1.6] text-[#535353]">
              {lines.filter((line) => line.trim()).map((line, lineIndex) => (
                <li key={lineIndex} className="my-1 leading-[1.6] text-[#535353] break-words">
                  {renderInline(line.replace(/^\s*[-*]\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }
        if (isOrdered && lines.some((line) => line.trim())) {
          return (
            <ol key={index} className="list-decimal pl-5 m-0 leading-[1.6] text-[#535353]">
              {lines.filter((line) => line.trim()).map((line, lineIndex) => (
                <li key={lineIndex} className="my-1 leading-[1.6] text-[#535353] break-words">
                  {renderInline(line.replace(/^\s*\d+\.\s+/, ''))}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="leading-[1.55] text-[#535353] break-words">
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const StreamdownResponse = lazy(async () => {
  const { Streamdown } = await import('streamdown');
  const Rich: ComponentType<{ children: string; className?: string }> = ({ children, className }) => (
    <Streamdown className={cn(STREAMDOWN_CLASS, className)} components={STREAMDOWN_COMPONENTS}>
      {children}
    </Streamdown>
  );
  return { default: Rich };
});

export const Response = memo(function Response({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const rich = useMemo(() => needsRichMarkdown(children), [children]);
  return (
    <div
      className="select-text cursor-text [&_*]:select-text"
      style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      {rich ? (
        <Suspense fallback={<PlainMarkdown className={className}>{children}</PlainMarkdown>}>
          <StreamdownResponse className={className}>{children}</StreamdownResponse>
        </Suspense>
      ) : (
        <PlainMarkdown className={className}>{children}</PlainMarkdown>
      )}
    </div>
  );
});
