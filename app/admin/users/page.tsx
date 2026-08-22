"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  KeyRound,
  RefreshCw,
  Users,
  UserX,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
import { Alert } from "@/app/components/ui/alert";
import { PageShell } from "@/app/components/page-shell";
import { apiFetch, apiFetchJson } from "@/app/lib/api-fetch";
import { useAuth } from "@/app/lib/use-auth";

interface PublicUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  isBlocked: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = React.useState<PublicUser[]>([]);
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const data = await apiFetch<{ users?: PublicUser[] }>(
        `/api/admin/users?${params.toString()}`,
      );
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user || !user.isAdmin) {
      router.replace("/");
      return;
    }
    // Data fetch on mount/dependency change is intentionally done in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadUsers();
  }, [user, authLoading, router, loadUsers]);

  const updateUser = React.useCallback(async (id: number, patch: Partial<PublicUser>) => {
    setActionError(null);
    try {
      await apiFetchJson(`/api/admin/users/${id}`, patch, { method: "PUT" });
      await loadUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    }
  }, [loadUsers]);

  const deleteUser = React.useCallback(async (id: number) => {
    if (!window.confirm("Delete this user?")) return;
    setActionError(null);
    try {
      await apiFetch<Record<string, unknown>>(`/api/admin/users/${id}`, {
        method: "DELETE",
      });
      await loadUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    }
  }, [loadUsers]);

  const setPassword = React.useCallback(async (id: number) => {
    const password = window.prompt("New password (min 8 chars):");
    if (!password) return;
    if (password.length < 8) {
      setActionError("Password must be at least 8 characters.");
      return;
    }
    setActionError(null);
    try {
      await apiFetchJson(`/api/admin/users/${id}/set-password`, { password });
      await loadUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Set password failed.");
    }
  }, [loadUsers]);

  const resetPassword = React.useCallback(async (id: number) => {
    setActionError(null);
    try {
      const data = await apiFetch<{ token?: string }>(
        `/api/admin/users/${id}/reset-password`,
        { method: "POST" },
      );
      window.alert(`Reset token: ${data.token ?? "n/a"}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reset failed.");
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
    <PageShell maxWidth="6xl" backHref="/" footer={false}>
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">User management</h1>
      </div>
      <p className="mt-2 text-muted-foreground">Search, edit, block, and manage accounts.</p>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void loadUsers()} placeholder="Search by username, email, or name" className="pl-9" />
        </div>
        <Button onClick={() => void loadUsers()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Search
        </Button>
      </div>

      {error && (
        <Alert variant="error" className="mt-6 gap-2 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </Alert>
      )}
      {actionError && (
        <Alert variant="error" className="mt-4 gap-2 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {actionError}
        </Alert>
      )}

      <Card className="mt-6">
            <CardHeader>
              <CardTitle>Users</CardTitle>
              <CardDescription>{users.length} user(s) found.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3 text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3"><div className="font-medium">{u.fullName}</div><div className="text-xs text-muted-foreground">@{u.username}</div></td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {u.isAdmin && <Badge variant="default" className="text-xs"><Shield className="mr-1 h-3 w-3" />Admin</Badge>}
                            {u.isBlocked && <Badge variant="destructive" className="text-xs">Blocked</Badge>}
                            {!u.isAdmin && !u.isBlocked && <Badge variant="secondary" className="text-xs">User</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="sm" onClick={() => void updateUser(u.id, { isAdmin: !u.isAdmin })} title={u.isAdmin ? "Remove admin" : "Make admin"}>
                              {u.isAdmin ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <Shield className="h-4 w-4" />}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void updateUser(u.id, { isBlocked: !u.isBlocked })} title={u.isBlocked ? "Unblock" : "Block"}>
                              {u.isBlocked ? <UserX className="h-4 w-4 text-destructive" /> : <UserX className="h-4 w-4" />}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void setPassword(u.id)} title="Set password"><KeyRound className="h-4 w-4" /></Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void resetPassword(u.id)} title="Reset password"><RefreshCw className="h-4 w-4" /></Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void deleteUser(u.id)} title="Delete user"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && !loading && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
    </PageShell>
  );
}
