"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, AlertCircle, CheckCircle2, ShieldAlert, Plus, Trash2 } from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
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
      const [limitsRes, emailsRes, usernamesRes] = await Promise.all([
        fetch("/api/admin/provider-limits"),
        fetch("/api/admin/blocked-emails"),
        fetch("/api/admin/blocked-usernames"),
      ]);
      const limitsData = (await limitsRes.json()) as { providers?: ProviderLimitItem[]; error?: string };
      const emailsData = (await emailsRes.json()) as { emails?: string[]; error?: string };
      const usernamesData = (await usernamesRes.json()) as { usernames?: string[]; error?: string };
      if (!limitsRes.ok || limitsData.error) throw new Error(limitsData.error || "Failed to load limits.");
      if (!emailsRes.ok || emailsData.error) throw new Error(emailsData.error || "Failed to load blocked emails.");
      if (!usernamesRes.ok || usernamesData.error) throw new Error(usernamesData.error || "Failed to load blocked usernames.");
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
      const res = await fetch("/api/admin/provider-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, dailyTokenLimit }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to update limit.");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update limit.");
    }
  }, []);

  const addBlockedEmail = React.useCallback(async () => {
    if (!newEmail.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/admin/blocked-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = (await res.json()) as { emails?: string[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to block email.");
      setBlockedEmails(data.emails ?? []);
      setNewEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block email.");
    }
  }, [newEmail]);

  const removeBlockedEmail = React.useCallback(async (email: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/blocked-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      const data = (await res.json()) as { emails?: string[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to unblock email.");
      setBlockedEmails(data.emails ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock email.");
    }
  }, []);

  const addBlockedUsername = React.useCallback(async () => {
    if (!newUsername.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/admin/blocked-usernames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim() }),
      });
      const data = (await res.json()) as { usernames?: string[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to block username.");
      setBlockedUsernames(data.usernames ?? []);
      setNewUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to block username.");
    }
  }, [newUsername]);

  const removeBlockedUsername = React.useCallback(async (username: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/blocked-usernames?username=${encodeURIComponent(username)}`, { method: "DELETE" });
      const data = (await res.json()) as { usernames?: string[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to unblock username.");
      setBlockedUsernames(data.usernames ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unblock username.");
    }
  }, []);

  if (authLoading || !user?.isAdmin) {
    return (
      <div className="flex min-h-full flex-col bg-background">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <Link href="/" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="mr-1 h-4 w-4" />Back to audits</Link>
          <div className="flex items-center gap-3"><ShieldAlert className="h-6 w-6 text-primary" /><h1 className="text-3xl font-bold tracking-tight">Admin settings</h1></div>
          <p className="mt-2 text-muted-foreground">Provider token limits and registration blocklists.</p>

          {error && <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
          {success && <div className="mt-6 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Limits saved.</div>}

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
        </section>
      </main>
    </div>
  );
}
