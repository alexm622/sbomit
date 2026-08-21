"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, AlertCircle, CheckCircle2, Save, KeyRound } from "lucide-react";
import { SiteHeader } from "@/app/components/site-header";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/app/components/ui/card";
import { useAuth } from "@/app/lib/use-auth";

export default function ProfilePage() {
  const { user, loading: authLoading, refresh } = useAuth();
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordLoading, setPasswordLoading] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setFullName(user.fullName);
      setEmail(user.email);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [user]);

  const handleSaveProfile = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      setSuccess(false);
      try {
        const res = await fetch("/api/users/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to update profile.");
        }
        setSuccess(true);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [fullName, email, refresh],
  );

  const handleChangePassword = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setPasswordError(null);
      setPasswordSuccess(false);
      if (newPassword !== confirmPassword) {
        setPasswordError("Passwords do not match.");
        return;
      }
      setPasswordLoading(true);
      try {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to change password.");
        }
        setPasswordSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch (err) {
        setPasswordError(
          err instanceof Error ? err.message : "Something went wrong.",
        );
      } finally {
        setPasswordLoading(false);
      }
    },
    [currentPassword, newPassword, confirmPassword],
  );

  if (authLoading || !user) {
    return (
      <div className="flex min-h-full flex-col bg-background">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to audits
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your account details and password.
          </p>

          <div className="mt-8 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Account details</CardTitle>
                <CardDescription>
                  Update your name and email address.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div>
                    <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium">
                      Full name
                    </label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}
                  {success && (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      Profile updated.
                    </div>
                  )}

                  <Button type="submit" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save profile
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Change password</CardTitle>
                <CardDescription>
                  Enter your current password and choose a new one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label htmlFor="currentPassword" className="mb-1.5 block text-sm font-medium">
                      Current password
                    </label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={passwordLoading}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium">
                      New password
                    </label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={passwordLoading}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium">
                      Confirm new password
                    </label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={passwordLoading}
                      required
                    />
                  </div>

                  {passwordError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {passwordError}
                    </div>
                  )}
                  {passwordSuccess && (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      Password changed.
                    </div>
                  )}

                  <Button type="submit" disabled={passwordLoading}>
                    {passwordLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                    Change password
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
