import { useState } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { Panel } from "../components/layout/Panel";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { cn } from "../lib/cn";
import { useStudioAuth } from "./StudioAuthProvider";

export function StudioAuthScreen() {
  const { bootstrapOwner, error, logIn, setupRequired, status, user } = useStudioAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    setSubmitting(true);
    setLocalError(null);

    try {
      if (setupRequired) {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        await bootstrapOwner({ email, password });
      } else {
        await logIn({ email, password });
      }
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "setup_complete") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Panel className="w-full max-w-2xl overflow-hidden border-border/80 bg-card/90 p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-full border border-emerald-400/40 bg-emerald-500/10 p-3 text-emerald-300">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Self-hosted owner account</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Local owner configured</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                PromptFarm finished first-run setup for <span className="font-medium text-foreground">{user?.email ?? "your local owner"}</span>.
                Entering Studio now.
              </p>
              <div className="mt-6 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                This backend now behaves like a single-owner self-hosted workspace. If you ever forget the password, run
                <span className="mx-1 font-mono text-foreground">promptfarm auth:reset-owner</span>
                and repeat setup.
              </div>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Panel className="w-full max-w-5xl overflow-hidden border-border/80 bg-card/90">
        <div className="grid gap-0 md:grid-cols-[1.05fr_0.95fr]">
          <section className="border-b border-border px-6 py-6 md:border-b-0 md:border-r">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Sprint 4</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {setupRequired ? "Create Local Studio Owner" : "Unlock Local Studio"}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {setupRequired
                ? "PromptFarm local mode behaves like a single-owner workspace. Set the first admin password once, then reuse it to enter Studio."
                : "PromptFarm local mode uses a single admin password for this backend. Enter it to reopen your current Studio environment."}
            </p>

            <div className="mt-6 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-foreground">
                Self-hosted owner account. This matches the familiar local flow: one owner signs in to the current backend and owns the local workspace.
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                Local-first auth only. Cloud users and multitenant identity stay for the hosted version.
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                Single-server mode keeps prompts, runtime, and the owner session under the same backend.
              </div>
            </div>
          </section>

          <section className="px-6 py-6">
            <div className="inline-flex items-center rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
              {setupRequired ? (
                <>
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                  First run setup
                </>
              ) : (
                <>
                  <KeyRound className="mr-2 h-3.5 w-3.5" />
                  Local owner login
                </>
              )}
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="studio-auth-email">Email</Label>
                <Input
                  id="studio-auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="owner@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="studio-auth-password">Password</Label>
                <Input
                  id="studio-auth-password"
                  type="password"
                  autoComplete={setupRequired ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              {setupRequired ? (
                <div className="space-y-2">
                  <Label htmlFor="studio-auth-password-confirm">Confirm Password</Label>
                  <Input
                    id="studio-auth-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat the local owner password"
                  />
                </div>
              ) : null}

              <Button className="w-full" onClick={() => void onSubmit()} disabled={submitting || status === "loading"}>
                <LockKeyhole className="h-4 w-4" />
                {setupRequired ? "Create Local Owner" : "Enter Studio"}
              </Button>

              <div
                className={cn(
                  "min-h-10 rounded-lg border px-3 py-2 text-xs",
                  localError || error ? "border-destructive/40 text-destructive" : "border-border/70 text-muted-foreground",
                )}
              >
                {localError ||
                  error ||
                  "Use an owner email plus password locally. Passwords must be at least 8 characters and include one capital letter plus one number. If you forget it, run `promptfarm auth:reset-owner` locally and set the owner up again."}
              </div>
            </div>
          </section>
        </div>
      </Panel>
    </div>
  );
}
