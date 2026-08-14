"use client";

import * as React from "react";
import {
  Link as LinkIcon,
  AlertTriangle,
  Package,
  Scale,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Info,
  MessageSquare,
  Search,
  FileText,
  Zap,
  Lock,
  Database,
  Ban,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import { Progress } from "@/app/components/ui/progress";
import { cn } from "@/app/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/app/components/ui/tabs";
import { SiteHeader } from "@/app/components/site-header";
import {
  ElapsedTime,
  displayUrlLabel,
  useAuditJobs,
} from "@/app/components/audit-jobs";

interface Risk {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
}

interface Dependency {
  name: string;
  version: string;
  license: string;
  transitive: boolean;
}

interface AuditResult {
  name: string;
  version: string;
  score: number;
  summary: string;
  risks: Risk[];
  dependencies: Dependency[];
  license: {
    type: string;
    compatible: boolean;
    note: string;
  };
  maintainers: string[];
  lastPublished: string;
  weeklyDownloads: string;
}

const severityVariant = {
  critical: "destructive",
  high: "destructive",
  medium: "warning",
  low: "secondary",
} as const;

const scoreVariant = (score: number) => {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
};

const exampleUrls = [
  "https://www.npmjs.com/package/lodash",
  "https://www.npmjs.com/package/express",
  "https://www.npmjs.com/package/axios",
  "https://github.com/facebook/react",
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

const pipelineSteps = [
  {
    icon: Search,
    label: "Resolving package metadata",
    detail: "Fetching package data from the npm registry or GitHub API.",
  },
  {
    icon: MessageSquare,
    label: "Building the audit prompt",
    detail: "Assembling a bounded metadata context plus your custom prompt.",
  },
  {
    icon: Zap,
    label: "Running the AI audit",
    detail: "OpenAI generates a schema-validated security and license report.",
  },
  {
    icon: CheckCircle2,
    label: "Validating the result",
    detail: "Parsing, clamping, and cross-checking the structured output.",
  },
  {
    icon: Database,
    label: "Saving the report",
    detail: "Persisting the audit to D1 so it appears in your audit history.",
  },
];

export default function Home() {
  const { jobs, startAudit, cancelAudit } = useAuditJobs();
  const [libraryUrl, setLibraryUrl] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AuditResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("overview");
  const [savingDeps, setSavingDeps] = React.useState(false);
  const [depsError, setDepsError] = React.useState<string | null>(null);
  const [savedDeps, setSavedDeps] = React.useState<{
    auditId: number;
    count: number;
  } | null>(null);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const suggestionsRef = React.useRef<HTMLDivElement>(null);

  const activeJob = activeJobId
    ? jobs.find((job) => job.id === activeJobId)
    : undefined;
  const loading = activeJob?.status === "running";

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

  const handleAudit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!libraryUrl.trim()) return;
      setResult(null);
      setError(null);
      setCancelled(false);
      setDepsError(null);
      setSavedDeps(null);

      const normalizedUrl = normalizeUrl(libraryUrl);

      const { jobId, done } = startAudit({
        libraryUrl: normalizedUrl,
        prompt: prompt.trim() || undefined,
      });
      setActiveJobId(jobId);

      const outcome = await done;

      if (outcome.status === "completed") {
        setResult(outcome.result);
        setActiveTab("overview");
      } else if (outcome.status === "cancelled") {
        setCancelled(true);
      } else {
        setError(outcome.error);
      }
      setActiveJobId(null);
    },
    [libraryUrl, prompt, startAudit],
  );

  const handleCancelAudit = React.useCallback(() => {
    if (activeJobId) {
      cancelAudit(activeJobId);
    }
  }, [activeJobId, cancelAudit]);

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
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to save dependencies.");
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

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted via-background to-background" />
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <Badge variant="secondary" className="mb-6">
                <Zap className="mr-1 h-3 w-3" />
                AI-Powered Security Audits
              </Badge>
              <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
                Audit npm libraries
                <span className="block text-muted-foreground">
                  before you ship.
                </span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
                Paste a package URL, add an optional prompt, and get an instant
                AI audit covering security, license risk, and dependency health.
              </p>

              <form
                onSubmit={handleAudit}
                className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border bg-card p-2 shadow-lg sm:p-3"
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
                      className="h-14 border-0 bg-transparent pl-11 text-base shadow-none focus-visible:ring-0"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-controls="library-url-suggestions"
                      aria-expanded={showSuggestions}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div
                        id="library-url-suggestions"
                        className="absolute z-50 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-xl"
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
                      className="w-full resize-none rounded-lg border-0 bg-muted/50 px-10 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading || !libraryUrl.trim()}
                    className="h-12 px-8 text-base"
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
                    className="h-12 px-8 text-base"
                  >
                    {savingDeps ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Saving Tree
                      </>
                    ) : (
                      <>
                        <Database className="mr-2 h-5 w-5" />
                        Save Dependency Tree
                      </>
                    )}
                  </Button>
                </div>
              </form>

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

              {error && (
                <div className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {cancelled && (
                <div className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3 text-left text-muted-foreground">
                  <Ban className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>
                    Audit cancelled. No report was generated — start a new
                    audit whenever you&apos;re ready.
                  </p>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
                <span>Try:</span>
                {exampleUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setLibraryUrl(url)}
                    className="rounded-full border border-border bg-card px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                  >
                    {displayUrlLabel(url)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {!result && !loading && (
          <section
            id="how-it-works"
            className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8"
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
              <Card>
                <CardHeader>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <LinkIcon className="h-5 w-5" />
                  </div>
                  <CardTitle>1. Paste a URL</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Enter an npm package URL, a GitHub repo URL, or just a
                    package name. We fetch the latest metadata.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <CardTitle>2. Add a prompt</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Tell the AI what matters to you — security posture, license
                    compatibility, maintenance health, or supply-chain risk.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <CardTitle>3. Get a report</CardTitle>
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
        )}

        {loading && activeJob && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <Card className="mx-auto max-w-3xl">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-6 w-6 shrink-0 animate-spin text-primary" />
                    <div>
                      <CardTitle className="text-xl">
                        Auditing {displayUrlLabel(activeJob.libraryUrl)}
                      </CardTitle>
                      <CardDescription>
                        {activeJob.source === "npm"
                          ? "npm package"
                          : "GitHub repository"}{" "}
                        · started{" "}
                        {new Date(activeJob.startedAt).toLocaleTimeString()} ·
                        elapsed{" "}
                        <ElapsedTime
                          since={activeJob.startedAt}
                          className="tabular-nums"
                        />
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary">{activeJob.source}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {activeJob.prompt && (
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
                    <span className="font-medium">Custom prompt: </span>
                    <span className="text-muted-foreground">
                      {activeJob.prompt}
                    </span>
                  </div>
                )}

                <div>
                  <p className="mb-3 text-sm font-medium">
                    What&apos;s happening during this audit
                  </p>
                  <ol className="space-y-3">
                    {pipelineSteps.map((step, index) => (
                      <li key={step.label} className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <step.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {index + 1}. {step.label}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {step.detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Most audits finish in 5–15 seconds. You can leave this page
                    — the audit keeps running and is tracked on the Audits
                    page.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancelAudit}
                    className="shrink-0"
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Cancel audit
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {result && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Audit report for {result.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Generated by OpenAI from public library metadata.
                </p>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="risks">
                  Risks
                  <Badge variant="secondary" className="ml-2">
                    {result.risks.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
                <TabsTrigger value="license">License</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Trust Score</CardDescription>
                      <div className="flex items-end gap-2">
                        <CardTitle className="text-4xl">
                          {result.score}
                        </CardTitle>
                        <span className="text-sm text-muted-foreground">
                          /100
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Progress
                        value={result.score}
                        variant={scoreVariant(result.score)}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Version</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.version}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Last published {result.lastPublished}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>Weekly Downloads</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.weeklyDownloads}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        npm registry estimate
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardDescription>License</CardDescription>
                      <CardTitle className="text-2xl">
                        {result.license.type}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {result.license.compatible
                          ? "Compatible"
                          : "Review required"}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-5 w-5 text-muted-foreground" />
                      AI Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-base leading-7 text-foreground">
                    {result.summary}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="risks" className="space-y-4">
                {result.risks.map((risk, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-amber-500" />
                          <CardTitle className="text-lg">
                            {risk.title}
                          </CardTitle>
                        </div>
                        <Badge variant={severityVariant[risk.severity]}>
                          {risk.severity}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">
                        {risk.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="dependencies">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-muted-foreground" />
                      Dependency Tree
                    </CardTitle>
                    <CardDescription>
                      Direct and transitive dependencies identified by the
                      audit.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Package
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Version
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              License
                            </th>
                            <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {result.dependencies.map((dep) => (
                            <tr key={`${dep.name}@${dep.version}`}>
                              <td className="px-4 py-3 font-medium">
                                {dep.name}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {dep.version}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant="outline">{dep.license}</Badge>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {dep.transitive ? "Transitive" : "Direct"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="license">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Scale className="h-5 w-5 text-muted-foreground" />
                      License Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-lg font-semibold">
                          {result.license.type} License
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {result.license.compatible
                            ? "Compatible with most projects"
                            : "May conflict with your project license"}
                        </p>
                      </div>
                    </div>
                    <p className="leading-7 text-muted-foreground">
                      {result.license.note}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        )}
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          sbomit — AI-powered npm audits. Built for safer dependencies.
        </div>
      </footer>
    </div>
  );
}
