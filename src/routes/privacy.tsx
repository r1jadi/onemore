import { createFileRoute } from "@tanstack/react-router";
import { Page, PageHeader } from "@/components/common";
import { LegalBody, privacy } from "@/components/legal";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () => seo("Privacy Policy", "How Unbored collects, uses and protects your data."),
  component: () => (
    <Page>
      <PageHeader back title="Privacy Policy" />
      <div className="px-4 md:px-0">
        <LegalBody sections={privacy} />
      </div>
    </Page>
  ),
});
