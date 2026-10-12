// Static mock data for the UI prototype. Replace with API calls later.

export type GameId =
  | "stack-10"
  | "color-merge"
  | "dont-touch-the-black"
  | "one-move"
  | "dont-break-the-chain"
  | "memory-flash"
  | "7-second";

export type Game = {
  id: GameId;
  title: string;
  tagline: string;
  description: string;
  category: string;
  creator: string;
  hue: string; // tailwind token name for game identity
  plays: number;
  likes: number;
  comments: number;
  saves: number;
  bestScore: number;
  yourBest?: number;
  avgSession: string;
  isNew?: boolean;
  isDaily?: boolean;
  status: "published" | "review" | "draft" | "rejected";
};

export const games: Game[] = [
  {
    id: "stack-10",
    title: "Stack 10",
    tagline: "Make every column add up to ten.",
    description:
      "Drop numbered tiles into columns. Hit exactly ten to clear. Overflow and it's over.",
    category: "Puzzle",
    creator: "lumen.studio",
    hue: "game-1",
    plays: 1284000,
    likes: 98400,
    comments: 2310,
    saves: 14200,
    bestScore: 4820,
    yourBest: 2140,
    avgSession: "2m 40s",
    status: "published",
  },
  {
    id: "color-merge",
    title: "Color Merge",
    tagline: "Merge matching tiles. Fill nothing.",
    description:
      "Slide the grid, merge equal colors into the next shade. Run out of moves and the board locks.",
    category: "Puzzle",
    creator: "tilework",
    hue: "game-2",
    plays: 942000,
    likes: 71200,
    comments: 1840,
    saves: 9800,
    bestScore: 12960,
    yourBest: 6400,
    avgSession: "3m 10s",
    status: "published",
  },
  {
    id: "dont-touch-the-black",
    title: "Don't Touch the Black",
    tagline: "Tap white. Only white.",
    description: "Rows scroll faster every second. One wrong tap ends the run.",
    category: "Arcade",
    creator: "monochrome",
    hue: "game-3",
    plays: 2310000,
    likes: 184000,
    comments: 5120,
    saves: 22100,
    bestScore: 312,
    yourBest: 148,
    avgSession: "48s",
    status: "published",
  },
  {
    id: "one-move",
    title: "One Move",
    tagline: "One move. One solution.",
    description: "Each level has exactly one move that solves it. Find it.",
    category: "Logic",
    creator: "quiet.games",
    hue: "game-4",
    plays: 512000,
    likes: 40100,
    comments: 1290,
    saves: 7600,
    bestScore: 240,
    avgSession: "1m 55s",
    isNew: true,
    status: "published",
  },
  {
    id: "dont-break-the-chain",
    title: "Don't Break the Chain",
    tagline: "Repeat the chain. Add one more.",
    description: "Watch the sequence, repeat it, survive the next link. Reaction meets memory.",
    category: "Reaction",
    creator: "linkhouse",
    hue: "game-5",
    plays: 688000,
    likes: 52300,
    comments: 1630,
    saves: 8100,
    bestScore: 41,
    yourBest: 17,
    avgSession: "1m 20s",
    isNew: true,
    status: "published",
  },
  {
    id: "memory-flash",
    title: "Memory Flash",
    tagline: "See it once. Rebuild it.",
    description: "A pattern flashes for half a second. Rebuild it cell by cell.",
    category: "Memory",
    creator: "lumen.studio",
    hue: "game-6",
    plays: 803000,
    likes: 60900,
    comments: 1420,
    saves: 11300,
    bestScore: 28,
    yourBest: 12,
    avgSession: "2m 05s",
    status: "published",
  },
  {
    id: "7-second",
    title: "7 Second",
    tagline: "Today's challenge. Seven seconds.",
    description: "A new micro challenge every day. You get one attempt per day to set your score.",
    category: "Daily",
    creator: "onemore",
    hue: "game-7",
    plays: 1560000,
    likes: 132000,
    comments: 4380,
    saves: 18700,
    bestScore: 999,
    avgSession: "7s",
    isDaily: true,
    status: "published",
  },
];

export const getGame = (id: string) => games.find((g) => g.id === id) ?? games[0];

export type User = {
  username: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  played: number;
  verified?: boolean;
  isFollowing?: boolean;
};

export const me: User = {
  username: "rijad",
  name: "Rijad Halili",
  bio: "Puzzles in the morning, arcade at night.",
  followers: 1284,
  following: 312,
  played: 2147,
};

