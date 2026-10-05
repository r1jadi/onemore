import { createFileRoute } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AdminPage, Field, SectionCard, StatusBadge, TextField } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [{ title: "System settings — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: SystemSettings,
});

function Toggle({
  id,
  label,
  desc,
  initial = false,
}: {
  id: string;
  label: string;
  desc?: string;
  initial?: boolean;
}) {
  const [on, setOn] = useState(initial);
  return (
    <div className="flex items-center gap-3 py-3">
      <Label htmlFor={id} className="flex-1 font-normal">
        <span className="block text-sm">{label}</span>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
      </Label>
      <Switch id={id} checked={on} onCheckedChange={setOn} />
    </div>
  );
}

function SelectRow({
  id,
  label,
  hint,
  value,
  options,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: string[];
}) {
  const [val, setVal] = useState(value);
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Label htmlFor={id} className="min-w-40 flex-1 font-normal">
        <span className="block text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </Label>
      <select
        id={id}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="h-10 rounded-lg bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SectionCard title={title}>
      <div className="divide-y divide-border">{children}</div>
    </SectionCard>
  );
}

function SaveBar({ onSave }: { onSave?: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Changes apply to the prototype only — nothing is persisted yet.
      </p>
      <Button size="sm" onClick={onSave ?? (() => toast.success("Settings saved"))}>
        <Save />
        Save changes
      </Button>
    </div>
  );
}

