import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronDown, Laptop, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Field } from "@/components/auth/AuthLayout";
import { Avatar, EmptyState, Page, PageHeader } from "@/components/common";
import { LegalBody, privacy, terms } from "@/components/legal";
import { allSettings } from "@/components/settings/config";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { me } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/$section")({
  head: ({ params }) => {
    const t = allSettings.find((s) => s.slug === params.section)?.title ?? "Settings";
    return { meta: [{ title: `${t} settings — onemore` }, { name: "description", content: `Manage ${t.toLowerCase()} on onemore.` }, { property: "og:title", content: `${t} — onemore` }, { property: "og:description", content: `Manage ${t.toLowerCase()} on onemore.` }] };
  },
  component: Section,
});

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground md:px-0">{title}</h2>}
      <div className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">{children}</div>
    </section>
  );
}

function Toggle({ id, label, desc, initial = false }: { id: string; label: string; desc?: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Label htmlFor={id} className="flex-1 font-normal"><span className="block text-sm">{label}</span>{desc && <span className="text-xs text-muted-foreground">{desc}</span>}</Label>
      <Switch id={id} checked={on} onCheckedChange={setOn} />
    </div>
  );
}

function Row({ label, value, action }: { label: string; value?: string; action?: ReactNode }) {
  return <div className="flex min-h-14 items-center gap-3 px-4 py-3"><span className="flex-1 text-sm">{label}</span>{value && <span className="text-sm text-muted-foreground">{value}</span>}{action}</div>;
}

function Choice({ options, initial }: { options: { v: string; d?: string }[]; initial: string }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="grid gap-2 px-4 md:px-0" role="radiogroup">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={val === o.v} onClick={() => setVal(o.v)} className={cn("press flex items-center gap-3 rounded-xl border p-4 text-left", val === o.v ? "border-primary bg-primary/5" : "border-border bg-surface")}>
          <span className="flex-1"><span className="block text-sm font-medium">{o.v}</span>{o.d && <span className="text-xs text-muted-foreground">{o.d}</span>}</span>
          {val === o.v && <Check className="size-4 text-primary" />}
        </button>
      ))}
    </div>
  );
}

const faq = [
  ["How are scores verified?", "Every run is checked on our servers before it reaches a leaderboard."],
  ["Can I play offline?", "Some games work offline once loaded. Scores sync when you're back online."],
  ["How do I report a player?", "Open their profile, tap the menu, and choose Report."],
];

