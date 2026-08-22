"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2, ShieldAlert, Plus, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
import { Alert } from "@/app/components/ui/alert";
import { PageShell } from "@/app/components/page-shell";
import { apiFetch, apiFetchJson } from "@/app/lib/api-fetch";
import { useAuth } from "@/app/lib/use-auth";

interface ProviderLimitItem {
  id: string;
  name: string;
  provider: string;
  dailyTokenLimit: number | null;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [providers, setProviders] = React.useState<ProviderLimitItem[]>([]);
  const [blockedEmails, setBlockedEmails] = React.useState<string[]>([]);
  const [blockedUsernames, setBlockedUsernames] = React.useState<string[]>([]);
  const [newEmail, setNewEmail] = React.useState("");
  const [newUsername, setNewUsername] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [limitsData, emailsData, usernamesData] = await Promise.all([
        apiFetch<{ providers?: ProviderLimitItem[] }>("/api/admin/provider-limits"),
        apiFetch<{ emails?: string[] }>("/api/admin/blocked-emails"),
        apiFetch<{ usernames?: string[] }>("/api/admin/blocked-usernames"),
      ]);
      setProviders(limitsData.providers ?? []);
      setBlockedEmails(emailsData.emails ?? []);
      setBlockedUsernames(usernamesData.usernames ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    }
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user || !user.isAdmin) {
      router.replace("/");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [user, authLoading, router, load]);

  const updateLimit = React.useCallback(async (providerId: string, value: string) => {
    setError(null);
    setSuccess(false);
    const dailyTokenLimit = value.trim() === "" ? null : Number(value);
    if (dailyTokenLimit !== null && (!Number.isFinite(dailyTokenLimit) || dailyTokenLimit < 0)) {
      setError("Token limit must be a non-negative number.");
      return;
    }
    try {
      await apiFetchJson("/api/admin/provider-limits", { providerId, dailyTokenLimit }, { method: "PUT" });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update limit.");
    }
  }, []);

  const addBlockedEmail = React.useCallback(async () => {
    if (!newEmail.trim()) return;
    setError(null);
    try {
      const data = await apiFetchJson<{ emails?: string[] }>("/api/admin/blocked-emails", {
        email: newEmail.trim(),
      });
      setBlockedEmails(data.emails ?? []);
      setNewEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block email.");
    }
  }, [newEmail]);

  const removeBlockedEmail = React.useCallback(async (email: string) => {
    setError(null);
    try {
      const data = await apiFetch<{ emails?: string[] }>(
        `/api/admin/blocked-emails?email=${encodeURIComponent(email)}`,
        { method: "DELETE" },
      );
      setBlockedEmails(data.emails ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock email.");
    }
  }, []);

  const addBlockedUsername = React.useCallback(async () => {
    if (!newUsername.trim()) return;
    setError(null);
    try {
      const data = await apiFetchJson<{ usernames?: string[] }>("/api/admin/blocked-usernames", {
        username: newUsername.trim(),
      });
      setBlockedUsernames(data.usernames ?? []);
      setNewUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block username.");
    }
  }, [newUsername]);

  const removeBlockedUsername = React.useCallback(async (username: string) => {
    setError(null);
    try {
      const data = await apiFetch<{ usernames?: string[] }>(
        `/api/admin/blocked-usernames?username=${encodeURIComponent(username)}`,
        { method: "DELETE" },
      );
      setBlockedUsernames(data.usernames ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock username.");
    }
  }, []);

  if (authLoading || !user?.isAdmin) {
    return (
      <PageShell mainClassName="flex items-center justify-center" footer={false}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="3xl" backHref="/" footer={false}>
      <div className="flex items-center gap-3"><ShieldAlert className="h-6 w-6 text-primary" /><h1 className="text-3xl font-bold tracking-tight">Admin settings</h1></div>
      <p className="mt-2 text-muted-foreground">Provider token limits and registration blocklists.</p>

      {error && (
        <Alert variant="error" className="mt-6 gap-2 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" className="mt-6 gap-2 rounded-lg px-3 py-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          Limits saved.
        </Alert>
      )}

      <Card className="mt-8">
            <CardHeader><CardTitle>Provider daily token limits</CardTitle><CardDescription>Leave empty for unlimited.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.provider}</div></div>
                  <Input type="number" min={0} defaultValue={p.dailyTokenLimit ?? ""} className="w-40" onBlur={(e) => void updateLimit(p.id, e.target.value)} />
                </div>
              ))}
              {providers.length === 0 && <p className="text-sm text-muted-foreground">No providers configured.</p>}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader><CardTitle>Blocked emails</CardTitle><CardDescription>Prevent registration from these email addresses.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@example.com" />
                <Button onClick={() => void addBlockedEmail()}><Plus className="mr-1 h-4 w-4" />Block</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {blockedEmails.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"><span>{email}</span><button onClick={() => void removeBlockedEmail(email)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button></span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader><CardTitle>Blocked usernames</CardTitle><CardDescription>Prevent registration of these usernames.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="username" />
                <Button onClick={() => void addBlockedUsername()}><Plus className="mr-1 h-4 w-4" />Block</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {blockedUsernames.map((username) => (
                  <span key={username} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"><span>{username}</span><button onClick={() => void removeBlockedUsername(username)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button></span>
                ))}
              </div>
            </CardContent>
          </Card>
    </PageShell>
  );
}
