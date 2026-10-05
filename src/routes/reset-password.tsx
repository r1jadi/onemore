import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/reset-password")({
  head: () => seo("Set a new password", "Choose a new password for your onemore account."),
  component: Reset,
});

function Reset() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [done, setDone] = useState(false);
  const mismatch = b.length > 0 && a !== b;
  if (done) return (
    <AuthLayout title="Password updated" subtitle="You can now log in with your new password." back={false}>
      <div className="flex justify-center py-8"><span className="flex size-16 items-center justify-center rounded-full bg-success/15"><Check className="size-7 text-success" /></span></div>
      <Button asChild variant="play" size="xl" className="mt-auto w-full lg:mt-4"><Link to="/login">Log in</Link></Button>
    </AuthLayout>
  );
  return (
    <AuthLayout title="Set a new password" subtitle="Use at least 8 characters.">
      <form className="flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); if (a.length >= 8 && !mismatch) setDone(true); }}>
        <div className="space-y-4">
          <Field id="new" type="password" label="New password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" error={a && a.length < 8 ? "Too short." : undefined} />
          <Field id="confirm" type="password" label="Confirm password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" error={mismatch ? "Passwords don't match." : undefined} />
        </div>
        <Button type="submit" variant="play" size="xl" className="mt-auto w-full lg:mt-6" disabled={a.length < 8 || a !== b}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
