import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/verify-email")({
  head: () => seo("Verify your email", "Enter the 6-digit code we sent to your email."),
  component: Verify,
});

function Verify() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(30);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  return (
    <AuthLayout title="Check your email" subtitle="We sent a 6-digit code to r•••@mail.com.">
      <label className="mb-2 text-sm font-medium" htmlFor="otp">Verification code</label>
      <InputOTP id="otp" maxLength={6} value={code} onChange={setCode}>
        <InputOTPGroup className="w-full">{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} className="h-14 flex-1 text-lg" />)}</InputOTPGroup>
      </InputOTP>
      <button disabled={wait > 0} onClick={() => setWait(30)} className="mt-4 self-start text-sm text-muted-foreground disabled:opacity-60 enabled:hover:text-foreground">{wait > 0 ? `Resend code in ${wait}s` : "Resend code"}</button>
      <Button variant="play" size="xl" className="mt-auto w-full lg:mt-8" disabled={code.length < 6} onClick={() => nav({ to: "/account-created" })}>Verify</Button>
    </AuthLayout>
  );
}