function Body({ section }: { section: string }) {
  switch (section) {
    case "account":
      return (<><Group title="Login"><Row label="Email" value="r•••@mail.com" action={<Button size="sm" variant="ghost">Change</Button>} /><Row label="Phone" value="Not added" action={<Button size="sm" variant="ghost">Add</Button>} /><Row label="Password" value="Updated 3 months ago" action={<Button asChild size="sm" variant="ghost"><Link to="/reset-password">Change</Link></Button>} /></Group><Group title="Data"><Row label="Download your data" action={<Button size="sm" variant="secondary" onClick={() => toast("We'll email you a download link")}>Request</Button>} /></Group></>);
    case "profile":
      return (
        <form className="space-y-4 px-4 md:px-0" onSubmit={(e) => { e.preventDefault(); toast.success("Profile saved"); }}>
          <div className="flex items-center gap-4"><Avatar name={me.username} size="xl" /><Button type="button" variant="secondary">Change photo</Button></div>
          <Field id="name" label="Display name" defaultValue={me.name} />
          <Field id="username" label="Username" defaultValue={me.username} />
          <div className="space-y-1.5"><Label htmlFor="bio">Bio</Label><Textarea id="bio" defaultValue={me.bio} maxLength={120} className="bg-surface" /><p className="text-xs text-muted-foreground">Up to 120 characters.</p></div>
          <Button type="submit" size="lg" className="w-full md:w-auto">Save changes</Button>
        </form>
      );
    case "privacy":
      return (<><Group title="Visibility"><Toggle id="p1" label="Private account" desc="Only approved followers see your activity" /><Toggle id="p2" label="Show on leaderboards" initial /><Toggle id="p3" label="Show recently played" initial /></Group><Group title="Interactions"><Toggle id="p4" label="Allow comments on my scores" initial /><Toggle id="p5" label="Allow mentions" initial /><Toggle id="p6" label="Personalised recommendations" initial /></Group></>);
    case "notifications":
      return (<><Group title="Push"><Toggle id="n1" label="Someone beats your score" initial /><Toggle id="n2" label="New followers" initial /><Toggle id="n3" label="Comments and replies" initial /><Toggle id="n4" label="Daily challenge reminder" initial /></Group><Group title="Email"><Toggle id="n5" label="Weekly summary" /><Toggle id="n6" label="Product updates" /></Group></>);
    case "security":
      return (<><Group title="Protection"><Toggle id="s1" label="Two-step verification" desc="Require a code when logging in on a new device" /><Toggle id="s2" label="Login alerts" initial /></Group><Group title="Active sessions"><Row label="iPhone 16 · Warsaw" value="This device" action={<Smartphone className="size-4 text-muted-foreground" />} /><Row label="MacBook · Chrome" value="2 days ago" action={<Button size="sm" variant="ghost" onClick={() => toast("Session ended")}>Log out</Button>} /><Row label="Windows · Edge" value="3 weeks ago" action={<Button size="sm" variant="ghost" onClick={() => toast("Session ended")}>Log out</Button>} /></Group><div className="mt-4 px-4 md:px-0"><Button variant="outline" className="w-full md:w-auto"><Laptop />Log out of all other sessions</Button></div></>);
    case "language":
      return <Choice initial="English" options={[{ v: "English" }, { v: "Polski" }, { v: "Deutsch" }, { v: "Español" }, { v: "Français" }, { v: "Türkçe" }]} />;
    case "appearance":
      return <Choice initial="Dark" options={[{ v: "Dark", d: "Default. Best for playing at night." }, { v: "Light", d: "Coming soon" }, { v: "System", d: "Follow your device setting" }]} />;
    case "accessibility":
      return (<><Group title="Motion"><Toggle id="a1" label="Reduce motion" desc="Minimise animations across the app" /><Toggle id="a2" label="Haptics" initial /></Group><Group title="Display"><Toggle id="a3" label="Increase contrast" /><Toggle id="a4" label="Larger text" /><Toggle id="a5" label="Colorblind-friendly palettes in games" /></Group></>);
    case "connected":
      return <Group><Row label="Apple" value="Connected" action={<Button size="sm" variant="ghost">Disconnect</Button>} /><Row label="Google" value="Not connected" action={<Button size="sm" variant="secondary">Connect</Button>} /></Group>;
    case "blocked":
      return <BlockedList />;
    case "help":
      return (<><Group title="Frequently asked">{faq.map(([q, a]) => <details key={q} className="group px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-sm">{q}<ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180" /></summary><p className="mt-2 text-sm text-muted-foreground">{a}</p></details>)}</Group><div className="mt-4 px-4 md:px-0"><Button size="lg" className="w-full md:w-auto" onClick={() => toast("Support request started")}>Contact support</Button></div></>);
    case "terms":
      return <div className="px-4 md:px-0"><LegalBody sections={terms} /></div>;
    case "privacy-policy":
      return <div className="px-4 md:px-0"><LegalBody sections={privacy} /></div>;
    case "about":
      return <Group><Row label="Version" value="0.1.0 (prototype)" /><Row label="Licences" action={<Button size="sm" variant="ghost">View</Button>} /><Row label="Website" value="onemore.app" /></Group>;
    default:
      return <EmptyState title="Setting not found" action={<Button asChild variant="secondary"><Link to="/settings">Back to settings</Link></Button>} />;
  }
}

function BlockedList() {
  const [list, setList] = useState(["sam.r", "spam.bot"]);
  if (!list.length) return <EmptyState title="No blocked users" body="People you block can't see your profile or comment on your scores." />;
  return <Group>{list.map((u) => <div key={u} className="flex items-center gap-3 px-4 py-3"><Avatar name={u} size="sm" /><span className="flex-1 text-sm">@{u}</span><Button size="sm" variant="secondary" onClick={() => setList(list.filter((x) => x !== u))}>Unblock</Button></div>)}</Group>;
}

function Section() {
  const { section } = Route.useParams();
  const meta = allSettings.find((s) => s.slug === section);
  return (
    <Page>
      <PageHeader back title={meta?.title ?? "Settings"} />
      <div className="enter"><Body section={section} /></div>
    </Page>
  );
}
