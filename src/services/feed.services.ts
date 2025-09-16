import { Request, Response } from "express";
import type { ReactionKey, Visibility } from "../models/enums";
import {
  PostModel,
  PostReactionModel,
  PostSaveModel,
  PostCommentModel,
  UserModel,
} from "../models";

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

function parseLimit(raw: unknown, def = 5, min = 1, max = 10) {
  const n = typeof raw === "string" ? parseInt(raw, 10) : def;
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

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

    // Viewer context (optional)
    const viewerId = (req as any)?.user?.id?.toString();
    const postIds = pageItems.map((p) => p._id.toString());

    let reactionMap = new Map<string, ReactionKey>();
    let savedSet = new Set<string>();
    if (viewerId && postIds.length > 0) {
      const [reactions, saves] = await Promise.all([
        PostReactionModel.find({ post_id: { $in: postIds }, user_id: viewerId })
          .lean()
          .exec(),
        PostSaveModel.find({ post_id: { $in: postIds }, user_id: viewerId })
          .lean()
          .exec(),
      ]);
      reactionMap = new Map(
        reactions.map((r: any) => [r.post_id.toString(), r.key as ReactionKey])
      );
      savedSet = new Set(saves.map((s: any) => s.post_id.toString()));
    }

    const dtoPosts = pageItems.map((post) => {
      const user = userMap.get(post.user_id.toString());
      const id = post._id.toString();
      return {
        id,
        user: {
          handle: user?.handle || "unknown",
          name: user?.username || "Unknown User",
          avatar: user?.picture_url || "https://i.pravatar.cc/100?img=1",
        },
        caption: post.caption ?? "",
        music: post.music ?? "",
        interactions: {
          like: post.like_count ?? 0,
          love: post.love_count ?? 0,
          haha: post.haha_count ?? 0,
          sad: post.sad_count ?? 0,
          angry: post.angry_count ?? 0,
        },
        comments: post.comments_count ?? 0,
        saves: post.saves_count ?? 0,
        thumbnail: post.thumbnail ?? "",
        tags: post.tags ?? [],
        videoSrc: post.video_src ?? "",
        visibility: post.visibility,
        allowComments: post.allow_comments,
        createdAt: post.created_at?.toISOString() ?? new Date().toISOString(),
        updatedAt: post.updated_at?.toISOString() ?? new Date().toISOString(),
        viewer: {
          saved: savedSet.has(id),
          reaction: reactionMap.get(id),
        },
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

// GET /feed/user/handle/:handle?limit&cursor
export async function getFeedByUserHandle(req: Request, res: Response) {
  try {
    const { handle } = req.params as { handle: string };
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    // Resolve handle to user
    const author = await UserModel.findOne({ handle }).lean().exec();
    if (!author) return res.status(404).json({ message: "User not found" });

    const authorId = author._id.toString();
    const viewerId = (req as any)?.user?.id?.toString();
    const isOwner = viewerId && viewerId === authorId;

    const baseFilter: any = { user_id: author._id };
    if (!isOwner) {
      baseFilter.visibility = "Public" as Visibility;
    }

    const rangeFilter = buildCursorFilter(cursor);
    const filter = { ...baseFilter, ...rangeFilter };
    const sort = { created_at: -1 as const, _id: -1 as const };

    const posts = await PostModel.find(filter)
      .sort(sort)
      .limit(limit + 1)
      .exec();

    const hasMore = posts.length > limit;
    const pageItems = hasMore ? posts.slice(0, limit) : posts;

    // Viewer state
    const postIds = pageItems.map((p) => p._id.toString());
    let reactionMap = new Map<string, ReactionKey>();
    let savedSet = new Set<string>();
    if (viewerId && postIds.length > 0) {
      const [reactions, saves] = await Promise.all([
        PostReactionModel.find({ post_id: { $in: postIds }, user_id: viewerId })
          .lean()
          .exec(),
        PostSaveModel.find({ post_id: { $in: postIds }, user_id: viewerId })
          .lean()
          .exec(),
      ]);
      reactionMap = new Map(
        reactions.map((r: any) => [r.post_id.toString(), r.key as ReactionKey])
      );
      savedSet = new Set(saves.map((s: any) => s.post_id.toString()));
    }

    const items = pageItems.map((post) => {
      const id = post._id.toString();
      return {
        id,
        user: {
          handle: author.handle || "unknown",
          name: author.username || "Unknown User",
          avatar: author.picture_url || "https://i.pravatar.cc/100?img=1",
        },
        caption: post.caption ?? "",
        music: post.music ?? "",
        interactions: {
          like: post.like_count ?? 0,
          love: post.love_count ?? 0,
          haha: post.haha_count ?? 0,
          sad: post.sad_count ?? 0,
          angry: post.angry_count ?? 0,
        },
        comments: post.comments_count ?? 0,
        saves: post.saves_count ?? 0,
        thumbnail: post.thumbnail ?? "",
        tags: post.tags ?? [],
        videoSrc: post.video_src ?? "",
        visibility: post.visibility,
        allowComments: post.allow_comments,
        createdAt: post.created_at?.toISOString() ?? new Date().toISOString(),
        updatedAt: post.updated_at?.toISOString() ?? new Date().toISOString(),
        viewer: {
          saved: savedSet.has(id),
          reaction: reactionMap.get(id),
        },
      } as PostDTO;
    });

    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: pageItems[pageItems.length - 1].created_at.toISOString(),
          id: pageItems[pageItems.length - 1]._id.toString(),
        })
      : null;

    return res.status(200).json({ items, paging: { hasMore, nextCursor } });
  } catch (error) {
    console.error("getFeedByUserHandle error", error);
    return res
      .status(500)
      .json({ message: "Failed to get user feed by handle" });
  }
}

function reactionField(key: ReactionKey) {
  return `${key}_count` as const;
}

export async function reactToPost(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { postId } = req.params as { postId: string };
    const { key } = (req.body || {}) as { key?: ReactionKey };
    const validKeys: ReactionKey[] = ["like", "love", "haha", "sad", "angry"];
    if (!key || !validKeys.includes(key)) {
      return res.status(400).json({ message: "Invalid reaction key" });
    }

    // Ensure post exists
    const post = await PostModel.findById(postId).exec();
    if (!post) return res.status(404).json({ message: "Post not found" });

    // Find existing reaction
    const existing = await PostReactionModel.findOne({
      post_id: postId,
      user_id: userId,
    }).exec();

    if (!existing) {
      // Create new reaction and increment corresponding count
      await Promise.all([
        PostReactionModel.create({ post_id: postId, user_id: userId, key }),
        PostModel.findByIdAndUpdate(
          postId,
          { $inc: { [reactionField(key)]: 1 } as any },
          { new: false }
        ).exec(),
      ]);
    } else if (existing.key !== key) {
      // Change reaction: decrement old, increment new
      const oldKey = existing.key as ReactionKey;
      await Promise.all([
        PostReactionModel.updateOne(
          { _id: existing._id },
          { $set: { key } }
        ).exec(),
        PostModel.findByIdAndUpdate(
          postId,
          {
            $inc: {
              [reactionField(oldKey)]: -1,
              [reactionField(key)]: 1,
            } as any,
          },
          { new: false }
        ).exec(),
      ]);
    } // else same key -> no-op

    // Fetch updated counts for response
    const updated = await PostModel.findById(postId).lean().exec();
    return res.status(200).json({
      postId,
      interactions: {
        like: updated?.like_count ?? 0,
        love: updated?.love_count ?? 0,
        haha: updated?.haha_count ?? 0,
        sad: updated?.sad_count ?? 0,
        angry: updated?.angry_count ?? 0,
      },
      viewer: { reaction: key },
    });
  } catch (error: any) {
    console.error("reactToPost error", error);
    if (error?.code === 11000) {
      // Unique index race; fall back to idempotent response
      return res.status(409).json({ message: "Reaction already exists" });
    }
    return res.status(500).json({ message: "Failed to react" });
  }
}

export async function removeReaction(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { postId } = req.params as { postId: string };

    const post = await PostModel.findById(postId).exec();
    if (!post) return res.status(404).json({ message: "Post not found" });

    const existing = await PostReactionModel.findOne({
      post_id: postId,
      user_id: userId,
    }).exec();
    if (!existing) {
      // Nothing to remove; return current state
      const updated = await PostModel.findById(postId).lean().exec();
      return res.status(200).json({
        postId,
        interactions: {
          like: updated?.like_count ?? 0,
          love: updated?.love_count ?? 0,
          haha: updated?.haha_count ?? 0,
          sad: updated?.sad_count ?? 0,
          angry: updated?.angry_count ?? 0,
        },
        viewer: { reaction: undefined },
      });
    }

    const oldKey = existing.key as ReactionKey;
    await Promise.all([
      PostReactionModel.deleteOne({ _id: existing._id }).exec(),
      PostModel.findByIdAndUpdate(
        postId,
        { $inc: { [reactionField(oldKey)]: -1 } as any },
        { new: false }
      ).exec(),
    ]);

    const updated = await PostModel.findById(postId).lean().exec();
    return res.status(200).json({
      postId,
      interactions: {
        like: updated?.like_count ?? 0,
        love: updated?.love_count ?? 0,
        haha: updated?.haha_count ?? 0,
        sad: updated?.sad_count ?? 0,
        angry: updated?.angry_count ?? 0,
      },
      viewer: { reaction: undefined },
    });
  } catch (error) {
    console.error("removeReaction error", error);
    return res.status(500).json({ message: "Failed to remove reaction" });
  }
}

