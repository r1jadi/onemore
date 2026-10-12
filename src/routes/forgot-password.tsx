import { createFileRoute, Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/forgot-password")({
  head: () => seo("Forgot password", "Reset your onemore password."),
  component: Forgot,
});

function Forgot() {
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If an account exists for that email, a reset link is on its way."
      >
        <div className="flex justify-center py-8">
          <MailCheck className="size-12 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div className="mt-auto space-y-2 lg:mt-4">
          <Button asChild variant="play" size="xl" className="w-full">
            <Link to="/reset-password">Open reset link (demo)</Link>
          </Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      </AuthLayout>
    );
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link."
      footer={
        <Link to="/login" className="font-medium text-foreground">
          Back to log in
        </Link>
      }
    >
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(true);
        }}
      >
        <Field id="email" type="email" label="Email" required autoComplete="email" />
        <Button type="submit" variant="play" size="xl" className="mt-auto w-full lg:mt-6">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
