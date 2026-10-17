import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, FileText, Shield, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthLayout, Field, SocialButtons } from "@/components/auth/AuthLayout";
import { LegalBody, privacy, terms } from "@/components/legal";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/api/client";
import { authErrorMessage, loadSession, signOut, signUp, useAuth } from "@/lib/auth/session";
import { completeRegistration } from "@/lib/users/registration";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signup")({
  head: () => seo("Create account", "Create your onemore account in under a minute."),
  component: Signup,
});

const titles = [
  ["Create your account", "Step 1 of 3"],
  ["Choose your name", "Step 2 of 3 · This is how others see you."],
  ["Before you start", "Step 3 of 3 · Please review and accept."],
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Where a display name is kept while email confirmation is pending. */
const PENDING_DISPLAY_NAME_KEY = "onemore-pending-display-name";

function storedPendingDisplayName(): string {
  try {
    return sessionStorage.getItem(PENDING_DISPLAY_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberPendingDisplayName(name: string): void {
  try {
    sessionStorage.setItem(PENDING_DISPLAY_NAME_KEY, name);
  } catch {
    // Best effort only; the profile screen lets the user set it later.
  }
}

function forgetPendingDisplayName(): void {
  try {
    sessionStorage.removeItem(PENDING_DISPLAY_NAME_KEY);
  } catch {
    // Best effort only.
  }
}

function Signup() {
  const nav = useNavigate();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [accept, setAccept] = useState({ terms: false, privacy: false, marketing: false });
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [creds, setCreds] = useState<{ email: string; password: string }>();
  const [credError, setCredError] = useState<string>();
  const [err, setErr] = useState<string>();
  const [errCode, setErrCode] = useState<string>();
  const [busy, setBusy] = useState(false);

  // A signed-in account that has not finished signing up — a Google sign-in, or
  // an email whose confirmation link was just opened — completes here: the
  // credential step is already done, so what remains is the name and the terms.
  // The database decides (`onboarded_at` through the session), never a local
  // guess, so a reload mid-way lands back on the same step.
  const completing = auth.status === "authenticated" && auth.session.onboarded === false;
  // Signing in to an account that already exists must never lead back into the
  // registration form: there is nothing to create, and asking for a password
  // for an email that already has an account is exactly how a duplicate
  // registration gets attempted. `onboarded === undefined` is not "new" — it
  // means the server could not read the marker — so it is treated as existing
  // too and offered the idempotent completion instead.
  const alreadyRegistered = auth.status === "authenticated" && !completing;

  useEffect(() => {
    if (!completing) return;
    setStep((current) => (current === 0 ? 1 : current));
    setDisplayName((current) => (current === "" ? storedPendingDisplayName() : current));
  }, [completing]);

  // The credential is collected in step 1 and held until the account is created
  // in step 3, because the account itself is only made once the terms are
  // accepted. It is forwarded to Supabase by the auth service and never stored.
  // The username is intentionally not collected here: it is not writable
  // through the profile API (see ProfileForm), so asking for one would be a
  // promise this screen cannot keep. The account gets a generated username;
  // the display name below is applied to the profile when a session exists.
  async function createAccount() {
    if (completing) {
      // The Supabase account (and its profile row, created by the database
      // trigger) already exists; only the registration marker is missing.
      await finishRegistration();
      return;
    }
    if (!creds) return setErr("Enter your email and password to start again.");
    setErr(undefined);
    setBusy(true);
    try {
      const result = await signUp(creds.email, creds.password);
      const name = displayName.trim();
      // When Supabase issued a session immediately, the registration is
      // finished below. While confirmation is pending there is no token, so the
      // name is kept for the sign-up completion after verification.
      if (name !== "") rememberPendingDisplayName(name);
      if (result.tokens) {
        await finishRegistration();
      } else {
        nav({ to: "/verify-email", search: { email: creds.email } });
      }
    } catch (error) {
      // The API answers a duplicate registration with 409 `conflict`. Its
      // message is the one the screen shows, and the link below turns it into
      // the next step rather than a dead end. The check is on the status and
      // code, not the wording, so a translated or re-worded message still maps.
      const duplicate =
        error instanceof ApiError && (error.status === 409 || error.code === "conflict");
      setErr(
        duplicate
          ? "An account with this email already exists. Please sign in instead."
          : authErrorMessage(error),
      );
      setErrCode(duplicate ? "conflict" : error instanceof ApiError ? error.code : "unknown_error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records the registration exactly once: the display name goes through the
   * users API and the marker through the database (see
   * `lib/users/registration`). The session view is re-read afterwards so the
   * screen the app shows next reflects the server's answer, not a local one.
   */
  async function finishRegistration() {
    setErr(undefined);
    setBusy(true);
    try {
      await completeRegistration(displayName.trim());
      forgetPendingDisplayName();
      await loadSession();
      nav({ to: "/account-created" });
    } catch (error) {
      setErr(authErrorMessage(error));
      setErrCode(error instanceof ApiError ? error.code : "unknown_error");
    } finally {
      setBusy(false);
    }
  }

  // A completed account is not sent back through registration. The signed-in
  // identity is the answer to "does this account exist?", and offering a form
  // that would create a second one is the bug this screen used to have.
  if (alreadyRegistered) {
    return (
      <AuthLayout
        title="You're already signed in"
        subtitle={
          auth.status === "authenticated" && auth.session.email
            ? `Signed in as ${auth.session.email}.`
            : "This browser already has a session."
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This account already exists, so there is nothing to register again. Continue to your
            profile, or log out first if you meant to create a different account.
          </p>
          {err && (
            <p className="text-sm text-destructive" role="alert">
              {err}
            </p>
          )}
          <div className="grid gap-2">
            <Button asChild variant="play" size="xl" className="w-full">
              <Link to="/profile">Go to your profile</Link>
            </Button>
            {auth.status === "authenticated" && auth.session.onboarded === undefined && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => void finishRegistration()}
              >
                Finish setting up my account
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => {
                // The local session is cleared even if revoking it fails.
                void signOut().catch(() => undefined);
              }}
            >
              Log out and create a different account
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={titles[step][0]}
      subtitle={titles[step][1]}
      footer={
        step === 0 && (
          <>
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-foreground">
              Log in
            </Link>
          </>
        )
      }
    >
      <div className="mb-6 flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-surface-2")}
          />
        ))}
      </div>

      {step === 0 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const email = String(f.get("email") ?? "").trim();
            const password = String(f.get("password") ?? "");
            if (!isValidEmail(email)) {
              setCredError("Enter a valid email address.");
              return;
            }
            if (password.length < 8) {
              setCredError("Use at least 8 characters for your password.");
              return;
            }
            setCredError(undefined);
            setCreds({ email, password });
            setStep(1);
          }}
        >
          <SocialButtons />
          <div className="space-y-4">
            <Field
              id="email"
              name="email"
              type="email"
              label="Email"
              required
              autoComplete="email"
              defaultValue={creds?.email ?? ""}
            />
            <Field
              id="password"
              name="password"
              type="password"
              label="Password"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">At least 8 characters, with a number.</p>
            {credError && (
              <p className="text-sm text-destructive" role="alert">
                {credError}
              </p>
            )}
          </div>
          <Button type="submit" variant="play" size="xl" className="mt-auto w-full lg:mt-6">
            Continue
          </Button>
        </form>
      )}

      {step === 1 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const value = displayName.trim();
            if (value === "") {
              setNameError("Add a display name — this is how others see you.");
              return;
            }
            if (value.length > 60) {
              setNameError("Keep the display name to 60 characters or fewer.");
              return;
            }
            setNameError(undefined);
            setStep(2);
          }}
        >
          <div className="space-y-4">
            <Field
              id="display"
              label="Display name"
              required
              autoComplete="name"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={nameError}
            />
            <p className="text-xs text-muted-foreground">
              Your username is generated automatically and shown in your profile. You can change it
              later in Settings.
            </p>
          </div>
          <Button type="submit" variant="play" size="xl" className="mt-auto w-full lg:mt-6">
            Continue
          </Button>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col">
          <div className="space-y-2">
            {(
              [
                [
                  "terms",
                  "Terms & Conditions",
                  "Required · Rules for using onemore",
                  FileText,
                  true,
                ],
                ["privacy", "Privacy Policy", "Required · How we handle your data", Shield, true],
                [
                  "marketing",
                  "Product updates",
                  "Optional · Occasional emails about new games",
                  Mail,
                  false,
                ],
              ] as const
            ).map(([key, label, desc, Icon, isDoc]) => {
              const on = accept[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-xl border p-4 transition-colors duration-150",
                    on ? "border-primary bg-primary/5" : "border-border bg-surface",
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <Icon
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={on}
                      onChange={() => setAccept({ ...accept, [key]: !on })}
                    />
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-4" />}
                    </span>
                  </label>
                  {isDoc && (
                    <button
                      type="button"
                      onClick={() => setDoc(key as "terms" | "privacy")}
                      className="mt-2 ml-8 text-xs font-medium underline underline-offset-4"
                    >
                      Read {label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {err && (
            <div className="mt-4 text-sm text-destructive" role="alert">
              <p>{err}</p>
              {errCode === "conflict" && creds && (
                <Link
                  to="/login"
                  search={{ email: creds.email }}
                  className="mt-1 inline-block font-medium underline underline-offset-4"
                >
                  Sign in instead
                </Link>
              )}
              {errCode === "email_not_confirmed" && creds && (
                <Link
                  to="/verify-email"
                  search={{ email: creds.email }}
                  className="mt-1 inline-block font-medium underline underline-offset-4"
                >
                  Resend the confirmation email
                </Link>
              )}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            You must be 13 or older to use onemore.
          </p>
          <Button
            variant="play"
            size="xl"
            className="mt-auto w-full lg:mt-6"
            disabled={!accept.terms || !accept.privacy || busy}
            onClick={createAccount}
          >
            Agree and create account
          </Button>
        </div>
      )}

      <Sheet open={!!doc} onOpenChange={(o) => !o && setDoc(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto flex h-[85dvh] max-w-xl flex-col rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle>{doc === "terms" ? "Terms & Conditions" : "Privacy Policy"}</SheetTitle>
            <SheetDescription className="sr-only">Legal document</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            <LegalBody sections={doc === "terms" ? terms : privacy} />
          </div>
          <div className="p-4">
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                if (doc) setAccept({ ...accept, [doc]: true });
                setDoc(null);
              }}
            >
              I accept
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AuthLayout>
  );
}
