import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  UserModel,
  OrganizationModel,
  PostModel,
  PostOrgModel,
  FollowModel,
  OrganizationMembershipModel,
} from "../models";

type SearchType = "all" | "users" | "organizations" | "posts";

type UserResult = {
  type: "user";
  id: string;
  username: string;
  handle: string;
  pictureUrl: string;
};

type OrganizationResult = {
  type: "organization";
  id: string;
  name: string;
  logoUrl: string;
  isWorkOrg: boolean; // true = organization, false = group
};

type PostResult = {
  type: "post";
  id: string;
  user: {
    id: string;
    username: string;
    handle: string;
    pictureUrl: string;
  };
  caption: string;
  thumbnail: string;
  videoSrc: string;
  tags: string[];
  interactions: {
    likes: number;
    loves: number;
    hahas: number;
    sads: number;
    angries: number;
  };
  comments: number;
  saves: number;
  views: number;
  createdAt: string;
};

type ExploreResult = UserResult | OrganizationResult | PostResult;

type ExploreResponse = {
  results: ExploreResult[];
  nextCursor?: string;
  hasMore: boolean;
};

type CursorToken = {
  skip: number;
  issuedAt: string;
};

function parseLimit(raw: unknown, def = 10, min = 1, max = 50) {
  const n = typeof raw === "string" ? parseInt(raw, 10) : def;
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function encodeCursor(skip: number): string {
  const payload: CursorToken = {
    skip,
    issuedAt: new Date().toISOString(),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodeCursor(raw?: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (typeof parsed?.skip === "number" && parsed.skip >= 0) {
      return parsed.skip;
    }
  } catch {
    return 0;
  }
  return 0;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchUsers(
  query: string,
  limit: number,
  skip: number
): Promise<UserResult[]> {
  const searchRegex = new RegExp(escapeRegex(query), "i");

  const users = await UserModel.find({
    $or: [{ username: searchRegex }, { handle: searchRegex }],
  })
    .skip(skip)
    .limit(limit)
    .lean();

  return users.map((user) => ({
    type: "user" as const,
    id: user._id.toString(),
    username: user.username,
    handle: user.handle,
    pictureUrl: user.picture_url || "",
  }));
}

async function searchOrganizations(
  query: string,
  limit: number,
  skip: number
): Promise<OrganizationResult[]> {
  const searchRegex = new RegExp(escapeRegex(query), "i");

  const orgs = await OrganizationModel.find({
    name: searchRegex,
  })
    .skip(skip)
    .limit(limit)
    .lean();

  return orgs.map((org) => ({
    type: "organization" as const,
    id: org._id.toString(),
    name: org.name,
    logoUrl: org.logo_url || "",
    isWorkOrg: org.is_work_org || false, // true = organization, false = group
  }));
}

async function searchPosts(
  query: string,
  limit: number,
  skip: number,
  userId?: string
): Promise<PostResult[]> {
  // Handle hashtag search - remove # if present
  const cleanQuery = query.startsWith("#") ? query.slice(1) : query;
  const searchRegex = new RegExp(escapeRegex(cleanQuery), "i");

  // Search in caption and tags (hashtags), and only include Public posts
  const posts = await PostModel.find({
    visibility: "Public",
    $or: [
      { caption: searchRegex },
      { tags: { $elemMatch: { $regex: searchRegex } } },
    ],
  })
    .populate("user_id", "username handle picture_url")
    .sort({ created_at: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return posts.map((post) => {
    const user = post.user_id as any;
    return {
      type: "post" as const,
      id: post._id.toString(),
      user: {
        id: user._id.toString(),
        username: user.username,
        handle: user.handle,
        pictureUrl: user.picture_url || "",
      },
      caption: post.caption || "",
      thumbnail: post.thumbnail || "",
      videoSrc: post.video_src,
      tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
      interactions: {
        likes: post.like_count,
        loves: post.love_count,
        hahas: post.haha_count,
        sads: post.sad_count,
        angries: post.angry_count,
      },
      comments: post.comments_count,
      saves: post.saves_count,
      views: post.views_count,
      createdAt: post.created_at.toISOString(),
    };
  });
}

async function getHotVideos(
  limit: number,
  skip: number,
  sortBy: "trending" | "most_viewed" | "most_reactions" | "latest" = "trending"
): Promise<PostResult[]> {
  let sortCriteria: any = {};

  switch (sortBy) {
    case "most_viewed":
      sortCriteria = { views_count: -1, created_at: -1 };
      break;
    case "most_reactions":
      // Calculate total reactions and sort by it
      sortCriteria = { created_at: -1 }; // We'll use aggregation for this
      break;
    case "latest":
      sortCriteria = { created_at: -1 };
      break;
    case "trending":
    default:
      // Trending: combination of recent posts with high engagement
      // We'll use a weighted score based on views, reactions, and recency
      sortCriteria = { created_at: -1 }; // We'll use aggregation for this
      break;
  }

  if (sortBy === "most_reactions" || sortBy === "trending") {
    // Use aggregation to calculate total reactions or trending score
    const pipeline: any[] = [
      {
        $match: {
          visibility: "Public",
        },
      },
      {
        $addFields: {
          total_reactions: {
            $add: [
              "$like_count",
              "$love_count",
              "$haha_count",
              "$sad_count",
              "$angry_count",
            ],
          },
        },
      },
    ];

    if (sortBy === "trending") {
      // Trending score: recent posts (last 7 days get bonus) + engagement
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      pipeline.push({
        $addFields: {
          trending_score: {
            $add: [
              { $multiply: ["$views_count", 1] },
              { $multiply: ["$total_reactions", 10] },
              { $multiply: ["$comments_count", 5] },
              { $multiply: ["$saves_count", 15] },
              {
                $cond: [
                  { $gte: ["$created_at", sevenDaysAgo] },
                  1000, // Bonus for recent posts
                  0,
                ],
              },
            ],
          },
        },
      });
      pipeline.push({ $sort: { trending_score: -1, created_at: -1 } });
    } else {
      pipeline.push({ $sort: { total_reactions: -1, created_at: -1 } });
    }

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });
    pipeline.push({
      $lookup: {
        from: "users",
        localField: "user_id",
        foreignField: "_id",
        as: "user",
      },
    });
    pipeline.push({ $unwind: "$user" });

    const posts = await PostModel.aggregate(pipeline);

    return posts.map((post) => ({
      type: "post" as const,
      id: post._id.toString(),
      user: {
        id: post.user._id.toString(),
        username: post.user.username,
        handle: post.user.handle,
        pictureUrl: post.user.picture_url || "",
      },
      caption: post.caption || "",
      thumbnail: post.thumbnail || "",
      videoSrc: post.video_src,
      tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
      interactions: {
        likes: post.like_count,
        loves: post.love_count,
        hahas: post.haha_count,
        sads: post.sad_count,
        angries: post.angry_count,
      },
      comments: post.comments_count,
      saves: post.saves_count,
      views: post.views_count,
      createdAt: new Date(post.created_at).toISOString(),
    }));
  } else {
    // Simple sort for most_viewed and latest
    const posts = await PostModel.find({
      visibility: "Public",
    })
      .populate("user_id", "username handle picture_url")
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean();

    return posts.map((post) => {
      const user = post.user_id as any;
      return {
        type: "post" as const,
        id: post._id.toString(),
        user: {
          id: user._id.toString(),
          username: user.username,
          handle: user.handle,
          pictureUrl: user.picture_url || "",
        },
        caption: post.caption || "",
        thumbnail: post.thumbnail || "",
        videoSrc: post.video_src,
        tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
        interactions: {
          likes: post.like_count,
          loves: post.love_count,
          hahas: post.haha_count,
          sads: post.sad_count,
          angries: post.angry_count,
        },
        comments: post.comments_count,
        saves: post.saves_count,
        views: post.views_count,
        createdAt: post.created_at.toISOString(),
      };
    });
  }
}

export async function explore(req: Request, res: Response) {
  try {
    const query = (req.query.q as string)?.trim() || "";
    const type = (req.query.type as SearchType) || "all";
    const sortBy =
      (req.query.sortBy as
        | "trending"
        | "most_viewed"
        | "most_reactions"
        | "latest") || "trending";
    const limit = parseLimit(req.query.limit);
    const cursor = req.query.cursor as string | undefined;
    const skip = decodeCursor(cursor);

    // If no query provided, show hot/trending videos
    if (!query) {
      const hotVideos = await getHotVideos(limit, skip, sortBy);
      const hasMore = hotVideos.length === limit;
      const nextCursor = hasMore ? encodeCursor(skip + limit) : undefined;

      return res.status(200).json({
        results: hotVideos,
        nextCursor,
        hasMore,
      });
    }

    if (!["all", "users", "organizations", "posts"].includes(type)) {
      return res.status(400).json({
        error:
          "Invalid search type. Must be one of: all, users, organizations, posts",
      });
    }

    let results: ExploreResult[] = [];

    switch (type) {
      case "users":
        results = await searchUsers(query, limit, skip);
        break;
      case "organizations":
        results = await searchOrganizations(query, limit, skip);
        break;
      case "posts":
        results = await searchPosts(query, limit, skip);
        break;
      case "all":
        // For "all" type, we'll get a mix of all types
        // Distribute the limit across all types
        const perType = Math.ceil(limit / 3);
        const [users, orgs, posts] = await Promise.all([
          searchUsers(query, perType, Math.floor(skip / 3)),
          searchOrganizations(query, perType, Math.floor(skip / 3)),
          searchPosts(query, perType, Math.floor(skip / 3)),
        ]);

        // Interleave results
        results = [...users, ...orgs, ...posts].slice(0, limit);
        break;
    }

    const hasMore = results.length === limit;
    const nextCursor = hasMore ? encodeCursor(skip + limit) : undefined;

    const response: ExploreResponse = {
      results,
      nextCursor,
      hasMore,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error("Error in explore:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}
