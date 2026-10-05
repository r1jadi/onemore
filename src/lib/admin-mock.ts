// Static mock data for the admin dashboard. UI prototype only — replace with API calls later.
import { categories as publicCategories, games, type GameId } from "./mock";

/* ------------------------------------------------------------------ users */

export type AdminUserStatus = "active" | "suspended" | "flagged" | "pending";
export type AdminRole = "player" | "creator" | "moderator";

export type AdminUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  country: string;
  role: AdminRole;
  status: AdminUserStatus;
  verified: boolean;
  joined: string;
  lastActive: string;
  plays: number;
  reports: number;
  followers: number;
};

export const adminUsers: AdminUser[] = [
  {
    id: "u1",
    username: "nora.k",
    name: "Nora Kowalska",
    email: "nora@mail.com",
    country: "Poland",
    role: "player",
    status: "active",
    verified: true,
    joined: "Mar 14, 2026",
    lastActive: "3m ago",
    plays: 5402,
    reports: 0,
    followers: 18200,
  },
  {
    id: "u2",
    username: "jun",
    name: "Jun Park",
    email: "jun.park@mail.com",
    country: "South Korea",
    role: "player",
    status: "active",
    verified: true,
    joined: "Jan 2, 2026",
    lastActive: "22m ago",
    plays: 6011,
    reports: 0,
    followers: 22100,
  },
  {
    id: "u3",
    username: "lumen.studio",
    name: "Lumen Studio",
    email: "hello@lumen.studio",
    country: "Germany",
    role: "creator",
    status: "active",
    verified: true,
    joined: "Nov 8, 2025",
    lastActive: "1h ago",
    plays: 0,
    reports: 1,
    followers: 48200,
  },
  {
    id: "u4",
    username: "theo",
    name: "Theo Marin",
    email: "theo.m@mail.com",
    country: "France",
    role: "player",
    status: "flagged",
    verified: false,
    joined: "Feb 20, 2026",
    lastActive: "4h ago",
    plays: 3110,
    reports: 3,
    followers: 9400,
  },
  {
    id: "u5",
    username: "ayla",
    name: "Ayla Demir",
    email: "ayla.d@mail.com",
    country: "Türkiye",
    role: "player",
    status: "active",
    verified: false,
    joined: "Apr 1, 2026",
    lastActive: "6h ago",
    plays: 1890,
    reports: 0,
    followers: 4300,
  },
  {
    id: "u6",
    username: "mila",
    name: "Mila Novak",
    email: "mila.n@mail.com",
    country: "Croatia",
    role: "player",
    status: "active",
    verified: false,
    joined: "May 19, 2026",
    lastActive: "1d ago",
    plays: 802,
    reports: 0,
    followers: 1200,
  },
  {
    id: "u7",
    username: "spam.bot",
    name: "Deals Daily",
    email: "promo@deals.biz",
    country: "Unknown",
    role: "player",
    status: "suspended",
    verified: false,
    joined: "Sep 27, 2026",
    lastActive: "2d ago",
    plays: 12,
    reports: 14,
    followers: 3,
  },
  {
    id: "u8",
    username: "sam.r",
    name: "Sam Reyes",
    email: "sam.reyes@mail.com",
    country: "Spain",
    role: "player",
    status: "pending",
    verified: false,
    joined: "Oct 2, 2026",
    lastActive: "5m ago",
    plays: 0,
    reports: 0,
    followers: 0,
  },
  {
    id: "u9",
    username: "tilework",
    name: "Tilework",
    email: "team@tilework.io",
    country: "Netherlands",
    role: "creator",
    status: "active",
    verified: true,
    joined: "Dec 12, 2025",
    lastActive: "9h ago",
    plays: 310,
    reports: 0,
    followers: 12600,
  },
  {
    id: "u10",
    username: "monochrome",
    name: "Monochrome Lab",
    email: "hi@monochrome.dev",
    country: "Sweden",
    role: "creator",
    status: "active",
    verified: true,
    joined: "Oct 3, 2025",
    lastActive: "1d ago",
    plays: 88,
    reports: 0,
    followers: 21400,
  },
  {
    id: "u11",
    username: "boost.king",
    name: "Score Boost",
    email: "boost@mail.com",
    country: "Unknown",
    role: "player",
    status: "suspended",
    verified: false,
    joined: "Aug 11, 2026",
    lastActive: "3d ago",
    plays: 4201,
    reports: 9,
    followers: 112,
  },
  {
    id: "u12",
    username: "quiet.games",
    name: "Quiet Games",
    email: "contact@quiet.games",
    country: "Japan",
    role: "creator",
    status: "active",
    verified: true,
    joined: "Jun 30, 2026",
    lastActive: "12h ago",
    plays: 145,
    reports: 0,
    followers: 8900,
  },
  {
    id: "u13",
    username: "linkhouse",
    name: "Linkhouse",
    email: "studio@linkhouse.co",
    country: "Brazil",
    role: "creator",
    status: "active",
    verified: false,
    joined: "Jul 21, 2026",
    lastActive: "2h ago",
    plays: 640,
    reports: 1,
    followers: 7300,
  },
  {
    id: "u14",
    username: "kira",
    name: "Kira Osei",
    email: "kira.o@mail.com",
    country: "Ghana",
    role: "moderator",
    status: "active",
    verified: true,
    joined: "Feb 2, 2026",
    lastActive: "17m ago",
    plays: 980,
    reports: 0,
    followers: 3400,
  },
];

