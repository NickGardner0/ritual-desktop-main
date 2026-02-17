import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-gray-200 animate-shimmer bg-[length:200%_100%]",
        "bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