export async function savePost(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { postId } = req.params as { postId: string };
    const post = await PostModel.findById(postId).exec();
    if (!post) return res.status(404).json({ message: "Post not found" });

    // Try create save; if it already exists, don't increment
    let created = false;
    try {
      await PostSaveModel.create({ post_id: postId, user_id: userId });
      created = true;
    } catch (err: any) {
      if (!(err?.code === 11000)) throw err; // other errors bubble up
    }

    if (created) {
      await PostModel.findByIdAndUpdate(
        postId,
        { $inc: { saves_count: 1 } },
        { new: false }
      ).exec();
    }

    const updated = await PostModel.findById(postId).lean().exec();
    return res.status(200).json({
      postId,
      saves: updated?.saves_count ?? 0,
      viewer: { saved: true },
    });
  } catch (error) {
    console.error("savePost error", error);
    return res.status(500).json({ message: "Failed to save post" });
  }
}

export async function removeSave(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { postId } = req.params as { postId: string };
    const post = await PostModel.findById(postId).exec();
    if (!post) return res.status(404).json({ message: "Post not found" });

    const existing = await PostSaveModel.findOne({
      post_id: postId,
      user_id: userId,
    }).exec();
    if (existing) {
      await Promise.all([
        PostSaveModel.deleteOne({ _id: existing._id }).exec(),
        PostModel.findByIdAndUpdate(
          postId,
          { $inc: { saves_count: -1 } },
          { new: false }
        ).exec(),
      ]);
    }

    const updated = await PostModel.findById(postId).lean().exec();
    return res.status(200).json({
      postId,
      saves: updated?.saves_count ?? 0,
      viewer: { saved: false },
    });
  } catch (error) {
    console.error("removeSave error", error);
    return res.status(500).json({ message: "Failed to remove save" });
  }
}