export type AdminActivity = {
  id: string;
  actor: string;
  action: string;
  subject?: string;
  time: string;
  kind: "user" | "game" | "report" | "comment" | "system";
};

export const adminActivity: AdminActivity[] = [
  {
    id: "a1",
    actor: "kira",
    action: "resolved report",
    subject: "#R-2041",
    time: "2m ago",
    kind: "report",
  },
  {
    id: "a2",
    actor: "nora.k",
    action: "set a new record on",
    subject: "Stack 10",
    time: "9m ago",
    kind: "game",
  },
  {
    id: "a3",
    actor: "jun",
    action: "reported a comment on",
    subject: "Memory Flash",
    time: "24m ago",
    kind: "comment",
  },
  {
    id: "a4",
    actor: "spam.bot",
    action: "was suspended",
    subject: "spam links",
    time: "41m ago",
    kind: "user",
  },
  {
    id: "a5",
    actor: "tilework",
    action: "submitted an update for",
    subject: "Color Merge 2.0",
    time: "1h ago",
    kind: "game",
  },
  {
    id: "a6",
    actor: "monochrome",
    action: "published",
    subject: "Don't Touch the Black",
    time: "3h ago",
    kind: "game",
  },
  {
    id: "a7",
    actor: "boost.king",
    action: "was flagged for",
    subject: "score manipulation",
    time: "5h ago",
    kind: "user",
  },
  {
    id: "a8",
    actor: "system",
    action: "scheduled daily challenge broadcast",
    subject: "7 Second",
    time: "8h ago",
    kind: "system",
  },
];

/* ---------------------------------------------------------------- reports */

export type ReportTarget = "user" | "game" | "comment";
export type ReportStatus = "open" | "resolved" | "dismissed";
export type ReportSeverity = "low" | "medium" | "high";

export type AdminReport = {
  id: string;
  target: ReportTarget;
  targetLabel: string;
  targetDetail: string;
  reporter: string;
  reason: string;
  detail: string;
  time: string;
  status: ReportStatus;
  severity: ReportSeverity;
  game?: GameId;
  assignee?: string;
};

