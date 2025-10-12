import { Request, Response } from "express";
import { randomInt } from "crypto";
import { Types } from "mongoose";
import { ensureRedis } from "../lib/redis";
import { sendEmailNotification } from "../lib/sendEmail";
import {
  FollowModel,
  OrganizationMembershipModel,
  OrganizationModel,
  PostModel,
  PostReactionModel,
  PostSaveModel,
  UserEmailModel,
  UserModel,
  ViewModel,
} from "../models";

type CursorToken = { createdAt: string; id: string };

function parseLimit(raw: unknown, def = 10, min = 1, max = 50) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const clamped = Math.min(Math.max(raw, min), max);
    return clamped;
  }

  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.min(Math.max(parsed, min), max);
      return clamped;
    }
  }

  return def;
}

function encodeCursor(cursor: CursorToken): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
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
  } catch {
    // ignore malformed cursor
  }
  return null;
}

function buildCursorFilter(
  cursor: CursorToken | null,
  dateField: "created_at" | "updated_at" = "created_at"
) {
  if (!cursor) return {};

  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(createdAt.getTime())) return {};

  const fieldKey = dateField;
  const baseCondition = {
    [fieldKey]: { $lt: createdAt },
  } as Record<string, unknown>;

  if (!Types.ObjectId.isValid(cursor.id)) {
    return baseCondition;
  }

  const reactionId = new Types.ObjectId(cursor.id);
  const tieBreakerCondition = {
    [fieldKey]: createdAt,
    _id: { $lt: reactionId },
  } as Record<string, unknown>;

  return {
    $or: [baseCondition, tieBreakerCondition],
  } as Record<string, unknown>;
}

