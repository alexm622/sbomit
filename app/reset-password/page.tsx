"use client";

import * as React from "react";
import Link from "next/link";
import { Shield, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Alert } from "@/app/components/ui/alert";
import { apiFetchJson } from "@/app/lib/api-fetch";

export default function ResetPasswordPage() {
  const [mode, setMode] = React.useState<"request" | "confirm">("request");
  const [email, setEmail] = React.useState("");
  const [token, setToken] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const requestReset = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetchJson("/api/auth/password-reset", { email });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  const confirmReset = React.useCallback(async () => {
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiFetchJson("/api/auth/password-reset/confirm", { token, password });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [token, password, confirmPassword]);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (mode === "request") {
        void requestReset();
      } else {
        void confirmReset();
      }
    },
    [mode, requestReset, confirmReset],
  );

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-background">
            <Shield className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "request"
              ? "Enter your email and we'll send a reset link."
              : "Enter the reset token and your new password."}
          </p>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <Alert variant="success" className="gap-2 rounded-lg px-3 py-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              {mode === "request"
                ? "If this email is registered, a reset token has been created."
                : "Your password has been reset. You can now sign in."}
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "request" ? (
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
            ) : (
              <>
                <div>
                  <label htmlFor="token" className="mb-1.5 block text-sm font-medium">
                    Reset token
                  </label>
                  <Input
                    id="token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                    New password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Confirm new password
                  </label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </>
            )}

            {error && (
              <Alert variant="error" className="gap-2 rounded-lg px-3 py-2 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {mode === "request" ? "Send reset link" : "Reset password"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setMode(mode === "request" ? "confirm" : "request");
                setError(null);
                setSuccess(false);
              }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {mode === "request" ? "Have a token?" : "Request a new token"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
