import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, Page, PageHeader } from "@/components/common";
import { settingsGroups } from "@/components/settings/config";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import { me } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/settings/")({
  head: () => seo("Settings", "Manage your onemore account, privacy and preferences."),
  component: Settings,
});

function Settings() {
  const nav = useNavigate();
  const [logout, setLogout] = useState(false);
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState("");
  return (
    <Page>
      <PageHeader back title="Settings" />
      <Link to="/profile" className="press mx-4 flex items-center gap-3 rounded-xl bg-surface p-3 md:mx-0">
        <Avatar name={me.username} size="lg" />
        <div className="flex-1"><p className="font-medium">{me.name}</p><p className="text-sm text-muted-foreground">@{me.username}</p></div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      {settingsGroups.map((g) => (
        <section key={g.label} className="mt-6">
          <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground md:px-0">{g.label}</h2>
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {g.items.map(({ slug, title, desc, icon: Icon }) => (
              <li key={slug}>
                <Link to="/settings/$section" params={{ section: slug }} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2">
                  <Icon className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                  <span className="flex-1 text-sm">{title}</span>
                  {desc && <span className="hidden text-sm text-muted-foreground sm:block">{desc}</span>}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ul className="mx-4 mt-6 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
        <li><button onClick={() => setLogout(true)} className="flex min-h-14 w-full items-center gap-3 px-4 text-sm hover:bg-surface-2"><LogOut className="size-[18px] text-muted-foreground" strokeWidth={1.75} />Log out</button></li>
        <li><button onClick={() => setDel(true)} className="flex min-h-14 w-full items-center gap-3 px-4 text-sm text-destructive hover:bg-surface-2"><Trash2 className="size-[18px]" strokeWidth={1.75} />Delete account</button></li>
      </ul>

      <AlertDialog open={logout} onOpenChange={setLogout}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Log out of onemore?</AlertDialogTitle><AlertDialogDescription>Your scores are saved to your account.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => nav({ to: "/welcome" })}>Log out</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={del} onOpenChange={(o) => { setDel(o); setConfirm(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete your account?</AlertDialogTitle><AlertDialogDescription>This permanently deletes your profile, scores, comments and followers after 30 days. This can't be undone.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-1.5"><Label htmlFor="del">Type DELETE to confirm</Label><Input id="del" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={confirm !== "DELETE"} className={buttonVariants({ variant: "destructive" })} onClick={() => nav({ to: "/welcome" })}>Delete account</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
