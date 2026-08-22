import * as React from "react";
import { cn } from "@/app/lib/utils";
import { XCircle, CheckCircle } from "lucide-react";

interface AlertProps {
  variant: "error" | "success";
  children: React.ReactNode;
  className?: string;
}

export function Alert({ variant, children, className }: AlertProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-left",
        variant === "error" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
        variant === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
        className,
      )}
    >
      {variant === "error" ? (
        <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
      ) : (
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
      )}
      {typeof children === "string" ? <p>{children}</p> : <div>{children}</div>}
    </div>
  );
}