export async function addComment(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { postId } = req.params as { postId: string };
    const { text, parentCommentId, visibility } = (req.body || {}) as {
      text?: string;
      parentCommentId?: string;
      visibility?: "Public" | "OwnerOnly";
    };

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ message: "Text is required" });
    }

    const post = await PostModel.findById(postId).exec();
    if (!post) return res.status(404).json({ message: "Post not found" });
    if (!post.allow_comments) {
      return res
        .status(403)
        .json({ message: "Comments are disabled for this post" });
    }

    let parent = null as any;
    if (parentCommentId) {
      parent = await PostCommentModel.findById(parentCommentId).lean().exec();
      if (!parent)
        return res.status(404).json({ message: "Parent comment not found" });
      if (String(parent.post_id) !== String(post._id)) {
        return res
          .status(400)
          .json({ message: "Parent comment does not belong to this post" });
      }
    }

    const created = await PostCommentModel.create({
      post_id: post._id,
      user_id: userId,
      parent_comment_id: parent ? parent._id : undefined,
      text: text.trim(),
      visibility: visibility === "OwnerOnly" ? "OwnerOnly" : "Public",
    });

    // increment comments_count
    await PostModel.findByIdAndUpdate(postId, {
      $inc: { comments_count: 1 },
    }).exec();

    const user = await UserModel.findById(userId).lean().exec();
    return res.status(201).json({
      id: created._id.toString(),
      postId: postId,
      text: created.text,
      visibility: created.visibility,
      parentCommentId: created.parent_comment_id?.toString() || null,
      user: {
        id: user?._id?.toString() || String(userId),
        handle: user?.handle || "unknown",
        name: user?.username || "Unknown User",
        avatar: user?.picture_url || "https://i.pravatar.cc/100?img=1",
      },
      createdAt:
        created.created_at?.toISOString?.() || new Date().toISOString(),
    });
  } catch (error) {
    console.error("addComment error", error);
    return res.status(500).json({ message: "Failed to add comment" });
  }
}

