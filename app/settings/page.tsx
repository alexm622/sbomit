"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Settings as SettingsIcon,
  XCircle,
} from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/app/components/ui/card";
import { useProviderConfigs } from "@/app/lib/use-provider-configs";
import {
  providerLabels,
  PROVIDERS,
  defaultModels,
  parseModelsInput,
  type Provider,
  type ProviderConfig,
} from "@/app/lib/providers";

function ConfigEditor({
  config,
  onUpdate,
  onRemove,
}: {
  config: ProviderConfig;
  onUpdate: (patch: Partial<ProviderConfig>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = React.useState(config.name);
  const [provider, setProvider] = React.useState<Provider>(config.provider);
  const [apiKey, setApiKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState(config.baseUrl ?? "");
  const [modelsText, setModelsText] = React.useState(config.models.join(", "));
  const [isDefault, setIsDefault] = React.useState(config.isDefault ?? false);

  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [testStatus, setTestStatus] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const hasChanges =
    name !== config.name ||
    provider !== config.provider ||
    apiKey.trim().length > 0 ||
    baseUrl.trim() !== (config.baseUrl ?? "").trim() ||
    modelsText.trim() !== config.models.join(", ").trim() ||
    isDefault !== (config.isDefault ?? false);

  const hasLocalCredentials =
    config.provider === "openai"
      ? Boolean(apiKey.trim() || baseUrl.trim())
      : Boolean(apiKey.trim());

  const hasSavedCredentials =
    config.provider === "openai"
      ? Boolean(config.hasApiKey || config.baseUrl)
      : Boolean(config.hasApiKey);

  const canFetchModels = hasLocalCredentials || hasSavedCredentials;

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const patch: Partial<ProviderConfig> = {
        name: name.trim(),
        provider,
        baseUrl: baseUrl.trim() || undefined,
        models: parseModelsInput(modelsText),
        isDefault,
      };
      if (apiKey.trim()) {
        patch.apiKey = apiKey.trim();
      }
      await onUpdate(patch);
      setApiKey("");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save provider.",
      );
    } finally {
      setSaving(false);
    }
  }, [name, provider, apiKey, baseUrl, modelsText, isDefault, onUpdate]);

  const handleRemove = React.useCallback(async () => {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }, [onRemove]);

  const runModelsRequest = React.useCallback(async (): Promise<string[]> => {
    if (hasLocalCredentials) {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { models?: string[]; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to fetch models.");
      }
      return data.models ?? [];
    }

    const res = await fetch(`/api/providers/${config.id}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json()) as { models?: string[]; error?: string };
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to fetch models.");
    }
    return data.models ?? [];
  }, [
    hasLocalCredentials,
    provider,
    apiKey,
    baseUrl,
    config.id,
  ]);

  const handleFetchModels = React.useCallback(async () => {
    if (!canFetchModels) return;
    setFetching(true);
    setFetchError(null);
    try {
      const models = await runModelsRequest();
      setModelsText(models.join(", "));
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch models.",
      );
    } finally {
      setFetching(false);
    }
  }, [canFetchModels, runModelsRequest]);

  const handleTest = React.useCallback(async () => {
    setTestStatus(null);
    try {
      const models = await runModelsRequest();
      const count = models.length;
      setTestStatus({
        type: "success",
        message: `Connected — ${count} model${count === 1 ? "" : "s"} available.`,
      });
    } catch (err) {
      setTestStatus({
        type: "error",
        message:
          err instanceof Error ? err.message : "Provider test failed.",
      });
    }
  }, [runModelsRequest]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Configuration name"
              className="text-base font-medium"
            />
            <CardDescription className="mt-1.5">
              {providerLabels[provider]} provider configuration
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={handleRemove}
            aria-label="Remove provider"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin text-destructive" />
            ) : (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`provider-${config.id}`}
              className="mb-1.5 block text-sm font-medium"
            >
              Provider
            </label>
            <select
              id={`provider-${config.id}`}
              value={provider}
              onChange={(e) => {
                const next = e.target.value as Provider;
                setProvider(next);
                setModelsText(defaultModels[next].join(", "));
              }}
              className="h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {providerLabels[p]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor={`apikey-${config.id}`}
                className="text-sm font-medium"
              >
                API key
              </label>
              {config.hasApiKey && (
                <Badge variant="outline" className="text-xs">
                  saved
                </Badge>
              )}
            </div>
            <Input
              id={`apikey-${config.id}`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config.hasApiKey ? "Enter to update" : "sk-..."}
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={`baseurl-${config.id}`}
            className="mb-1.5 block text-sm font-medium"
          >
            Base URL (optional)
          </label>
          <Input
            id={`baseurl-${config.id}`}
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {provider === "anthropic"
              ? "Optional. Use https://api.anthropic.com/v1 for the official API, or leave empty. Anthropic is not OpenAI-compatible."
              : provider === "google"
                ? "Optional. Use https://generativelanguage.googleapis.com/v1beta for the official API, or leave empty. Google is not OpenAI-compatible."
                : "For OpenAI-compatible endpoints such as OpenRouter, Moonshot, or a local llama.cpp/vLLM server."}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <label
              htmlFor={`models-${config.id}`}
              className="text-sm font-medium"
            >
              Available models
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canFetchModels || fetching}
              onClick={handleFetchModels}
              className="h-7 px-2 text-xs"
            >
              {fetching ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Fetch models
            </Button>
          </div>
          <textarea
            id={`models-${config.id}`}
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder="gpt-4o-mini, gpt-4o"
            rows={2}
            className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {fetchError && (
            <p className="mt-1 text-xs text-destructive">{fetchError}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Comma-separated list of models shown in the model dropdown.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            id={`default-${config.id}`}
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
          />
          <label
            htmlFor={`default-${config.id}`}
            className="text-sm font-medium"
          >
            Use as default provider
          </label>
        </div>

        {saveError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {saveError}
          </div>
        )}

        {testStatus && (
          <div
            className={`
              flex items-start gap-2 rounded-lg border px-3 py-2 text-xs
              ${
                testStatus.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              }
            `}
          >
            {testStatus.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {testStatus.message}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
          >
            Test
          </Button>
          <Button
            type="button"
            disabled={!hasChanges || saving}
            onClick={handleSave}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const {
    configs,
    selectedId,
    loading,
    error,
    setSelectedId,
    addConfig,
    updateConfig,
    removeConfig,
  } = useProviderConfigs();

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link
              href="/"
              className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back to audits
            </Link>
            <div className="flex items-center gap-3">
              <SettingsIcon className="h-6 w-6 text-primary" />
              <h1 className="text-3xl font-bold tracking-tight">
                Provider settings
              </h1>
            </div>
            <p className="mt-2 text-muted-foreground">
              Provider configurations are stored in D1. API keys are kept on
              the server and are not sent back to the browser.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">Add provider:</span>
            {PROVIDERS.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void addConfig(provider)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {providerLabels[provider]}
              </Button>
            ))}
          </div>

          {loading && configs.length === 0 && (
            <Card>
              <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading providers...
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {!loading && configs.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No providers configured yet. Add one above to start running
                audits.
              </CardContent>
            </Card>
          )}

          {configs.length > 0 && (
            <div className="space-y-6">
              <div>
                <label
                  htmlFor="default-provider"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Default provider for new audits
                </label>
                <select
                  id="default-provider"
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value || null)}
                  className="h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {configs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.name} ({providerLabels[config.provider]})
                    </option>
                  ))}
                </select>
              </div>

              {configs.map((config) => (
                <ConfigEditor
                  key={`${config.id}-${config.updatedAt ?? ""}`}
                  config={config}
                  onUpdate={(patch) => updateConfig(config.id, patch)}
                  onRemove={() => removeConfig(config.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground sm:px-6 lg:px-8">
          sbomit — AI-powered npm audits. Built for safer dependencies.
        </div>
      </footer>
    </div>
  );
}
