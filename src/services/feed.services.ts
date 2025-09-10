import { Request, Response } from "express";
import type { ReactionKey, Visibility } from "../models/enums";
import { PostModel, UserModel } from "../models";

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
    thumbnail: "http://192.168.1.11:8000/media/photo/Download (1)",
    tags: ["#ai", "#setup", "#aesthetic"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/Download (1)",
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
    thumbnail: "http://192.168.1.11:8000/media/photo/IMG_1834",
    tags: ["#ramen", "#hack", "#homecooking"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/IMG_1834",
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
      "http://192.168.1.11:8000/media/photo/copy_3BE6AC74-2144-4EBE-B1E6-E8EAA81F1CE8",
    tags: ["#wellness", "#stretch", "#desk"],
    videoSrc:
      "http://192.168.1.11:8000/media/firstbucket/copy_3BE6AC74-2144-4EBE-B1E6-E8EAA81F1CE8",
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
    thumbnail: "http://192.168.1.11:8000/media/photo/test",
    tags: ["#city", "#timelapse", "#vibes"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/test",
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
    thumbnail: "http://192.168.1.11:8000/media/photo/export_1713134609950",
    tags: ["#example"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/export_1713134609950",
    visibility: "Public",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 5 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 5 * 1800_000)),
    viewer: { saved: false, reaction: "haha" },
  },
  {
    id: "p6",
    user: {
      handle: "@media.bot",
      name: "Media Bot",
      avatar: "https://i.pravatar.cc/100?img=52",
    },
    caption: "Testing clip: isne2",
    music: "ambient • test track",
    interactions: {
      like: 1200,
      love: 230,
      haha: 40,
      sad: 5,
      angry: 2,
    },
    comments: 23,
    saves: 18,
    thumbnail: "http://192.168.1.11:8000/media/photo/isne2",
    tags: ["#test", "#isne2"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/isne2",
    visibility: "Public",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 6 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 6 * 1800_000)),
    viewer: { saved: false },
  },
  {
    id: "p7",
    user: {
      handle: "@media.bot",
      name: "Media Bot",
      avatar: "https://i.pravatar.cc/100?img=53",
    },
    caption: "Testing clip: isne3",
    music: "chillhop • sample",
    interactions: {
      like: 980,
      love: 120,
      haha: 22,
      sad: 3,
      angry: 1,
    },
    comments: 17,
    saves: 14,
    thumbnail: "http://192.168.1.11:8000/media/photo/isne3",
    tags: ["#test", "#isne3"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/isne3",
    visibility: "Friends",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 7 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 7 * 1800_000)),
    viewer: { saved: true, reaction: "like" },
  },
  {
    id: "p8",
    user: {
      handle: "@media.bot",
      name: "Media Bot",
      avatar: "https://i.pravatar.cc/100?img=54",
    },
    caption: "Testing clip: IMG_1220",
    music: "lofi • sampler",
    interactions: {
      like: 2100,
      love: 420,
      haha: 60,
      sad: 10,
      angry: 4,
    },
    comments: 44,
    saves: 27,
    thumbnail: "http://192.168.1.11:8000/media/photo/IMG_1220",
    tags: ["#test", "#img1220"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/IMG_1220",
    visibility: "Organizations",
    allowComments: true,
    orgViewIds: [
      "org_1f2e3d4c-5b6a-7c8d-9e0f-112233445566",
      "org_99aa88bb-77cc-66dd-55ee-44ff33221100",
    ],
    createdAt: iso(new Date(baseNow.getTime() - 8 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 8 * 1800_000)),
    viewer: { saved: true },
  },
  {
    id: "p9",
    user: {
      handle: "@media.bot",
      name: "Media Bot",
      avatar: "https://i.pravatar.cc/100?img=55",
    },
    caption: "Testing clip: IMG_3786",
    music: "city pop • sampler",
    interactions: {
      like: 1560,
      love: 300,
      haha: 35,
      sad: 6,
      angry: 2,
    },
    comments: 28,
    saves: 20,
    thumbnail: "http://192.168.1.11:8000/media/photo/IMG_3786",
    tags: ["#test", "#img3786"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/IMG_3786",
    visibility: "Private",
    allowComments: false,
    createdAt: iso(new Date(baseNow.getTime() - 9 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 9 * 1800_000)),
    viewer: { saved: false },
  },
  {
    id: "p10",
    user: {
      handle: "@media.bot",
      name: "Media Bot",
      avatar: "https://i.pravatar.cc/100?img=56",
    },
    caption: "Testing clip: Kid",
    music: "electro • sample",
    interactions: {
      like: 1890,
      love: 350,
      haha: 48,
      sad: 9,
      angry: 3,
    },
    comments: 31,
    saves: 22,
    thumbnail: "http://192.168.1.11:8000/media/photo/Kid",
    tags: ["#test", "#kid"],
    videoSrc: "http://192.168.1.11:8000/media/firstbucket/Kid",
    visibility: "Public",
    allowComments: true,
    createdAt: iso(new Date(baseNow.getTime() - 10 * 3600_000)),
    updatedAt: iso(new Date(baseNow.getTime() - 10 * 1800_000)),
    viewer: { saved: true, reaction: "love" },
  },
];

function parseLimit(raw: unknown, def = 5, min = 1, max = 10) {
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

// export async function getFeed(req: Request, res: Response) {
//   try {
//     const algoRaw = (req.query.algo as string) || "for-you";
//     const algo = algoRaw === "following" ? "following" : "for-you"; // default to for-you
//     const limit = parseLimit(req.query.limit);
//     const start = startIndexFromCursor(
//       (req.query.cursor as string) || undefined
//     );

//     // For mock: both algos return same ordering; slot for future differentiation
//     const ordered = [...SAMPLE_DATA];

//     const items = ordered.slice(start, start + limit);
//     const endIndex = start + items.length;
//     const hasMore = endIndex < ordered.length;
//     const nextCursor = hasMore ? ordered[endIndex - 1].id : null;

//     return res.json({
//       algo,
//       items: items,
//       paging: {
//         nextCursor,
//         hasMore,
//       },
//     });
//   } catch (error) {
//     return res.status(500).json({ message: "Something went wrong!" });
//   }
// }

//BELOW THIS IS TEST
type CursorToken = { createdAt: string; id: string };

function encodeCursor(c: CursorToken): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64");
}

function decodeCursor(raw?: string | null): CursorToken | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (
      typeof parsed?.createdAt === "string" &&
      typeof parsed?.id === "string"
    ) {
      return parsed as CursorToken;
    }
  } catch {}
  return null;
}

