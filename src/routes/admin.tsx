import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Unbored" },
      { name: "description", content: "Unbored moderation and operations dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <AdminShell />,
});