function SystemSettings() {
  const [tab, setTab] = useState("general");
  return (
    <AdminPage
      title="System settings"
      subtitle="Platform defaults, moderation rules and notification policy."
    >
      <Tabs value={tab} onValueChange={setTab}>
        <div className="no-scrollbar overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="moderation">Moderation</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="platform">Platform</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general" className="mt-4 space-y-4">
          <Group title="Identity">
            <div className="grid gap-4 py-3 md:grid-cols-2">
              <TextField id="s-name" label="Platform name" defaultValue="onemore" />
              <TextField id="s-support" label="Support email" defaultValue="support@onemore.app" />
              <TextField id="s-domain" label="Public domain" defaultValue="onemore.app" />
              <TextField
                id="s-privacy"
                label="Privacy contact"
                defaultValue="privacy@onemore.app"
              />
            </div>
          </Group>
          <Group title="Access">
            <Toggle
              id="s-signups"
              label="Signups open"
              desc="New players can create accounts"
              initial
            />
            <Toggle
              id="s-invite"
              label="Invite-only beta"
              desc="Require an invite code to sign up"
            />
            <SelectRow
              id="s-age"
              label="Minimum age"
              hint="Accounts below this age are blocked"
              value="13"
              options={["13", "16", "18"]}
            />
            <SelectRow
              id="s-locale"
              label="Default language"
              value="English"
              options={["English", "Polski", "Deutsch", "Español"]}
            />
          </Group>
          <Group title="Availability">
            <Toggle
              id="s-maintenance"
              label="Maintenance mode"
              desc="Show the maintenance screen to all players"
            />
            <Toggle
              id="s-readonly"
              label="Read-only mode"
              desc="Players can browse but not play new runs"
            />
          </Group>
          <SaveBar />
        </TabsContent>

        <TabsContent value="moderation" className="mt-4 space-y-4">
          <Group title="Automated rules">
            <SelectRow
              id="m-hide"
              label="Auto-hide comments"
              hint="After this many player reports"
              value="3 reports"
              options={["2 reports", "3 reports", "5 reports", "Never"]}
            />
            <SelectRow
              id="m-suspend"
              label="Auto-suspend accounts"
              hint="Reports within 24 hours"
              value="8 reports"
              options={["5 reports", "8 reports", "12 reports", "Never"]}
            />
            <Toggle
              id="m-review"
              label="Review every new game"
              desc="Creators cannot publish without approval"
              initial
            />
            <Toggle
              id="m-profanity"
              label="Profanity filter"
              desc="Block masked abuse in comments and usernames"
              initial
            />
          </Group>
          <Group title="Appeals and appeals window">
            <SelectRow
              id="m-appeal"
              label="Appeal window"
              hint="How long a player has to appeal"
              value="14 days"
              options={["7 days", "14 days", "30 days"]}
            />
            <Toggle
              id="m-second"
              label="Second moderator review"
              desc="High severity actions need a second approval"
              initial
            />
          </Group>
          <Group title="Moderator note">
            <div className="py-3">
              <Field id="m-note" label="Guidance shown to moderators">
                <Textarea
                  id="m-note"
                  defaultValue="High severity reports (violence, threats, sexual content) must be resolved within 4 hours. Suspensions need a second review."
                  className="bg-surface-2"
                  rows={3}
                />
              </Field>
            </div>
          </Group>
          <SaveBar />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4 space-y-4">
          <Group title="Automated broadcasts">
            <Toggle
              id="n-daily"
              label="Daily challenge reminder"
              desc="Sent at the same time every day"
              initial
            />
            <SelectRow
              id="n-daily-time"
              label="Reminder time"
              value="08:00 UTC"
              options={["06:00 UTC", "08:00 UTC", "10:00 UTC", "12:00 UTC"]}
            />
            <Toggle
              id="n-recap"
              label="Weekly recap email"
              desc="Scores, streaks and new games every Monday"
              initial
            />
            <Toggle id="n-payout" label="Creator payout reminders" initial />
            <Toggle
              id="n-winback"
              label="Win-back campaign"
              desc="Reach players who have been away for 14 days"
            />
          </Group>
          <Group title="Limits">
            <SelectRow
              id="n-cap"
              label="Max push per player"
              hint="Per day across all campaigns"
              value="3 per day"
              options={["1 per day", "2 per day", "3 per day", "5 per day"]}
            />
            <SelectRow
              id="n-quiet"
              label="Quiet hours"
              value="22:00 – 07:00"
              options={["21:00 – 07:00", "22:00 – 07:00", "23:00 – 08:00", "No quiet hours"]}
            />
            <Toggle
              id="n-region"
              label="Send in player's local time"
              desc="Scheduled messages respect the player's timezone"
              initial
            />
          </Group>
          <Group title="Channels">
            <Toggle id="n-push" label="Push notifications" initial />
            <Toggle id="n-inapp" label="In-app inbox" initial />
            <Toggle id="n-email" label="Email" initial />
          </Group>
          <SaveBar />
        </TabsContent>

        <TabsContent value="platform" className="mt-4 space-y-4">
          <Group title="Games">
            <SelectRow
              id="p-slots"
              label="Featured slots"
              value="6 slots"
              options={["4 slots", "6 slots", "8 slots"]}
            />
            <Toggle
              id="p-verify"
              label="Verify every score"
              desc="Reject runs that fail the runtime check"
              initial
            />
            <SelectRow
              id="p-session"
              label="Max session length"
              hint="Runs are cut off after this"
              value="20 minutes"
              options={["5 minutes", "10 minutes", "20 minutes", "No limit"]}
            />
            <Toggle
              id="p-creators"
              label="Creator submissions open"
              desc="Studios can submit new games and updates"
              initial
            />
          </Group>
          <Group title="Leaderboards">
            <SelectRow
              id="p-refresh"
              label="Refresh interval"
              value="5 minutes"
              options={["1 minute", "5 minutes", "15 minutes", "Hourly"]}
            />
            <Toggle
              id="p-regional"
              label="Regional boards"
              desc="Show country splits alongside global ranks"
              initial
            />
            <Toggle id="p-friends" label="Friends boards" initial />
          </Group>
          <Group title="Feature flags">
            <Toggle
              id="p-streak"
              label="Streak repair"
              desc="Let players restore a broken daily streak"
              initial
            />
            <Toggle
              id="p-offline"
              label="Offline play"
              desc="Cache games for play without a connection"
            />
            <Toggle id="p-payments" label="Creator payouts" desc="Enable the payout dashboard" />
          </Group>
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success">API operational</StatusBadge>
              <StatusBadge tone="warning">Score verification degraded</StatusBadge>
              <StatusBadge tone="muted">Media cache 97% hit</StatusBadge>
            </div>
            <p className={cn("mt-3 text-xs text-muted-foreground")}>
              Environment: prototype · mock data · no backend connected.
            </p>
          </div>
          <SaveBar />
        </TabsContent>
      </Tabs>
    </AdminPage>
  );
}
