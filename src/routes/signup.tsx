import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, FileText, Shield, Mail } from "lucide-react";
import { useState } from "react";
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
import { authErrorMessage, signUp } from "@/lib/auth/session";
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

function Signup() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [accept, setAccept] = useState({ terms: false, privacy: false, marketing: false });
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);
  const [username, setUsername] = useState("");
  const [creds, setCreds] = useState<{ email: string; password: string }>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const taken = username === "nora.k";

  // The credential is collected in step 1 and held until the account is created
  // in step 3, because the account itself is only made once the terms are
  // accepted. It is forwarded to Supabase by the auth service and never stored.
  async function createAccount() {
    if (!creds) return setErr("Enter your email and password to start again.");
    setErr(undefined);
    setBusy(true);
    try {
      const result = await signUp(creds.email, creds.password);
      // Tokens mean the account is ready to use. Without them Supabase requires
      // email confirmation, which is the step the app already asks the user for.
      nav({ to: result.tokens ? "/" : "/verify-email" });
    } catch (error) {
      setErr(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
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
            setCreds({
              email: String(f.get("email") ?? "").trim(),
              password: String(f.get("password") ?? ""),
            });
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
            if (!taken) setStep(2);
          }}
        >
          <div className="space-y-4">
            <Field id="display" label="Display name" required autoComplete="name" />
            <Field
              id="username"
              label="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              error={taken ? "That username is taken." : undefined}
            />
            {username && !taken && (
              <p className="flex items-center gap-1 text-xs text-success">
                <Check className="size-3.5" />@{username} is available
              </p>
            )}
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
            <p className="mt-4 text-sm text-destructive" role="alert">
              {err}
            </p>
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
