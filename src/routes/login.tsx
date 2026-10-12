import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthLayout, Field, SocialButtons } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { authErrorMessage, signIn } from "@/lib/auth/session";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => seo("Log in", "Log in to onemore to keep your scores and streaks."),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Credentials go to the auth service, which forwards them to Supabase. They
  // are never kept here, and the API's own message is what the user is shown.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) return setErr("Enter your email and password.");
    setErr(undefined);
    setBusy(true);
    try {
      await signIn(email, password);
      nav({ to: "/" });
    } catch (error) {
      setErr(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to keep your scores and streaks."
      footer={
        <>
          New to onemore?{" "}
          <Link to="/signup" className="font-medium text-foreground">
            Create account
          </Link>
        </>
      }
    >
      <SocialButtons />
      <form className="space-y-4" onSubmit={submit}>
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" />
        <div className="relative">
          <Field
            id="password"
            name="password"
            type={show ? "text" : "password"}
            label="Password"
            autoComplete="current-password"
            hint={
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </Link>
            }
          />
          <button
            type="button"
            aria-label={show ? "Hide password" : "Show password"}
            onClick={() => setShow(!show)}
            className="absolute right-3 bottom-3.5 text-muted-foreground"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {err && (
          <p className="text-sm text-destructive" role="alert">
            {err}
          </p>
        )}
        <Button type="submit" variant="play" size="xl" className="w-full" disabled={busy}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
