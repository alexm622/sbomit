"use client";

import * as React from "react";
import { apiFetch, apiFetchJson } from "@/app/lib/api-fetch";
import {
  createDefaultProviderConfig,
  type Provider,
  type ProviderConfig,
} from "./providers";

const SELECTED_ID_KEY = "sbomit-selected-provider";

export interface UseProviderConfigsResult {
  configs: ProviderConfig[];
  selectedId: string | null;
  selectedConfig: ProviderConfig | null;
  loading: boolean;
  error: string | null;
  setSelectedId: (id: string | null) => void;
  addConfig: (provider?: Provider) => Promise<void>;
  updateConfig: (id: string, patch: Partial<ProviderConfig>) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
}

function loadSelectedId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SELECTED_ID_KEY);
  } catch {
    return null;
  }
}

function saveSelectedId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      localStorage.setItem(SELECTED_ID_KEY, id);
    } else {
      localStorage.removeItem(SELECTED_ID_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

function normalizeServerConfig(config: ProviderConfig): ProviderConfig {
  return {
    ...config,
    apiKey: config.apiKey ?? undefined,
    hasApiKey: config.hasApiKey ?? Boolean(config.apiKey),
    isDefault: config.isDefault ?? false,
  };
}

export function useProviderConfigs(): UseProviderConfigsResult {
  const [configs, setConfigs] = React.useState<ProviderConfig[]>([]);
  const [selectedId, setSelectedIdState] = React.useState<string | null>(
    loadSelectedId,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const setSelectedId = React.useCallback((id: string | null) => {
    setSelectedIdState(id);
    saveSelectedId(id);
  }, []);

  const refresh = React.useCallback(async () => {
    const data = await apiFetch<{
      providers?: ProviderConfig[];
    }>("/api/providers", { cache: "no-store" });
    const providers = (data.providers ?? []).map(normalizeServerConfig);
    setConfigs(providers);
    return providers;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const providers = await refresh();
        if (cancelled) return;
        const currentSelected = providers.find((c) => c.id === selectedId);
        if (!currentSelected && providers.length > 0) {
          const fallback =
            providers.find((c) => c.isDefault) ?? providers[0] ?? null;
          setSelectedId(fallback?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load providers.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addConfig = React.useCallback(
    async (provider?: Provider) => {
      const draft = createDefaultProviderConfig(provider ?? "openai");
      const data = await apiFetchJson<{ id?: string }>("/api/providers", {
        name: draft.name,
        provider: draft.provider,
        apiKey: "",
        baseUrl: draft.baseUrl,
        models: draft.models,
        isDefault: configs.length === 0,
      });
      if (!data.id) {
        throw new Error("Failed to create provider.");
      }
      await refresh();
      setSelectedId(data.id);
    },
    [configs.length, refresh, setSelectedId],
  );

  const updateConfig = React.useCallback(
    async (id: string, patch: Partial<ProviderConfig>) => {
      const body: Record<string, unknown> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.provider !== undefined) body.provider = patch.provider;
      if (patch.apiKey !== undefined && patch.apiKey.trim()) {
        body.apiKey = patch.apiKey.trim();
      }
      if (patch.baseUrl !== undefined) {
        body.baseUrl = patch.baseUrl.trim() || null;
      }
      if (patch.models !== undefined) body.models = patch.models;
      if (patch.isDefault !== undefined) body.isDefault = patch.isDefault;

      await apiFetchJson<{ ok?: boolean }>(`/api/providers/${id}`, body, {
        method: "PUT",
      });
      await refresh();
      if (patch.isDefault) {
        setSelectedId(id);
      }
    },
    [refresh, setSelectedId],
  );

  const removeConfig = React.useCallback(
    async (id: string) => {
      await apiFetch<Record<string, unknown>>(`/api/providers/${id}`, {
        method: "DELETE",
      });
      const providers = await refresh();
      if (selectedId === id) {
        const fallback =
          providers.find((c) => c.isDefault) ?? providers[0] ?? null;
        setSelectedId(fallback?.id ?? null);
      }
    },
    [refresh, selectedId, setSelectedId],
  );

  const selectedConfig =
    configs.find((config) => config.id === selectedId) ?? configs[0] ?? null;

  return {
    configs,
    selectedId,
    selectedConfig,
    loading,
    error,
    setSelectedId,
    addConfig,
    updateConfig,
    removeConfig,
  };
}