export const adminReports: AdminReport[] = [
  {
    id: "R-2048",
    target: "comment",
    targetLabel: "@theo",
    targetDetail: '"this game is rigged, everyone is cheating lol"',
    reporter: "ayla",
    reason: "Harassment",
    detail: "Third comment from this account on the same game today.",
    time: "12m ago",
    status: "open",
    severity: "medium",
    game: "one-move",
  },
  {
    id: "R-2047",
    target: "user",
    targetLabel: "@boost.king",
    targetDetail: "4,201 plays · 9 reports",
    reporter: "nora.k",
    reason: "Score manipulation",
    detail: "Scores increase faster than the game timer allows.",
    time: "38m ago",
    status: "open",
    severity: "high",
  },
  {
    id: "R-2046",
    target: "game",
    targetLabel: "One Move",
    targetDetail: "Puzzle · @quiet.games",
    reporter: "jun",
    reason: "Broken level",
    detail: "Level 24 has no valid move — soft lock.",
    time: "1h ago",
    status: "open",
    severity: "low",
    game: "one-move",
  },
  {
    id: "R-2045",
    target: "comment",
    targetLabel: "@spam.bot",
    targetDetail: '"free coins → deals.biz"',
    reporter: "mila",
    reason: "Spam / advertising",
    detail: "Same link posted across 6 games.",
    time: "2h ago",
    status: "open",
    severity: "high",
    game: "color-merge",
  },
  {
    id: "R-2044",
    target: "user",
    targetLabel: "@theo",
    targetDetail: "3,110 plays · flagged 3×",
    reporter: "kira",
    reason: "Abusive language",
    detail: "Repeated insults in comments under Memory Flash.",
    time: "3h ago",
    status: "open",
    severity: "medium",
  },
  {
    id: "R-2043",
    target: "game",
    targetLabel: "Memory Flash",
    targetDetail: "Memory · @lumen.studio",
    reporter: "ayla",
    reason: "Inappropriate art",
    detail: "Player reports an asset that looks suggestive at small sizes.",
    time: "6h ago",
    status: "open",
    severity: "medium",
    game: "memory-flash",
  },
  {
    id: "R-2042",
    target: "comment",
    targetLabel: "@nora.k",
    targetDetail: '"took me 30 tries, worth it"',
    reporter: "sam.r",
    reason: "Spam",
    detail: "Reported by mistake, comment looks fine.",
    time: "9h ago",
    status: "dismissed",
    severity: "low",
    game: "stack-10",
    assignee: "kira",
  },
  {
    id: "R-2041",
    target: "user",
    targetLabel: "@spam.bot",
    targetDetail: "12 plays · 14 reports",
    reporter: "theo",
    reason: "Fake account",
    detail: "Account created 6 days ago, only posts links.",
    time: "1d ago",
    status: "resolved",
    severity: "high",
    assignee: "kira",
  },
  {
    id: "R-2040",
    target: "game",
    targetLabel: "Don't Break the Chain",
    targetDetail: "Reaction · @linkhouse",
    reporter: "mila",
    reason: "Misleading metadata",
    detail: "Tagged as Memory, plays like a reaction game.",
    time: "1d ago",
    status: "resolved",
    severity: "low",
    game: "dont-break-the-chain",
    assignee: "kira",
  },
  {
    id: "R-2039",
    target: "comment",
    targetLabel: "@ayla",
    targetDetail: '"same here, finally did it"',
    reporter: "theo",
    reason: "Off topic",
    detail: "Nothing actionable.",
    time: "2d ago",
    status: "dismissed",
    severity: "low",
    game: "stack-10",
    assignee: "kira",
  },
  {
    id: "R-2038",
    target: "user",
    targetLabel: "@kira",
    targetDetail: "Moderator account",
    reporter: "boost.king",
    reason: "Abuse of power",
    detail: "Retaliatory report after a suspension.",
    time: "2d ago",
    status: "dismissed",
    severity: "low",
    assignee: "kira",
  },
  {
    id: "R-2037",
    target: "game",
    targetLabel: "7 Second",
    targetDetail: "Daily · @onemore",
    reporter: "sam.r",
    reason: "Timer bug",
    detail: "Run ended with 2 seconds left on the clock.",
    time: "3d ago",
    status: "resolved",
    severity: "medium",
    game: "7-second",
    assignee: "kira",
  },
];

