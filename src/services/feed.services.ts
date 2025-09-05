import { Request, Response } from "express";
import type { ReactionKey, Visibility } from "../models/enums";

type UserMeta = {
  handle: string;
  name: string;
  avatar: string;
};

type Interactions = Record<ReactionKey, number>;

type ViewerState = {
  saved: boolean;
  reaction?: ReactionKey;
};

type PostDTO = {
  id: string;
  user: UserMeta;
  caption: string;
  music: string;
  interactions: Interactions;
  comments: number;
  saves: number;
  thumbnail: string;
  tags: string[];
  videoSrc: string;
  visibility: Visibility;
  allowComments: boolean;
  orgViewIds?: string[];
  createdAt: string;
  updatedAt: string;
  viewer?: ViewerState;
};

// Sample mock data. In a real implementation, fetch from DB.
const baseNow = new Date();
const iso = (d: Date) => d.toISOString();

const SAMPLE_DATA: PostDTO[] = [
  {
    id: "p1",
    user: {
      handle: "@lumina.ai",
      name: "Lumina",
      avatar: "https://i.pravatar.cc/100?img=1",
    },
    caption: "AI lights that sync with your mood ✨",
    music: "lofi • midnight drive",
    interactions: {
      like: 9800,
      love: 1800,
      haha: 400,
      sad: 150,
      angry: 150,
    },
    comments: 632,
    saves: 940,
    thumbnail:
      "https://images.unsplash.com/photo-1518779578993-ec3579fee39f?q=80&w=1600&auto=format&fit=crop",
    tags: ["#ai", "#setup", "#aesthetic"],
    videoSrc: "/test.mp4",
    visibility: "Public",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 1 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 1 * 1800_000)),
    viewer: { saved: true, reaction: "like" },
  },
  {
    id: "p2",
    user: {
      handle: "@chef.jun",
      name: "Chef Jun",
      avatar: "https://i.pravatar.cc/100?img=12",
    },
    caption: "10-min ramen hack that actually slaps 🍜",
    music: "city pop • summer night",
    interactions: {
      like: 7000,
      love: 1800,
      haha: 300,
      sad: 150,
      angry: 126,
    },
    comments: 421,
    saves: 1205,
    thumbnail:
      "https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?q=80&w=1600&auto=format&fit=crop",
    tags: ["#ramen", "#hack", "#homecooking"],
    videoSrc: "/Download.mp4",
    visibility: "Friends",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 2 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 2 * 1800_000)),
    viewer: { saved: false, reaction: "love" },
  },
  {
    id: "p3",
    user: {
      handle: "@move.studio",
      name: "Move Studio",
      avatar: "https://i.pravatar.cc/100?img=33",
    },
    caption: "5-min posture reset for desk goblins 🧘‍♀️",
    music: "ambient • sea breeze",
    interactions: {
      like: 15000,
      love: 30000,
      haha: 400,
      sad: 240,
      angry: 900,
    },
    comments: 1170,
    saves: 3802,
    thumbnail:
      "https://images.unsplash.com/photo-1519823551278-64ac92734fb1?q=80&w=1600&auto=format&fit=crop",
    tags: ["#wellness", "#stretch", "#desk"],
    videoSrc: "/Download (1).mp4",
    visibility: "Organizations",
    allowComments: true,
    orgViewIds: [
      "org_7c9d6f14-9e5e-4a3a-8a71-a8b5f2b3a1c0",
      "org_ba4dc197-8d3b-4a21-8be9-86b2a6b1c2d3",
    ],
    createdAt: iso(new Date(baseNow.getTime() - 3 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 3 * 1800_000)),
    viewer: { saved: true },
  },
  {
    id: "p4",
    user: {
      handle: "@urban.vibes",
      name: "Urban Vibes",
      avatar: "https://i.pravatar.cc/100?img=45",
    },
    caption: "City night timelapse with chill beats 🌃",
    music: "chillhop • late night",
    interactions: {
      like: 11000,
      love: 2600,
      haha: 400,
      sad: 234,
      angry: 400,
    },
    comments: 389,
    saves: 1287,
    thumbnail:
      "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?q=80&w=1600&auto=format&fit=crop",
    tags: ["#city", "#timelapse", "#vibes"],
    videoSrc: "/Download (2).mp4",
    visibility: "Private",
    allowComments: false,
    createdAt: iso(new Date(baseNow.getTime() - 4 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 4 * 1800_000)),
    viewer: { saved: false },
  },
  {
    id: "p5",
    user: {
      handle: "@bear.vibes",
      name: "Bear Vibes",
      avatar: "https://i.pravatar.cc/100?img=45",
    },
    caption: "City night timelapse with chill beats 🌃",
    music: "chillhop • late night",
    interactions: {
      like: 800,
      love: 150,
      haha: 3000,
      sad: 30,
      angry: 31,
    },
    comments: 333,
    saves: 1234,
    thumbnail:
      "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?q=80&w=1600&auto=format&fit=crop",
    tags: ["#example"],
    videoSrc: "/mov_bbb.mp4",
    visibility: "Public",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 5 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 5 * 1800_000)),
    viewer: { saved: false, reaction: "haha" },
  },
];

function parseLimit(raw: unknown, def = 10, min = 1, max = 50) {
  const n = typeof raw === "string" ? parseInt(raw, 10) : def;
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function startIndexFromCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  // Try matching by ID first
  const byId = SAMPLE_DATA.findIndex((p) => p.id === cursor);
  if (byId >= 0) return byId + 1; // start after the cursor item

  // Fallback: allow base64-encoded index
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const idx = parseInt(decoded, 10);
    if (!Number.isNaN(idx) && idx >= 0) return idx;
  } catch {}
  return 0;
}

export async function getFeed(req: Request, res: Response) {
  try {
    const algoRaw = (req.query.algo as string) || "for-you";
    const algo = algoRaw === "following" ? "following" : "for-you"; // default to for-you
    const limit = parseLimit(req.query.limit);
    const start = startIndexFromCursor((req.query.cursor as string) || undefined);

    // For mock: both algos return same ordering; slot for future differentiation
    const ordered = [...SAMPLE_DATA];

    const items = ordered.slice(start, start + limit);
    const endIndex = start + items.length;
    const hasMore = endIndex < ordered.length;
    const nextCursor = hasMore ? ordered[endIndex - 1].id : null;

    return res.json({
      algo,
      items,
      paging: {
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong!" });
  }
}
