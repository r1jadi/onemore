import { createFileRoute } from "@tanstack/react-router";
import { Page, PageHeader } from "@/components/common";
import { LegalBody, terms } from "@/components/legal";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/terms")({
  head: () => seo("Terms & Conditions", "The rules for using onemore."),
  component: () => (
    <Page>
      <PageHeader back title="Terms & Conditions" />
      <div className="px-4 md:px-0">
        <LegalBody sections={terms} />
      </div>
    </Page>
  ),
});