/* --------------------------------------------------------------- comments */

export type AdminComment = {
  id: string;
  user: string;
  text: string;
  game: GameId;
  time: string;
  likes: number;
  reports: number;
  hidden: boolean;
  score?: number;
};

export const adminComments: AdminComment[] = [
  {
    id: "c1",
    user: "nora.k",
    text: "The jump from level 8 to 9 is brutal. Took me 30 tries.",
    game: "stack-10",
    time: "2h ago",
    likes: 412,
    reports: 0,
    hidden: false,
    score: 4820,
  },
  {
    id: "c2",
    user: "spam.bot",
    text: "free coins → deals.biz click fast",
    game: "color-merge",
    time: "2h ago",
    likes: 0,
    reports: 6,
    hidden: false,
  },
  {
    id: "c3",
    user: "jun",
    text: "Clean. Would play a daily version of this.",
    game: "one-move",
    time: "4h ago",
    likes: 230,
    reports: 0,
    hidden: false,
  },
  {
    id: "c4",
    user: "theo",
    text: "everyone above rank 50 is cheating, this is rigged lol",
    game: "one-move",
    time: "5h ago",
    likes: 12,
    reports: 3,
    hidden: false,
  },
  {
    id: "c5",
    user: "mila",
    text: "One more. Always one more.",
    game: "dont-touch-the-black",
    time: "6h ago",
    likes: 97,
    reports: 0,
    hidden: false,
    score: 1960,
  },
  {
    id: "c6",
    user: "sam.r",
    text: "Is there a colorblind mode?",
    game: "color-merge",
    time: "1d ago",
    likes: 41,
    reports: 0,
    hidden: false,
  },
  {
    id: "c7",
    user: "boost.king",
    text: "selling accounts with 10k+ scores, dm me",
    game: "memory-flash",
    time: "1d ago",
    likes: 2,
    reports: 9,
    hidden: true,
  },
  {
    id: "c8",
    user: "ayla",
    text: "Day 46 streak on the daily. Not stopping.",
    game: "7-second",
    time: "1d ago",
    likes: 318,
    reports: 0,
    hidden: false,
    score: 812,
  },
  {
    id: "c9",
    user: "kira",
    text: "Reminder: screenshots of bugs help us fix them faster.",
    game: "memory-flash",
    time: "2d ago",
    likes: 152,
    reports: 0,
    hidden: false,
  },
  {
    id: "c10",
    user: "linkhouse",
    text: "Hard mode is coming to the chain next week.",
    game: "dont-break-the-chain",
    time: "2d ago",
    likes: 204,
    reports: 0,
    hidden: false,
  },
  {
    id: "c11",
    user: "theo",
    text: "beat my score or stop posting",
    game: "stack-10",
    time: "3d ago",
    likes: 4,
    reports: 2,
    hidden: false,
  },
  {
    id: "c12",
    user: "quiet.games",
    text: "Level 24 fix is rolling out tonight.",
    game: "one-move",
    time: "3d ago",
    likes: 89,
    reports: 0,
    hidden: false,
  },
];

/* ------------------------------------------------------------- submissions */

export type SubmissionStatus = "pending" | "changes" | "approved" | "rejected";

export type AdminSubmission = {
  id: string;
  gameId: GameId;
  title: string;
  creator: string;
  kind: "New game" | "Update" | "Level pack";
  submitted: string;
  status: SubmissionStatus;
  notes: string;
  category: string;
  size: string;
  version: string;
  reviewedBy?: string;
};

