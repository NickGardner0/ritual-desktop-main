"use client"

import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"

interface ResponseProps {
  children: string
  className?: string
}

/**
 * Response component for rendering AI chat responses with proper markdown formatting.
 * Inspired by Midday's Streamdown component but using react-markdown.
 */
export const Response = memo(
  ({ children, className }: ResponseProps) => {
    return (
      <div
        className={cn(
          "prose prose-sm max-w-none",
          // Reset prose defaults for cleaner look
          "prose-headings:font-medium prose-headings:text-foreground prose-headings:tracking-tight",
          "prose-h2:text-sm prose-h2:mt-4 prose-h2:mb-2",
          "prose-h3:text-sm prose-h3:mt-3 prose-h3:mb-1",
          "prose-h4:text-sm prose-h4:mt-2 prose-h4:mb-1",
          "prose-p:leading-relaxed prose-p:text-[#666666] prose-p:my-2",
          "prose-strong:font-semibold prose-strong:text-foreground",
          // Lists without bullets (like Midday)
          "prose-ul:list-none prose-ul:pl-0 prose-ul:my-2",
          "prose-ol:list-none prose-ol:pl-0 prose-ol:my-2",
          "prose-li:pl-0 prose-li:my-0.5",
          // Links
          "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
          // Code
          "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm",
          "prose-pre:bg-muted prose-pre:p-3 prose-pre:rounded-lg",
          className
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
          // Custom heading components
          h1: ({ children }) => (
            <h2 className="font-medium text-sm text-foreground tracking-wide mt-4 mb-2">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="font-medium text-sm text-foreground tracking-wide mt-3 mb-1">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="font-medium text-sm text-foreground tracking-wide mt-2 mb-1">
              {children}
            </h4>
          ),
          // Paragraph with relaxed leading
          p: ({ children }) => (
            <p className="leading-relaxed text-[#666666] my-2">{children}</p>
          ),
          // Unordered list (no bullets)
          ul: ({ children }) => (
            <ul className="list-none m-0 p-0 leading-relaxed space-y-1">{children}</ul>
          ),
          // Ordered list (no numbers, like Midday)
          ol: ({ children }) => (
            <ol className="list-none m-0 p-0 leading-relaxed space-y-1">{children}</ol>
          ),
          // List items
          li: ({ children }) => (
            <li className="py-0 my-0 leading-relaxed text-[#666666]">{children}</li>
          ),
          // Strong text
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          // Custom table component using shadcn/ui
          table: ({ children }) => (
            <div className="relative overflow-x-auto my-4 rounded-lg border">
              <Table>{children}</Table>
            </div>
          ),
          thead: ({ children }) => <TableHeader>{children}</TableHeader>,
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          tr: ({ children }) => <TableRow>{children}</TableRow>,
          th: ({ children }) => (
            <TableHead className="text-xs text-muted-foreground font-normal">
              {children}
            </TableHead>
          ),
          td: ({ children }) => (
            <TableCell className="text-sm">{children}</TableCell>
          ),
          // Links - internal vs external
          a: ({ href, children }) => {
            const isInternal = href?.startsWith("/")
            if (isInternal) {
              return (
                <Link href={href || "/"} className="text-primary underline underline-offset-2 hover:text-primary/80">
                  {children}
                </Link>
              )
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {children}
              </a>
            )
          },
          // Code blocks
          code: ({ className, children, ...props }) => {
            const isInline = !className
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code className={cn("block", className)} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="bg-muted p-3 rounded-lg overflow-x-auto text-sm">
              {children}
            </pre>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-4 italic text-muted-foreground my-3">
              {children}
            </blockquote>
          ),
          // Horizontal rule
          hr: () => <hr className="border-t border-border my-4" />,
        }}
        >
          {children}
        </ReactMarkdown>
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = "Response"

