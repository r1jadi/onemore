export const seo = (title: string, description: string) => ({
  meta: [
    { title: `${title} — onemore` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — onemore` },
    { property: "og:description", content: description },
  ],
});
