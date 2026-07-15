import * as React from "react";

import { cn } from "../cn";

export type CardDensity = "default" | "compact";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: CardDensity;
}

const CardDensityContext = React.createContext<CardDensity>("default");

const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, density = "default", ...props }, ref) => (
  <CardDensityContext.Provider value={density}>
    <div
      ref={ref}
      data-density={density}
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        density === "default" ? "shadow-sm" : "shadow-none",
        className,
      )}
      {...props}
    />
  </CardDensityContext.Provider>
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(CardDensityContext);
    return (
      <div
        ref={ref}
        className={cn("flex flex-col", density === "compact" ? "space-y-1 p-4 pb-3" : "space-y-1.5 p-6", className)}
        {...props}
      />
    );
  },
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(CardDensityContext);
    return (
      <div
        ref={ref}
        className={cn(
          density === "compact" ? "text-base font-medium leading-5" : "text-2xl font-semibold leading-none tracking-tight",
          className,
        )}
        {...props}
      />
    );
  },
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(CardDensityContext);
    return (
      <div
        ref={ref}
        className={cn(density === "compact" ? "text-[13px] leading-5" : "text-sm", "text-muted-foreground", className)}
        {...props}
      />
    );
  },
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(CardDensityContext);
    return <div ref={ref} className={cn(density === "compact" ? "px-4 pb-4" : "p-6 pt-0", className)} {...props} />;
  },
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const density = React.useContext(CardDensityContext);
    return (
      <div
        ref={ref}
        className={cn("flex items-center", density === "compact" ? "px-4 pb-4" : "p-6 pt-0", className)}
        {...props}
      />
    );
  },
);
CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
