// Placeholder legal copy for the prototype. Replace with reviewed legal text before launch.
export const terms = [
  [
    "1. Using onemore",
    "You must be at least 13 years old to create an account. You're responsible for activity on your account and for keeping your password secure.",
  ],
  [
    "2. Your content",
    "Usernames, comments and profile information you post remain yours. You grant onemore a licence to display them within the service.",
  ],
  [
    "3. Fair play",
    "Scores must be earned by playing. Automated play, exploiting bugs or manipulating leaderboards may lead to score removal or suspension.",
  ],
  [
    "4. Community rules",
    "No harassment, hate speech, spam or impersonation. We may remove content or restrict accounts that break these rules.",
  ],
  [
    "5. Games by creators",
    "Games are made by onemore and independent creators. Creators are responsible for their games and must follow our publishing guidelines.",
  ],
  [
    "6. Termination",
    "You can delete your account at any time. We may suspend accounts that violate these terms.",
  ],
  [
    "7. Changes",
    "We'll notify you of material changes to these terms in the app before they take effect.",
  ],
];

export const privacy = [
  [
    "What we collect",
    "Account details (email, username), gameplay data (scores, sessions), social activity (follows, likes, comments) and basic device information.",
  ],
  [
    "How we use it",
    "To run leaderboards, recommend games, keep the platform safe and improve the product. We don't sell your personal data.",
  ],
  [
    "Who can see it",
    "Your profile, scores and comments are public by default. You can make your account private in Settings → Privacy.",
  ],
  [
    "Your choices",
    "You can download or delete your data, control notifications and limit personalised recommendations at any time.",
  ],
  [
    "Retention",
    "We keep data while your account is active and delete it within 30 days after account deletion, except where required by law.",
  ],
  ["Contact", "Questions about privacy can be sent to privacy@onemore.app."],
];

export function LegalBody({ sections }: { sections: string[][] }) {
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <p className="text-xs text-muted-foreground">Last updated October 1, 2026</p>
      {sections.map(([h, b]) => (
        <section key={h}>
          <h2 className="font-semibold">{h}</h2>
          <p className="mt-1 text-muted-foreground">{b}</p>
        </section>
      ))}
    </div>
  );
}
