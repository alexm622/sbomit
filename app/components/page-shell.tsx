import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import { cn } from "@/app/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  maxWidth?: "3xl" | "4xl" | "5xl" | "6xl";
  backHref?: string;
  backLabel?: string;
  footer?: boolean;
  className?: string;
  mainClassName?: string;
}

function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
        sbomit — AI-powered npm audits. Built for safer dependencies.
      </div>
    </footer>
  );
}

export function PageShell({
  children,
  maxWidth,
  backHref,
  backLabel = "Back to audits",
  footer = true,
  className,
  mainClassName,
}: PageShellProps) {
  const content = (
    <>
      {backHref && (
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {backLabel}
        </Link>
      )}
      {children}
    </>
  );

  return (
    <div
      className={cn("flex min-h-full flex-col bg-background", className)}
    >
      <SiteHeader />
      <main className={cn("flex-1", mainClassName)}>
        {maxWidth ? (
          <section
            className={cn(
              "mx-auto px-4 py-12 sm:px-6 lg:px-8",
              `max-w-${maxWidth}`,
            )}
          >
            {content}
          </section>
        ) : (
          content
        )}
      </main>
      {footer && <Footer />}
    </div>
  );
}
