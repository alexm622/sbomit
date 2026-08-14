"use client";

import * as React from "react";
import {
  Link as LinkIcon,
  Shield,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Search,
  FileText,
  Database,
  Copy,
  Check,
  Menu,
  X,
  Sparkles,
  ArrowRight,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";

import { cn } from "@/app/lib/utils";
import { ReportView } from "@/app/components/report-view";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
    >
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.419-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

interface AuditResult {
  name: string;
  version: string;
  score: number;
  summary: string;
  risks: Array<{
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    description: string;
  }>;
  dependencies: Array<{
    name: string;
    version: string;
    license: string;
    transitive: boolean;
  }>;
  license: {
    type: string;
    compatible: boolean;
    note: string;
  };
  maintainers: string[];
  lastPublished: string;
  weeklyDownloads: string;
}

const exampleUrls = [
  "https://www.npmjs.com/package/lodash",
  "https://www.npmjs.com/package/express",
  "https://www.npmjs.com/package/axios",
  "https://github.com/facebook/react",
];

const features = [
  {
    icon: Shield,
    title: "Security first",
    description:
      "Surface supply-chain risks, known advisories, and suspicious signals before they reach production.",
  },
  {
    icon: FileText,
    title: "Structured reports",
    description:
      "Every audit returns a consistent, Zod-validated report with a trust score and severity-ranked risks.",
  },
  {
    icon: Database,
    title: "Dependency inventory",
    description:
      "Persist direct and transitive dependency trees to D1 for tracking and shareable report URLs.",
  },
];

interface Suggestion {
  name: string;
  description: string;
}

function looksLikePackageName(value: string): boolean {
  return /^[^/\s:]+$/.test(value.trim());
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (looksLikePackageName(trimmed)) {
    return `https://www.npmjs.com/package/${trimmed}`;
  }
  return trimmed;
}

function displayUrlLabel(url: string): string {
  return url
    .replace("https://www.npmjs.com/package/", "npm:")
    .replace("https://github.com/", "gh:");
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-6 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="mt-6 h-2 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

export default function Home() {
  const [libraryUrl, setLibraryUrl] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<AuditResult | null>(null);
  const [reportId, setReportId] = React.useState<string | null>(null);
  const [reportUrl, setReportUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savingDeps, setSavingDeps] = React.useState(false);
  const [depsError, setDepsError] = React.useState<string | null>(null);
  const [savedDeps, setSavedDeps] = React.useState<{
    auditId: number;
    count: number;
  } | null>(null);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const suggestionsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const trimmed = libraryUrl.trim();
    const timer = setTimeout(async () => {
      if (!trimmed || !looksLikePackageName(trimmed)) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { packages: Suggestion[] };
        setSuggestions(data.packages || []);
        setShowSuggestions(true);
        setHighlightedIndex(-1);
      } catch {
        // Ignore autocomplete errors
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [libraryUrl]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectSuggestion = React.useCallback((name: string) => {
    setLibraryUrl(`https://www.npmjs.com/package/${name}`);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
      } else if (e.key === "Enter" && highlightedIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightedIndex].name);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, highlightedIndex, selectSuggestion],
  );

  const resetResultState = React.useCallback(() => {
    setResult(null);
    setReportId(null);
    setReportUrl(null);
    setCopied(false);
    setError(null);
    setDepsError(null);
    setSavedDeps(null);
  }, []);

  const handleAudit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!libraryUrl.trim()) return;
      setLoading(true);
      resetResultState();

      const normalizedUrl = normalizeUrl(libraryUrl);

      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            libraryUrl: normalizedUrl,
            prompt: prompt.trim() || undefined,
          }),
        });

        const data = (await res.json()) as {
          result?: AuditResult;
          reportId?: string;
          cached?: boolean;
          error?: { message?: string } | string;
        };

        if (!res.ok || data.error) {
          const message =
            typeof data.error === "string"
              ? data.error
              : data.error?.message || "Audit failed.";
          throw new Error(message);
        }

        if (!data.result) {
          throw new Error("No audit result returned.");
        }

        setResult(data.result);
        setReportId(data.reportId || null);
        if (data.reportId && typeof window !== "undefined") {
          setReportUrl(`${window.location.origin}/report/${data.reportId}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [libraryUrl, prompt, resetResultState],
  );

  const handleSaveDependencies = React.useCallback(async () => {
    if (!libraryUrl.trim()) return;
    setSavingDeps(true);
    setDepsError(null);
    setSavedDeps(null);

    const normalizedUrl = normalizeUrl(libraryUrl);

    try {
      const res = await fetch("/api/dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryUrl: normalizedUrl }),
      });

      const data = (await res.json()) as {
        auditId?: number;
        dependencies?: Array<Record<string, string>>;
        error?: { message?: string } | string;
      };

      if (!res.ok || data.error) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Failed to save dependencies.";
        throw new Error(message);
      }

      setSavedDeps({
        auditId: data.auditId ?? 0,
        count: data.dependencies?.length ?? 0,
      });
    } catch (err) {
      setDepsError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setSavingDeps(false);
    }
  }, [libraryUrl]);

  const navLinks = [
    { label: "How it works", href: "#how-it-works" },
    { label: "Features", href: "#features" },
    { label: "API", href: "#api" },
  ];

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <Shield className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">sbomit</span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <GitHubIcon className="h-4 w-4" />
              GitHub
            </a>
          </nav>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent sm:hidden"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-border/50 bg-background px-4 py-4 sm:hidden">
            <nav className="flex flex-col gap-3 text-sm font-medium text-muted-foreground">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="transition-colors hover:text-foreground"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <GitHubIcon className="h-4 w-4" />
                GitHub
              </a>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted via-background to-background" />
          <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-6">
                <Sparkles className="mr-1 h-3 w-3" />
                AI-Powered Security Audits
              </Badge>
              <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Audit npm libraries
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-muted-foreground to-foreground">
                  before you ship.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
                Paste a package URL, add an optional prompt, and get an instant
                AI audit covering security, license risk, and dependency health.
              </p>

              <form
                onSubmit={handleAudit}
                className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-card p-2 shadow-xl shadow-foreground/5 sm:p-3"
              >
                <div className="flex flex-col gap-3">
                  <div className="relative" ref={suggestionsRef}>
                    <LinkIcon className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={libraryUrl}
                      onChange={(e) => setLibraryUrl(e.target.value)}
                      onFocus={() => {
                        if (suggestions.length > 0) setShowSuggestions(true);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder="npm package or GitHub URL, e.g. lodash"
                      className="h-14 border-0 bg-transparent pl-11 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-controls="library-url-suggestions"
                      aria-expanded={showSuggestions}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div
                        id="library-url-suggestions"
                        className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card p-1.5 shadow-xl"
                        role="listbox"
                      >
                        {suggestions.map((suggestion, index) => (
                          <button
                            key={suggestion.name}
                            type="button"
                            role="option"
                            aria-selected={index === highlightedIndex}
                            onClick={() => selectSuggestion(suggestion.name)}
                            className={cn(
                              "w-full rounded-lg px-4 py-3 text-left transition-colors hover:bg-accent",
                              index === highlightedIndex && "bg-accent",
                            )}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <Search className="h-4 w-4 text-muted-foreground" />
                              {suggestion.name}
                            </div>
                            {suggestion.description && (
                              <div className="line-clamp-1 text-xs text-muted-foreground">
                                {suggestion.description}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <MessageSquare className="absolute left-3.5 top-3 h-5 w-5 text-muted-foreground" />
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Optional prompt, e.g. Focus on supply-chain risks for a fintech product."
                      rows={2}
                      className="w-full resize-none rounded-lg border-0 bg-muted/50 px-10 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="submit"
                      disabled={loading || !libraryUrl.trim()}
                      className="h-12 flex-1 px-6 text-base"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Auditing with AI
                        </>
                      ) : (
                        <>
                          Audit Library
                          <ChevronRight className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={savingDeps || !libraryUrl.trim()}
                      onClick={handleSaveDependencies}
                      className="h-12 flex-1 px-6 text-base sm:flex-none sm:px-4"
                    >
                      {savingDeps ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Saving
                        </>
                      ) : (
                        <>
                          <Database className="mr-2 h-5 w-5" />
                          Save Tree
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
                <span>Try:</span>
                {exampleUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setLibraryUrl(url)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {displayUrlLabel(url)}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {depsError && (
                <div className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{depsError}</p>
                </div>
              )}

              {savedDeps && (
                <div className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>
                    Saved {savedDeps.count} direct dependencies to D1 (audit{" "}
                    #{savedDeps.auditId}).
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {!result && !loading && (
          <>
            <section
              id="how-it-works"
              className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8"
            >
              <div className="mb-12 text-center">
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  How it works
                </h2>
                <p className="mt-3 text-muted-foreground">
                  Three steps to a safer dependency decision.
                </p>
              </div>
              <div className="grid gap-6 sm:grid-cols-3">
                <Card className="relative overflow-hidden">
                  <div className="absolute right-4 top-4 text-6xl font-black text-muted/50">
                    1
                  </div>
                  <CardHeader>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <LinkIcon className="h-5 w-5" />
                    </div>
                    <CardTitle>Paste a URL</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      Enter an npm package URL, a GitHub repo URL, or just a
                      package name. We fetch the latest metadata.
                    </p>
                  </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                  <div className="absolute right-4 top-4 text-6xl font-black text-muted/50">
                    2
                  </div>
                  <CardHeader>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <CardTitle>Add a prompt</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      Tell the AI what matters to you — security posture,
                      license compatibility, maintenance health, or
                      supply-chain risk.
                    </p>
                  </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                  <div className="absolute right-4 top-4 text-6xl font-black text-muted/50">
                    3
                  </div>
                  <CardHeader>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <CardTitle>Get a report</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      Receive a structured audit with a trust score, risk
                      breakdown, dependency tree, and license analysis.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section
              id="features"
              className="border-t border-border bg-muted/30 py-20"
            >
              <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
                <div className="mb-12 text-center">
                  <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                    Built for safer dependencies
                  </h2>
                  <p className="mt-3 text-muted-foreground">
                    Surface risk fast, share results, and keep a persistent
                    inventory.
                  </p>
                </div>
                <div className="grid gap-6 sm:grid-cols-3">
                  {features.map((feature) => (
                    <Card key={feature.title}>
                      <CardHeader>
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <feature.icon className="h-5 w-5" />
                        </div>
                        <CardTitle>{feature.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground">
                          {feature.description}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </section>

            <section id="api" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="grid lg:grid-cols-2">
                  <div className="p-8 sm:p-10">
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                      Developer-friendly API
                    </h2>
                    <p className="mt-4 text-muted-foreground">
                      Run audits, fetch reports, and persist dependency trees
                      from any CI pipeline or script.
                    </p>
                    <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Structured JSON reports
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Shareable report URLs
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Transitive dependency walking
                      </li>
                    </ul>
                    <div className="mt-8">
                      <Link href="/api/health" passHref>
                        <Button variant="outline">
                          Check API health
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                  <div className="border-t border-border bg-muted/50 p-6 font-mono text-sm lg:border-t-0 lg:border-l">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Terminal className="h-4 w-4" />
                      <span>Example request</span>
                    </div>
                    <pre className="mt-4 overflow-x-auto rounded-lg bg-card p-4 text-foreground">
                      <code className="break-words whitespace-pre text-xs sm:text-sm">{`curl -X POST https://sbomit.dev/api/audit \\
  -H "Content-Type: application/json" \\
  -d '{
    "libraryUrl": "https://www.npmjs.com/package/lodash"
  }'`}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {loading && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl">
              <div className="mb-10 text-center">
                <div className="relative mx-auto h-12 w-12">
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                </div>
                <p className="mt-4 text-lg font-medium">
                  Analyzing library with AI...
                </p>
                <p className="text-sm text-muted-foreground">
                  Fetching metadata and generating a structured audit report.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
              <div className="mt-6 space-y-4">
                <div className="h-40 animate-pulse rounded-2xl bg-muted" />
                <div className="h-32 animate-pulse rounded-2xl bg-muted" />
              </div>
            </div>
          </section>
        )}

        {result && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            {reportUrl && (
              <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="mb-2 text-sm font-medium">Shareable report URL</p>
                <div className="flex items-center gap-2">
                  <Link
                    href={reportUrl}
                    className="flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm text-primary hover:underline"
                  >
                    {reportUrl}
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(reportUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            <ReportView
              report={{
                id: reportId || "",
                model: "gpt-4o-mini",
                score: result.score,
                createdAt: new Date().toISOString(),
                result,
              }}
            />
          </section>
        )}
      </main>

      <footer className="border-t border-border bg-muted/30 py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
                <Shield className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold tracking-tight">sbomit</span>
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <a href="#how-it-works" className="hover:text-foreground">
                How it works
              </a>
              <a href="#features" className="hover:text-foreground">
                Features
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <GitHubIcon className="h-4 w-4" />
                GitHub
              </a>
            </nav>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} sbomit. MIT License.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