export const adminSubmissions: AdminSubmission[] = [
  {
    id: "S-118",
    gameId: "color-merge",
    title: "Color Merge 2.0",
    creator: "tilework",
    kind: "Update",
    submitted: "1h ago",
    status: "pending",
    notes: "New merge tier, rebalanced board size, dark board theme.",
    category: "Puzzle",
    size: "1.8 MB",
    version: "2.0.0",
  },
  {
    id: "S-117",
    gameId: "memory-flash",
    title: "Memory Flash — Endless",
    creator: "lumen.studio",
    kind: "Update",
    submitted: "5h ago",
    status: "pending",
    notes: "Adds an endless mode with a rising difficulty curve.",
    category: "Memory",
    size: "2.4 MB",
    version: "1.6.0",
  },
  {
    id: "S-116",
    gameId: "one-move",
    title: "One Move: Week 12 set",
    creator: "quiet.games",
    kind: "Level pack",
    submitted: "1d ago",
    status: "pending",
    notes: "Seven new single-solution levels, all verified.",
    category: "Logic",
    size: "640 KB",
    version: "0.9.4",
  },
  {
    id: "S-115",
    gameId: "dont-break-the-chain",
    title: "Chain: Hard Mode",
    creator: "linkhouse",
    kind: "Update",
    submitted: "2d ago",
    status: "changes",
    notes: "Adds a 25-link hard mode. Awaiting a difficulty pass.",
    category: "Reaction",
    size: "1.2 MB",
    version: "1.3.0",
    reviewedBy: "kira",
  },
  {
    id: "S-114",
    gameId: "dont-touch-the-black",
    title: "Black: Daily ladder",
    creator: "monochrome",
    kind: "Update",
    submitted: "3d ago",
    status: "approved",
    notes: "Daily ladder boards with regional splits.",
    category: "Arcade",
    size: "900 KB",
    version: "3.1.0",
    reviewedBy: "kira",
  },
];

/* ---------------------------------------------------------- notifications */

export type AdminNotification = {
  id: string;
  title: string;
  body: string;
  audience: string;
  channel: "push" | "in-app" | "email";
  status: "sent" | "scheduled" | "draft";
  when: string;
  delivered?: number;
  opened?: number;
};

export const adminNotifications: AdminNotification[] = [
  {
    id: "N-311",
    title: "Today's 7 Second challenge is live",
    body: "One attempt per day. Beat yesterday's 812.",
    audience: "All players",
    channel: "push",
    status: "sent",
    when: "Today, 08:00",
    delivered: 412890,
    opened: 189443,
  },
  {
    id: "N-310",
    title: "New game: One Move",
    body: "One move. One solution. Try the new logic game.",
    audience: "Logic + Puzzle",
    channel: "in-app",
    status: "sent",
    when: "Yesterday, 17:30",
    delivered: 128441,
    opened: 41120,
  },
  {
    id: "N-309",
    title: "Weekly recap is ready",
    body: "You played 14 games and set 3 personal bests.",
    audience: "Active players",
    channel: "email",
    status: "sent",
    when: "Mon, 09:00",
    delivered: 208773,
    opened: 92110,
  },
  {
    id: "N-312",
    title: "Chain: Hard Mode arrives",
    body: "25 links. No mistakes. Are you in?",
    audience: "Reaction players",
    channel: "push",
    status: "scheduled",
    when: "Tomorrow, 18:00",
  },
  {
    id: "N-313",
    title: "Creator payout window",
    body: "October payouts open on the 20th.",
    audience: "Creators",
    channel: "email",
    status: "scheduled",
    when: "Oct 20, 10:00",
  },
  {
    id: "N-314",
    title: "Platform maintenance",
    body: "A short maintenance break on Sunday at 03:00 UTC.",
    audience: "All players",
    channel: "in-app",
    status: "scheduled",
    when: "Oct 11, 03:00",
  },
  {
    id: "N-315",
    title: "Streak repair is here",
    body: "Missed a day? Restore your daily streak.",
    audience: "Daily players",
    channel: "in-app",
    status: "draft",
    when: "Not scheduled",
  },
  {
    id: "N-316",
    title: "October creator spotlight",
    body: "Meet the studios behind this month's games.",
    audience: "All players",
    channel: "in-app",
    status: "draft",
    when: "Not scheduled",
  },
];

/* -------------------------------------------------------------- categories */

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  games: number;
  visible: boolean;
  hue?: string;
};