export async function getCommentsByPostId(req: Request, res: Response) {
  try {
    const { postId } = req.params as { postId: string };
    const limit = parseLimit(req.query.limit, 10, 1, 50);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    // ensure post exists (optional but clearer errors)
    const post = await PostModel.findById(postId).lean().exec();
    if (!post) return res.status(404).json({ message: "Post not found" });

    const viewerId = (req as any)?.user?.id?.toString();
    const isOwner = viewerId && viewerId === post.user_id?.toString();

    // Build access conditions
    const baseConditions: any[] = [
      { post_id: postId },
      buildCursorFilter(cursor),
      { deleted_at: { $exists: false } },
    ];

    // If viewer is not the post owner, restrict to Public or viewer's own comments
    if (!isOwner) {
      if (viewerId) {
        baseConditions.push({
          $or: [{ visibility: "Public" }, { user_id: viewerId }],
        });
      } else {
        baseConditions.push({ visibility: "Public" });
      }
    }

    const filter: any = { $and: baseConditions };

    const sort = { created_at: -1 as const, _id: -1 as const };
    const comments = await PostCommentModel.find(filter)
      .sort(sort)
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = comments.length > limit;
    const pageItems = hasMore ? comments.slice(0, limit) : comments;

    const userIds = Array.from(
      new Set(pageItems.map((c) => c.user_id?.toString()).filter(Boolean))
    );
    const users = await UserModel.find({ _id: { $in: userIds } })
      .lean()
      .exec();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const items = pageItems.map((c) => {
      const u = userMap.get(c.user_id?.toString() || "");
      return {
        id: c._id.toString(),
        postId,
        text: c.text,
        visibility: c.visibility,
        parentCommentId: c.parent_comment_id
          ? c.parent_comment_id.toString()
          : null,
        user: {
          id: c.user_id?.toString() || "",
          handle: u?.handle || "unknown",
          name: u?.username || "Unknown User",
          avatar: u?.picture_url || "https://i.pravatar.cc/100?img=1",
        },
        createdAt: c.created_at?.toISOString?.() || new Date().toISOString(),
      };
    });

    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: pageItems[pageItems.length - 1].created_at.toISOString(),
          id: pageItems[pageItems.length - 1]._id.toString(),
        })
      : null;

    return res.status(200).json({
      items,
      paging: { hasMore, nextCursor },
    });
  } catch (error) {
    console.error("getCommentsByPostId error", error);
    return res.status(500).json({ message: "Failed to get comments" });
  }
}
