"use client";

import * as React from "react";
import {
  Link as LinkIcon,
  Shield,
  AlertTriangle,
  Package,
  Scale,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Info,
  MessageSquare,
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
  // Treat simple package names (no scheme, no slashes) as npm names.
  return /^[^/\s:]+$/.test(value.trim());
}

export default function Home() {
  const [libraryUrl, setLibraryUrl] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<AuditResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState("overview");
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
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

  const normalizeLibraryUrl = React.useCallback((value: string) => {
    const trimmed = value.trim();
    if (looksLikePackageName(trimmed)) {
      return `https://www.npmjs.com/package/${trimmed}`;
    }
    return trimmed;
  }, []);

  const handleAudit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!libraryUrl.trim()) return;
      setLoading(true);
      setResult(null);
      setError(null);

      const normalizedUrl = normalizeLibraryUrl(libraryUrl);

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
          error?: string;
        };

        if (!res.ok || data.error) {
          throw new Error(data.error || "Audit failed.");
        }

        if (!data.result) {
          throw new Error("No audit result returned.");
        }

        setResult(data.result);
        setActiveTab("overview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [libraryUrl, prompt, normalizeLibraryUrl],
  );

  return (
    <div className="flex flex-col min-h-full bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <Shield className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">sbomit</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#" className="hover:text-foreground">
              How it works
            </a>
            <a href="#" className="hover:text-foreground">
              API
            </a>
            <a href="#" className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              AI audit for npm libraries
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Paste a library URL and an optional prompt to get an instant
              security, license, and dependency report powered by OpenAI.
            </p>

            <form
              onSubmit={handleAudit}
              className="mt-10 flex flex-col gap-4 text-left"
            >
              <div className="relative" ref={suggestionsRef}>
                <LinkIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={libraryUrl}
                  onChange={(e) => setLibraryUrl(e.target.value)}
                  onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="https://www.npmjs.com/package/lodash"
                  className="h-14 pl-10 text-base"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-controls="library-url-suggestions"
                  aria-expanded={showSuggestions}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    id="library-url-suggestions"
                    className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg"
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
                          "w-full px-4 py-3 text-left transition-colors hover:bg-accent",
                          index === highlightedIndex && "bg-accent",
                        )}
                      >
                        <div className="font-medium">{suggestion.name}</div>
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
                <MessageSquare className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Optional prompt, e.g. Focus on supply-chain risks and license compatibility for enterprise use."
                  rows={3}
                  className="w-full resize-none rounded-lg border border-input bg-background px-10 py-2.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !libraryUrl.trim()}
                className="h-14 px-8 text-base"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Auditing
                  </>
                ) : (
                  <>
                    Audit Package
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </form>

            {error && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Try:</span>
              {exampleUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setLibraryUrl(url)}
                  className="rounded-full border border-border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
                >
                  {url.replace("https://www.npmjs.com/package/", "npm:").replace("https://github.com/", "gh:")}
                </button>
              ))}
            </div>
          </div>
        </section>

        {result && (
          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-8">
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
                          <CardTitle className="text-lg">{risk.title}</CardTitle>
                        </div>
                        <Badge variant={severityVariant[risk.severity]}>
                          {risk.severity}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground">{risk.description}</p>
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
                      Direct and transitive dependencies identified by the audit.
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
                    <p className="text-muted-foreground leading-7">
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