export const adminCategories: AdminCategory[] = publicCategories.map((c, i) => ({
  id: `cat-${i + 1}`,
  slug: c.slug,
  name: c.name,
  description:
    {
      puzzle: "Match, merge and clear. The biggest shelf on the platform.",
      arcade: "Fast reflexes, short runs, instant restarts.",
      logic: "One correct answer per level. Think before you tap.",
      reaction: "Speed and timing against a shrinking clock.",
      memory: "Patterns, sequences and things you only see once.",
      daily: "One shared challenge every day for everyone.",
      word: "Letters, anagrams and vocabulary races.",
      strategy: "Plan a few moves ahead and outlast the board.",
    }[c.slug] ?? "Games in this category.",
  games: c.count,
  visible: true,
}));

/* ---------------------------------------------------------------- featured */

export type FeaturedSlot = {
  id: GameId;
  title: string;
  creator: string;
  plays: number;
  rank: number;
};

export const featuredGames: FeaturedSlot[] = [
  { id: "7-second", title: "7 Second", creator: "onemore", plays: 1560000, rank: 1 },
  {
    id: "dont-touch-the-black",
    title: "Don't Touch the Black",
    creator: "monochrome",
    plays: 2310000,
    rank: 2,
  },
  { id: "stack-10", title: "Stack 10", creator: "lumen.studio", plays: 1284000, rank: 3 },
  { id: "memory-flash", title: "Memory Flash", creator: "lumen.studio", plays: 803000, rank: 4 },
  { id: "one-move", title: "One Move", creator: "quiet.games", plays: 512000, rank: 5 },
];

export const featureableGames = games.filter((g) => !featuredGames.some((f) => f.id === g.id));

/* ------------------------------------------------------------- leaderboard */

export type AdminScoreRow = {
  rank: number;
  user: string;
  score: number;
  plays: number;
  country: string;
  flagged?: boolean;
  time: string;
};

export const adminScores: AdminScoreRow[] = [
  { rank: 1, user: "nora.k", score: 4820, plays: 96, country: "Poland", time: "2h ago" },
  { rank: 2, user: "jun", score: 4610, plays: 142, country: "South Korea", time: "5h ago" },
  { rank: 3, user: "theo", score: 4402, plays: 88, country: "France", time: "1d ago" },
  { rank: 4, user: "ayla", score: 3980, plays: 61, country: "Türkiye", time: "1d ago" },
  { rank: 5, user: "mila", score: 3720, plays: 54, country: "Croatia", time: "2d ago" },
  { rank: 6, user: "sam.r", score: 3305, plays: 40, country: "Spain", time: "2d ago" },
  { rank: 7, user: "lumen.studio", score: 3011, plays: 22, country: "Germany", time: "3d ago" },
  { rank: 8, user: "kira", score: 2870, plays: 35, country: "Ghana", time: "3d ago" },
  {
    rank: 9,
    user: "boost.king",
    score: 9810,
    plays: 402,
    country: "Unknown",
    flagged: true,
    time: "12m ago",
  },
  { rank: 10, user: "quiet.games", score: 1980, plays: 18, country: "Japan", time: "4d ago" },
];

/* -------------------------------------------------------------- analytics */

export const overviewStats = {
  totalUsers: 1284412,
  activeUsers: 412890,
  games: 481,
  gamesPlayed: 18402113,
  avgSession: "2m 41s",
  openReports: 6,
  pendingReview: 3,
  newUsersToday: 8420,
  deltas: {
    totalUsers: "+3.1%",
    activeUsers: "+1.4%",
    gamesPlayed: "+5.8%",
    avgSession: "-0.4%",
    openReports: "-2 today",
  },
};

