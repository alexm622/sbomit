import * as React from "react";
import { cn } from "@/app/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  variant?: "default" | "success" | "warning" | "danger";
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, variant = "default", ...props }, ref) => {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
          className,
        )}
        {...props}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", {
            "bg-primary": variant === "default",
            "bg-emerald-500": variant === "success",
            "bg-amber-500": variant === "warning",
            "bg-red-500": variant === "danger",
          })}
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