// Build a range query for "older than cursor" in a stable desc order
function buildCursorFilter(cursor: CursorToken | null) {
  if (!cursor) return {};
  const createdAt = new Date(cursor.createdAt);
  const id = cursor.id;
  return {
    $or: [
      { created_at: { $lt: createdAt } },
      { created_at: createdAt, _id: { $lt: id } },
    ],
  };
}

export async function getFeed(req: Request, res: Response) {
  try {
    const algoRaw = (req.query.algo as string) || "for-you";
    const algo = algoRaw === "following" ? "following" : "for-you";

    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    // Base filters (adjust to your auth/visibility logic)
    const baseFilter = { visibility: "Public" as Visibility };

    // Apply cursor range if provided
    const rangeFilter = buildCursorFilter(cursor);
    const filter = { ...baseFilter, ...rangeFilter };

    const sort = { created_at: -1 as const, _id: -1 as const };

    // Over-fetch by 1 to know if there's another page
    const posts = await PostModel.find(filter)
      .sort(sort)
      .limit(limit + 1)
      .exec();

    const hasMore = posts.length > limit;
    const pageItems = hasMore ? posts.slice(0, limit) : posts;

    // Preload users in batch (fewer roundtrips)
    const userIds = pageItems.map((p) => p.user_id);
    const users = await UserModel.find({ _id: { $in: userIds } })
      .lean()
      .exec();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const dtoPosts = pageItems.map((post) => {
      const user = userMap.get(post.user_id.toString());
      return {
        id: post._id.toString(),
        user: {
          handle: user?.handle || "unknown",
          name: user?.username || "Unknown User",
          avatar: user?.picture_url || "https://i.pravatar.cc/100?img=1",
        },
        caption: post.caption ?? "",
        music: post.music ?? "",
        interactions: {
          like: 0,
          love: 0,
          haha: 0,
          sad: 0,
          angry: 0, // TODO: real counts
        },
        comments: 0, // TODO
        saves: 0, // TODO
        thumbnail: post.thumbnail ?? "",
        tags: post.tags ?? [],
        videoSrc: post.video_src ?? "",
        visibility: post.visibility,
        allowComments: post.allow_comments,
        createdAt: post.created_at?.toISOString() ?? new Date().toISOString(),
        updatedAt: post.updated_at?.toISOString() ?? new Date().toISOString(),
        viewer: { saved: false, reaction: undefined },
      };
    });

    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: pageItems[pageItems.length - 1].created_at.toISOString(),
          id: pageItems[pageItems.length - 1]._id.toString(),
        })
      : null;

    return res.json({
      algo,
      items: dtoPosts,
      paging: {
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}