export const analyticsSeries = [
  { day: "Sep 22", users: 382100, sessions: 1120400, plays: 1204300 },
  { day: "Sep 23", users: 390220, sessions: 1188300, plays: 1261000 },
  { day: "Sep 24", users: 387410, sessions: 1144200, plays: 1228400 },
  { day: "Sep 25", users: 401900, sessions: 1240300, plays: 1331900 },
  { day: "Sep 26", users: 418200, sessions: 1331900, plays: 1428400 },
  { day: "Sep 27", users: 432100, sessions: 1412400, plays: 1520900 },
  { day: "Sep 28", users: 424600, sessions: 1368200, plays: 1464100 },
  { day: "Sep 29", users: 408300, sessions: 1241900, plays: 1338400 },
  { day: "Sep 30", users: 399400, sessions: 1192400, plays: 1277300 },
  { day: "Oct 1", users: 404800, sessions: 1230300, plays: 1328800 },
  { day: "Oct 2", users: 410200, sessions: 1278400, plays: 1364400 },
  { day: "Oct 3", users: 416900, sessions: 1310200, plays: 1419200 },
  { day: "Oct 4", users: 409800, sessions: 1264200, plays: 1380900 },
  { day: "Oct 5", users: 412890, sessions: 1291800, plays: 1401600 },
];

export const retention = [
  { label: "Day 1", value: 62, change: "+1.2%" },
  { label: "Day 3", value: 41, change: "+0.4%" },
  { label: "Day 7", value: 28, change: "-0.6%" },
  { label: "Day 14", value: 19, change: "+0.2%" },
  { label: "Day 30", value: 12, change: "-0.1%" },
];

export const popularGames = [
  {
    id: "dont-touch-the-black" as GameId,
    title: "Don't Touch the Black",
    plays: 412400,
    change: "+8.2%",
  },
  { id: "7-second" as GameId, title: "7 Second", plays: 388100, change: "+2.4%" },
  { id: "stack-10" as GameId, title: "Stack 10", plays: 291400, change: "+5.1%" },
  { id: "color-merge" as GameId, title: "Color Merge", plays: 188200, change: "-1.8%" },
  { id: "memory-flash" as GameId, title: "Memory Flash", plays: 164900, change: "+0.9%" },
  { id: "one-move" as GameId, title: "One Move", plays: 142300, change: "+6.7%" },
  {
    id: "dont-break-the-chain" as GameId,
    title: "Don't Break the Chain",
    plays: 121800,
    change: "+3.3%",
  },
];

export const playsByHour = [
  { hour: "00", plays: 41200 },
  { hour: "03", plays: 22800 },
  { hour: "06", plays: 38400 },
  { hour: "09", plays: 74200 },
  { hour: "12", plays: 109400 },
  { hour: "15", plays: 126800 },
  { hour: "18", plays: 148200 },
  { hour: "21", plays: 119600 },
];

export const engagement = {
  avgSession: "2m 41s",
  sessionsPerUser: "4.6",
  dauMau: "32%",
  weeklyNewUsers: 58420,
  streakKeepers: 182400,
  creatorSubmissions: 42,
};

/* ----------------------------------------------------------------- system */

export type ServiceStatus = "operational" | "degraded" | "maintenance";

export const systemServices: {
  name: string;
  status: ServiceStatus;
  uptime: string;
  latency: string;
  note: string;
}[] = [
  {
    name: "Public API",
    status: "operational",
    uptime: "99.98%",
    latency: "82 ms",
    note: "Last incident 21 days ago",
  },
  {
    name: "Game runtime",
    status: "operational",
    uptime: "99.95%",
    latency: "140 ms",
    note: "12,840 active sessions",
  },
  {
    name: "Realtime & leaderboards",
    status: "operational",
    uptime: "99.99%",
    latency: "36 ms",
    note: "Fan-out queue: 1,204 msgs/s",
  },
  {
    name: "Score verification",
    status: "degraded",
    uptime: "99.42%",
    latency: "410 ms",
    note: "Backlog of 214 runs",
  },
  {
    name: "Notifications",
    status: "operational",
    uptime: "99.97%",
    latency: "120 ms",
    note: "Queue empty",
  },
  {
    name: "Media & CDN",
    status: "operational",
    uptime: "100%",
    latency: "18 ms",
    note: "Cache hit rate 97%",
  },
];
