"use client";

import * as React from "react";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
}

export interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    email: string;
    fullName: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      setUser(data.user ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session.");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Initial session load on mount. Data fetching from the server is an
    // intentional side effect here because this hook has no server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const login = React.useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    const data = (await res.json()) as { user?: AuthUser; error?: string; code?: string };
    if (!res.ok || data.error) {
      throw new Error(data.error || "Login failed.");
    }
    setUser(data.user ?? null);
  }, []);

  const register = React.useCallback(
    async (input: {
      username: string;
      email: string;
      fullName: string;
      password: string;
    }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { user?: AuthUser; error?: string; code?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || "Registration failed.");
      }
      setUser(data.user ?? null);
    },
    [],
  );

  const logout = React.useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setUser(null);
  }, []);

  return {
    user,
    loading,
    error,
    refresh,
    login,
    register,
    logout,
  };
}
