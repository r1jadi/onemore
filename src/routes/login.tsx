import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field, SocialButtons } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  head: () => seo("Log in", "Log in to onemore to keep your scores and streaks."),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <AuthLayout title="Welcome back" subtitle="Log in to keep your scores and streaks." footer={<>New to onemore? <Link to="/signup" className="font-medium text-foreground">Create account</Link></>}>
      <SocialButtons />
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (!f.get("email") || !f.get("password")) return setErr("Enter your email and password."); nav({ to: "/" }); }}>
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" />
        <div className="relative">
          <Field id="password" name="password" type={show ? "text" : "password"} label="Password" autoComplete="current-password" hint={<Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">Forgot password?</Link>} />
          <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute right-3 bottom-3.5 text-muted-foreground">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
        </div>
        {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
        <Button type="submit" variant="play" size="xl" className="w-full">Log in</Button>
      </form>
    </AuthLayout>
  );
}