// Get user profile by user ID
async function getUserProfile(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    if (!userId)
      return res.status(400).json({ message: "User ID is required" });

    const user = await UserModel.findById(userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Get follower and following counts
    const followerCount = await FollowModel.countDocuments({
      followee_id: userId,
    });
    const followingCount = await FollowModel.countDocuments({
      follower_id: userId,
    });

    // Count posts
    const postCount = await PostModel.countDocuments({ user_id: userId });

    // Check if viewer is following this user
    const reqAny = req as any;
    let isFollowing = null;
    if (reqAny.user?.id && reqAny.user.id != userId) {
      const existingFollow = await FollowModel.findOne({
        follower_id: reqAny.user.id,
        followee_id: userId,
      });
      isFollowing = !!existingFollow;
    }

    return res.status(200).json({
      user,
      follower_count: followerCount,
      following_count: followingCount,
      post_count: postCount,
      is_following: isFollowing,
    });
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

//Get UserId by User handle
async function getUserIdByHandle(req: Request, res: Response) {
  try {
    const { handle } = req.params;
    if (!handle)
      return res.status(400).json({ message: "User handle is required" });

    const user = await UserModel.findOne({ handle }).select("_id");
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.status(200).json({ userId: user._id });
  } catch (error) {
    console.error("Error in getUserIdByHandle:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get user's organizations
async function getUserOrganizations(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const memberships = await OrganizationMembershipModel.find({
      user_id: reqAny.user.id,
    })
      .populate("org_id")
      .exec();
    const organizations = memberships.map((m) => m.org_id);

    return res.status(200).json({ organizations });
  } catch (error) {
    console.error("Error in getUserOrganizations:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

async function updateHandle(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const rawHandle =
      typeof req.body?.handle === "string" ? req.body.handle.trim() : "";
    const sanitized = rawHandle.startsWith("@")
      ? rawHandle.slice(1)
      : rawHandle;
    const normalizedHandle = sanitized.toLowerCase();

    if (!normalizedHandle) {
      return res.status(400).json({ message: "Handle is required" });
    }

    const handlePattern = /^[a-z0-9._-]{3,30}$/;
    if (!handlePattern.test(normalizedHandle)) {
      return res.status(400).json({
        message:
          "Handle must be 3-30 characters using letters, numbers, '.', '_' or '-'",
      });
    }

    const existing = await UserModel.exists({
      handle: normalizedHandle,
      _id: { $ne: reqAny.user.id },
    });
    if (existing) {
      return res.status(409).json({ message: "Handle already taken" });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      reqAny.user.id,
      { handle: normalizedHandle },
      { new: true, runValidators: true }
    ).select("_id username handle picture_url");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res
      .status(200)
      .json({ message: "Handle updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error in updateHandle:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

async function updateUsername(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!username) {
      return res.status(400).json({ message: "Username is required" });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      reqAny.user.id,
      { username },
      { new: true, runValidators: true }
    ).select("_id username handle picture_url");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res
      .status(200)
      .json({ message: "Username updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error in updateUsername:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

async function updateProfilePicture(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const rawUrl =
      typeof req.body?.pictureUrl === "string"
        ? req.body.pictureUrl
        : typeof req.body?.picture_url === "string"
        ? req.body.picture_url
        : "";

    const pictureUrl = rawUrl.trim();
    if (!pictureUrl) {
      return res.status(400).json({ message: "pictureUrl is required" });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(
      reqAny.user.id,
      { picture_url: pictureUrl },
      { new: true, runValidators: true }
    ).select("_id username handle picture_url");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Profile picture updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error in updateProfilePicture:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Handle following and unfollowing users
async function followUser(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const { targetUserId, action } = req.body;
    if (!targetUserId || !action)
      return res
        .status(400)
        .json({ message: "Target user ID and action are required" });
    if (action !== "follow" && action !== "unfollow")
      return res.status(400).json({ message: "Invalid action" });
    if (targetUserId === reqAny.user.id)
      return res
        .status(400)
        .json({ message: "Cannot follow/unfollow yourself" });

    const targetUser = await UserModel.findById(targetUserId);
    if (!targetUser)
      return res.status(404).json({ message: "Target user not found" });

    if (action === "follow") {
      const existingFollow = await FollowModel.findOne({
        follower_id: reqAny.user.id,
        followee_id: targetUserId,
      });
      if (existingFollow)
        return res.status(409).json({ message: "Already following this user" });

      await FollowModel.create({
        follower_id: reqAny.user.id,
        followee_id: targetUserId,
      });
      return res
        .status(200)
        .json({ message: "Successfully followed the user" });
    } else {
      const existingFollow = await FollowModel.findOne({
        follower_id: reqAny.user.id,
        followee_id: targetUserId,
      });
      if (!existingFollow)
        return res.status(404).json({ message: "Not following this user" });

      await existingFollow.deleteOne();
      return res
        .status(200)
        .json({ message: "Successfully unfollowed the user" });
    }
  } catch (error) {
    console.error("Error in followUser:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get user's saved videos
async function getSavedVideos(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const viewerIdRaw = reqAny.user?.id;
    const viewerId =
      typeof viewerIdRaw === "string" ? viewerIdRaw : viewerIdRaw?.toString?.();
    if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

    const limit = parseLimit(req.query.limit, 10, 1, 50);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    const cursorFilter = buildCursorFilter(cursor);
    const saveFilter = { user_id: viewerId, ...cursorFilter } as Record<
      string,
      unknown
    >;

    const saves = await PostSaveModel.find(saveFilter)
      .sort({ created_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = saves.length > limit;
    const pageSaves = hasMore ? saves.slice(0, limit) : saves;

    const postIds = Array.from(
      new Set(pageSaves.map((save: any) => String(save.post_id)))
    );
    const posts = await PostModel.find({ _id: { $in: postIds } })
      .lean()
      .exec();
    const postMap = new Map(
      posts.map((post: any) => [post._id.toString(), post])
    );

    const authorIds = Array.from(
      new Set(posts.map((post: any) => String(post.user_id)))
    );
    const authors = await UserModel.find({ _id: { $in: authorIds } })
      .lean()
      .exec();
    const authorMap = new Map(
      authors.map((author: any) => [author._id.toString(), author])
    );

    let reactionMap = new Map<string, string>();
    if (postIds.length > 0) {
      const reactions = await PostReactionModel.find({
        post_id: { $in: postIds },
        user_id: viewerId,
      })
        .lean()
        .exec();
      reactionMap = new Map(
        reactions.map((reaction: any) => [
          String(reaction.post_id),
          reaction.key,
        ])
      );
    }

    const items = pageSaves
      .map((save: any) => {
        const post = postMap.get(String(save.post_id));
        if (!post) return null;
        const author = authorMap.get(String(post.user_id));
        const postId = post._id.toString();
        return {
          postId,
          savedAt:
            save.created_at instanceof Date
              ? save.created_at.toISOString()
              : new Date(save.created_at ?? Date.now()).toISOString(),
          post: {
            id: postId,
            user: {
              id: String(post.user_id),
              handle: author?.handle || "unknown",
              name: author?.username || "Unknown User",
              avatar: author?.picture_url || "https://i.pravatar.cc/100?img=1",
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
            tags: Array.isArray(post.tags) ? post.tags : [],
            videoSrc: post.video_src ?? "",
            visibility: post.visibility,
            allowComments: post.allow_comments,
            createdAt:
              post.created_at instanceof Date
                ? post.created_at.toISOString()
                : new Date(post.created_at ?? Date.now()).toISOString(),
            updatedAt:
              post.updated_at instanceof Date
                ? post.updated_at.toISOString()
                : new Date(post.updated_at ?? Date.now()).toISOString(),
            viewer: {
              reaction: reactionMap.get(postId) || null,
              saved: true,
            },
          },
        };
      })
      .filter(Boolean);

    const lastSave = pageSaves[pageSaves.length - 1];
    const nextCursor =
      hasMore && lastSave?.created_at
        ? encodeCursor({
            createdAt:
              lastSave.created_at instanceof Date
                ? lastSave.created_at.toISOString()
                : new Date(lastSave.created_at).toISOString(),
            id: lastSave._id.toString(),
          })
        : null;

    return res.status(200).json({
      items,
      paging: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Error in getSavedVideos:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get user's reacted videos
async function getReactedVideos(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const viewerIdRaw = reqAny.user?.id;
    const viewerId =
      typeof viewerIdRaw === "string" ? viewerIdRaw : viewerIdRaw?.toString?.();
    if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

    const limit = parseLimit(req.query.limit, 10, 1, 50);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    const cursorFilter = buildCursorFilter(cursor);
    const reactionFilter = { user_id: viewerId, ...cursorFilter } as Record<
      string,
      unknown
    >;

    const reactions = await PostReactionModel.find(reactionFilter)
      .sort({ created_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = reactions.length > limit;
    const pageReactions = hasMore ? reactions.slice(0, limit) : reactions;

    const postIds = Array.from(
      new Set(pageReactions.map((reaction: any) => String(reaction.post_id)))
    );
    const posts = await PostModel.find({ _id: { $in: postIds } })
      .lean()
      .exec();
    const postMap = new Map(
      posts.map((post: any) => [post._id.toString(), post])
    );

    const authorIds = Array.from(
      new Set(posts.map((post: any) => String(post.user_id)))
    );
    const authors = await UserModel.find({ _id: { $in: authorIds } })
      .lean()
      .exec();
    const authorMap = new Map(
      authors.map((author: any) => [author._id.toString(), author])
    );

    let savedSet = new Set<string>();
    if (postIds.length > 0) {
      const saves = await PostSaveModel.find({
        post_id: { $in: postIds },
        user_id: viewerId,
      })
        .lean()
        .exec();
      savedSet = new Set(saves.map((save: any) => String(save.post_id)));
    }

    const items = pageReactions
      .map((reaction: any) => {
        const post = postMap.get(String(reaction.post_id));
        if (!post) return null;

        const author = authorMap.get(String(post.user_id));
        const postId = post._id.toString();

        return {
          postId,
          reactionId: reaction._id.toString(),
          reactionKey: reaction.key,
          reactedAt:
            reaction.created_at instanceof Date
              ? reaction.created_at.toISOString()
              : new Date(reaction.created_at ?? Date.now()).toISOString(),
          post: {
            id: postId,
            user: {
              id: String(post.user_id),
              handle: author?.handle || "unknown",
              name: author?.username || "Unknown User",
              avatar: author?.picture_url || "https://i.pravatar.cc/100?img=1",
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
            tags: Array.isArray(post.tags) ? post.tags : [],
            videoSrc: post.video_src ?? "",
            visibility: post.visibility,
            allowComments: post.allow_comments,
            createdAt:
              post.created_at instanceof Date
                ? post.created_at.toISOString()
                : new Date(post.created_at ?? Date.now()).toISOString(),
            updatedAt:
              post.updated_at instanceof Date
                ? post.updated_at.toISOString()
                : new Date(post.updated_at ?? Date.now()).toISOString(),
            viewer: {
              reaction: reaction.key,
              saved: savedSet.has(postId),
            },
          },
        };
      })
      .filter(Boolean);

    const lastReaction = pageReactions[pageReactions.length - 1];
    const nextCursor =
      hasMore && lastReaction?.created_at
        ? encodeCursor({
            createdAt:
              lastReaction.created_at instanceof Date
                ? lastReaction.created_at.toISOString()
                : new Date(lastReaction.created_at).toISOString(),
            id: lastReaction._id.toString(),
          })
        : null;

    return res.status(200).json({
      items,
      paging: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Error in getReactedVideos:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

async function getViewedVideos(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const viewerIdRaw = reqAny.user?.id;
    const viewerId =
      typeof viewerIdRaw === "string" ? viewerIdRaw : viewerIdRaw?.toString?.();
    if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

    const limit = parseLimit(req.query.limit, 10, 1, 50);
    const cursor = decodeCursor(req.query.cursor as string | undefined);

    const cursorFilter = buildCursorFilter(cursor, "updated_at");
    const viewFilter = { user_id: viewerId, ...cursorFilter } as Record<
      string,
      unknown
    >;

    const views = await ViewModel.find(viewFilter)
      .sort({ updated_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore = views.length > limit;
    const pageViews = hasMore ? views.slice(0, limit) : views;

    const postIds = Array.from(
      new Set(pageViews.map((view: any) => String(view.post_id)))
    );
    const posts = await PostModel.find({ _id: { $in: postIds } })
      .lean()
      .exec();
    const postMap = new Map(
      posts.map((post: any) => [post._id.toString(), post])
    );

    const authorIds = Array.from(
      new Set(posts.map((post: any) => String(post.user_id)))
    );
    const authors = await UserModel.find({ _id: { $in: authorIds } })
      .lean()
      .exec();
    const authorMap = new Map(
      authors.map((author: any) => [author._id.toString(), author])
    );

    let reactionMap = new Map<string, string>();
    let savedSet = new Set<string>();
    if (postIds.length > 0) {
      const [reactions, saves] = await Promise.all([
        PostReactionModel.find({
          post_id: { $in: postIds },
          user_id: viewerId,
        })
          .lean()
          .exec(),
        PostSaveModel.find({ post_id: { $in: postIds }, user_id: viewerId })
          .lean()
          .exec(),
      ]);
      reactionMap = new Map(
        reactions.map((reaction: any) => [
          String(reaction.post_id),
          reaction.key,
        ])
      );
      savedSet = new Set(saves.map((save: any) => String(save.post_id)));
    }

    const items = pageViews
      .map((view: any) => {
        const post = postMap.get(String(view.post_id));
        if (!post) return null;

        const author = authorMap.get(String(post.user_id));
        const postId = post._id.toString();
        const lastViewedAt =
          view.updated_at instanceof Date
            ? view.updated_at.toISOString()
            : new Date(
                view.updated_at ?? view.created_at ?? Date.now()
              ).toISOString();
        const firstViewedAt =
          view.created_at instanceof Date
            ? view.created_at.toISOString()
            : new Date(view.created_at ?? Date.now()).toISOString();
        const watchTime =
          typeof view.watch_time === "number" &&
          Number.isFinite(view.watch_time)
            ? view.watch_time
            : 0;

        return {
          postId,
          viewId: String(view._id),
          viewedAt: lastViewedAt,
          firstViewedAt,
          watchTime,
          post: {
            id: postId,
            user: {
              id: String(post.user_id),
              handle: author?.handle || "unknown",
              name: author?.username || "Unknown User",
              avatar: author?.picture_url || "https://i.pravatar.cc/100?img=1",
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
            tags: Array.isArray(post.tags) ? post.tags : [],
            videoSrc: post.video_src ?? "",
            visibility: post.visibility,
            allowComments: post.allow_comments,
            createdAt:
              post.created_at instanceof Date
                ? post.created_at.toISOString()
                : new Date(post.created_at ?? Date.now()).toISOString(),
            updatedAt:
              post.updated_at instanceof Date
                ? post.updated_at.toISOString()
                : new Date(post.updated_at ?? Date.now()).toISOString(),
            viewer: {
              reaction: reactionMap.get(postId) || null,
              saved: savedSet.has(postId),
              viewed: true,
              watchTime,
              lastViewedAt,
            },
          },
        };
      })
      .filter(Boolean);

    const lastView = pageViews[pageViews.length - 1];
    const nextCursor =
      hasMore && lastView?.updated_at
        ? encodeCursor({
            createdAt:
              lastView.updated_at instanceof Date
                ? lastView.updated_at.toISOString()
                : new Date(
                    lastView.updated_at ?? lastView.created_at ?? Date.now()
                  ).toISOString(),
            id: lastView._id.toString(),
          })
        : null;

    return res.status(200).json({
      items,
      paging: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("Error in getViewedVideos:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Send OTP to verify a new email address
async function sendEmailOtp(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const email = req.body?.email;

    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail)
      return res.status(400).json({ message: "Email is required" });

    const emailParts = normalizedEmail.split("@");
    if (emailParts.length !== 2)
      return res.status(400).json({ message: "Invalid email format" });

    const existingEmail = await UserEmailModel.findOne({
      email: normalizedEmail,
      user_id: reqAny.user.id,
    });
    if (existingEmail)
      return res.status(409).json({ message: "Email already exists" });

    const otp = randomInt(100000, 1000000).toString().padStart(6, "0");
    const redisKey = `email-otp:${reqAny.user.id}:${normalizedEmail}`;

    const client = await ensureRedis();
    await client.set(redisKey, otp, { EX: 300 });

    await sendEmailNotification(
      "Email verification code",
      `Your verification code is ${otp}. It expires in 5 minutes.`,
      [normalizedEmail]
    );

    return res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error in sendEmailOtp:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Create a new email for the user
async function createEmail(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const { email, otp } = req.body;
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail)
      return res.status(400).json({ message: "Email is required" });

    const emailParts = normalizedEmail.split("@");
    if (emailParts.length !== 2)
      return res.status(400).json({ message: "Invalid email format" });

    const providedOtp = typeof otp === "string" ? otp.trim() : "";
    if (!providedOtp)
      return res.status(400).json({ message: "OTP is required" });

    const [, emailDomain] = emailParts;

    const existingEmail = await UserEmailModel.findOne({
      email: normalizedEmail,
    });
    if (existingEmail)
      return res.status(409).json({ message: "Email already exists" });

    const redisKey = `email-otp:${reqAny.user.id}:${normalizedEmail}`;

    const client = await ensureRedis();
    const cachedOtp = await client.get(redisKey);

    if (!cachedOtp)
      return res.status(400).json({ message: "OTP expired or invalid" });
    if (cachedOtp !== providedOtp)
      return res.status(400).json({ message: "Incorrect OTP" });

    await client.del(redisKey);

    // If the user is trying to add a work email, ensure they belong to the organization, if this one is the first work email create new organization
    if (emailDomain) {
      let organization = await OrganizationModel.findOne({
        domains: emailDomain,
      });
      if (organization) {
        const membership = await OrganizationMembershipModel.findOne({
          user_id: reqAny.user.id,
          org_id: organization._id,
        });
        if (!membership) {
          // add user to organization
          await OrganizationMembershipModel.create({
            user_id: reqAny.user.id,
            org_id: organization._id,
            role: "member",
          });
        }
      } else {
        // create new organization
        organization = await OrganizationModel.create({
          name: emailDomain.split(".")[0],
          domains: [emailDomain],
          is_work_org: true,
          description: "",
        });
        await OrganizationMembershipModel.create({
          user_id: reqAny.user.id,
          org_id: organization._id,
          role: "member",
        });
      }
    }

    const newEmail = await UserEmailModel.create({
      email: normalizedEmail,
      user_id: reqAny.user.id,
    });
    return res
      .status(201)
      .json({ message: "Email created successfully", email: newEmail });
  } catch (error) {
    console.error("Error in createEmail:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get all emails for the user
async function getEmails(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const emails = await UserEmailModel.find({ user_id: reqAny.user.id });
    return res.status(200).json({ emails });
  } catch (error) {
    console.error("Error in getEmails:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Delete an email for the user
async function deleteEmail(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const { emailId } = req.params;
    if (!emailId)
      return res.status(400).json({ message: "Email ID is required" });

    const email = await UserEmailModel.findOne({
      _id: emailId,
      user_id: reqAny.user.id,
    });
    if (!email) return res.status(404).json({ message: "Email not found" });

    await email.deleteOne();

    // delete organization membership if no more emails from that organization
    const emailParts = email.email.split("@");
    if (emailParts.length === 2) {
      const emailDomain = emailParts[1];
      const organization = await OrganizationModel.findOne({
        domains: emailDomain,
      });
      if (organization) {
        const otherEmails = await UserEmailModel.find({
          user_id: reqAny.user.id,
        });
        const hasOtherOrgEmail = otherEmails.some((e) =>
          e.email.endsWith(`@${emailDomain}`)
        );
        if (!hasOtherOrgEmail) {
          await OrganizationMembershipModel.deleteMany({
            user_id: reqAny.user.id,
            org_id: organization._id,
          });
        }
      }
    }

    return res.status(200).json({ message: "Email deleted successfully" });
  } catch (error) {
    console.error("Error in deleteEmail:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

export {
  createEmail,
  deleteEmail,
  followUser,
  getEmails,
  getReactedVideos,
  getViewedVideos,
  getUserProfile,
  getSavedVideos,
  getUserOrganizations,
  sendEmailOtp,
  getUserIdByHandle,
  updateHandle,
  updateUsername,
  updateProfilePicture,
};
