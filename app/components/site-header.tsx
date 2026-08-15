"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Shield } from "lucide-react";
import { useAuditJobs } from "./audit-jobs";

export function SiteHeader() {
  const { jobs } = useAuditJobs();
  const runningCount = jobs.filter((job) => job.status === "running").length;

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
            <Shield className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">sbomit</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
          <Link
            href="/#how-it-works"
            className="hidden hover:text-foreground sm:inline"
          >
            How it works
          </Link>
          <Link
            href="/audits"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            Audits
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                {runningCount} running
              </span>
            )}
          </Link>
          <a href="#" className="hidden hover:text-foreground sm:inline">
            API
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden hover:text-foreground sm:inline"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
