import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — onemore" },
      { name: "description", content: "onemore moderation and operations dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <AdminShell />,
});