export const users: User[] = [
  {
    username: "nora.k",
    name: "Nora Kowalska",
    bio: "Top 50 on Stack 10.",
    followers: 18200,
    following: 210,
    played: 5402,
    verified: true,
    isFollowing: true,
  },
  {
    username: "theo",
    name: "Theo Marin",
    bio: "Speedrunning everything.",
    followers: 9400,
    following: 88,
    played: 3110,
    isFollowing: true,
  },
  {
    username: "ayla",
    name: "Ayla Demir",
    bio: "Memory games only.",
    followers: 4300,
    following: 402,
    played: 1890,
  },
  {
    username: "jun",
    name: "Jun Park",
    bio: "Daily 7 Second streak: 142.",
    followers: 22100,
    following: 64,
    played: 6011,
    verified: true,
  },
  {
    username: "mila",
    name: "Mila Novak",
    bio: "Casual, competitive about it.",
    followers: 1200,
    following: 340,
    played: 802,
    isFollowing: true,
  },
  { username: "sam.r", name: "Sam Reyes", bio: "", followers: 640, following: 120, played: 410 },
  {
    username: "lumen.studio",
    name: "Lumen Studio",
    bio: "We make small games.",
    followers: 48200,
    following: 12,
    played: 0,
    verified: true,
  },
];

export const getUser = (u: string) =>
  users.find((x) => x.username === u) ?? { ...users[0], username: u };

export type Comment = {
  id: string;
  user: string;
  text: string;
  time: string;
  likes: number;
  score?: number;
  replies?: Comment[];
};

export const comments: Comment[] = [
  {
    id: "c1",
    user: "nora.k",
    text: "The jump from level 8 to 9 is brutal. Took me 30 tries.",
    time: "2h",
    likes: 412,
    score: 4820,
    replies: [
      {
        id: "c1r1",
        user: "theo",
        text: "Start from the right column. Trust me.",
        time: "1h",
        likes: 88,
      },
      { id: "c1r2", user: "ayla", text: "Same here, finally did it.", time: "40m", likes: 12 },
    ],
  },
  {
    id: "c2",
    user: "jun",
    text: "Clean. Would play a daily version of this.",
    time: "4h",
    likes: 230,
  },
  {
    id: "c3",
    user: "mila",
    text: "One more. Always one more.",
    time: "6h",
    likes: 97,
    score: 1960,
  },
  {
    id: "c4",
    user: "sam.r",
    text: "Is there a colorblind mode?",
    time: "1d",
    likes: 41,
    replies: [
      { id: "c4r1", user: "lumen.studio", text: "Coming next update.", time: "20h", likes: 64 },
    ],
  },
];

export type Notification = {
  id: string;
  type: "like" | "follow" | "comment" | "beat" | "rank" | "system";
  user?: string;
  text: string;
  game?: GameId;
  time: string;
  unread?: boolean;
};

export const notifications: Notification[] = [
  {
    id: "n1",
    type: "beat",
    user: "nora.k",
    text: "beat your score on Stack 10",
    game: "stack-10",
    time: "3m",
    unread: true,
  },
  {
    id: "n2",
    type: "follow",
    user: "ayla",
    text: "started following you",
    time: "18m",
    unread: true,
  },
  {
    id: "n3",
    type: "comment",
    user: "theo",
    text: 'replied: "Start from the right column."',
    game: "stack-10",
    time: "1h",
    unread: true,
  },
  {
    id: "n4",
    type: "rank",
    text: "You're now #212 globally on Color Merge",
    game: "color-merge",
    time: "3h",
  },
  {
    id: "n5",
    type: "like",
    user: "jun",
    text: "liked your score on Memory Flash",
    game: "memory-flash",
    time: "5h",
  },
  {
    id: "n6",
    type: "system",
    text: "Today's 7 Second challenge is live",
    game: "7-second",
    time: "8h",
  },
  { id: "n7", type: "follow", user: "mila", text: "started following you", time: "1d" },
];

export const leaderboard = [
  { rank: 1, user: "nora.k", score: 4820 },
  { rank: 2, user: "jun", score: 4610 },
  { rank: 3, user: "theo", score: 4402 },
  { rank: 4, user: "ayla", score: 3980 },
  { rank: 5, user: "mila", score: 3720 },
  { rank: 6, user: "sam.r", score: 3305 },
  { rank: 7, user: "lumen.studio", score: 3011 },
];

export const achievements = [
  { id: "a1", title: "First clear", desc: "Finish any game", earned: true },
  { id: "a2", title: "Top 1%", desc: "Reach top 1% on any board", earned: true },
  { id: "a3", title: "30-day streak", desc: "Play 7 Second 30 days in a row", earned: false },
  { id: "a4", title: "Perfect chain", desc: "25 links without a miss", earned: true },
  { id: "a5", title: "Explorer", desc: "Play every category", earned: false },
  { id: "a6", title: "Social", desc: "Get 100 followers", earned: true },
];

export const categories = [
  { slug: "puzzle", name: "Puzzle", count: 142 },
  { slug: "arcade", name: "Arcade", count: 98 },
  { slug: "logic", name: "Logic", count: 64 },
  { slug: "reaction", name: "Reaction", count: 57 },
  { slug: "memory", name: "Memory", count: 41 },
  { slug: "daily", name: "Daily", count: 12 },
  { slug: "word", name: "Word", count: 38 },
  { slug: "strategy", name: "Strategy", count: 29 },
];

export const fmt = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
      : `${n}`;
