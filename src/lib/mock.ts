/**
 * Prototype fixtures for the features that have no backend yet.
 *
 * This module used to hold the game catalogue too. It no longer does: the
 * catalogue is real, served by `services/games` and read through
 * `@/lib/games/catalog`. The seven fabricated games it held — with invented play
 * counts, likes, comment totals, scores, session times and creators — are gone
 * rather than hidden behind a flag, because a screen that can fall back to them
 * is a screen that can show a fabrication as a fact.
 *
 * What remains is what genuinely belongs to unfinished features, and every one of
 * them is a separate phase:
 *
 *   - **public profiles and the follow graph** — there is no public profile
 *     endpoint; `services/users` serves only the caller's own `/users/me`.
 *   - **comments** — no comments service.
 *   - **notifications** — no notifications service.
 *   - **achievements** — nothing records them.
 *
 * Anything here is a placeholder for a feature that does not exist. Nothing that
 * the catalogue API can answer belongs in this file.
 */

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
    replies: [{ id: "c4r1", user: "theo", text: "Coming next update.", time: "20h", likes: 64 }],
  },
];

/**
 * Notifications carry a game *slug* rather than a nested game object, so a screen
 * that links into the catalogue resolves it through the real API instead of
 * reading a copy from here.
 */
export type Notification = {
  id: string;
  type: "like" | "follow" | "comment" | "beat" | "rank" | "system";
  user?: string;
  text: string;
  game?: string;
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

export const achievements = [
  { id: "a1", title: "First clear", desc: "Finish any game", earned: true },
  { id: "a2", title: "Top 1%", desc: "Reach top 1% on any board", earned: true },
  { id: "a3", title: "30-day streak", desc: "Play 7 Second 30 days in a row", earned: false },
  { id: "a4", title: "Perfect chain", desc: "25 links without a miss", earned: true },
  { id: "a5", title: "Explorer", desc: "Play every category", earned: false },
  { id: "a6", title: "Social", desc: "Get 100 followers", earned: true },
];
