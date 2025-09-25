import { Request, Response } from "express";
import { Types } from "mongoose";
import { FollowModel, OrganizationMembershipModel, OrganizationModel, PostModel, PostReactionModel, PostSaveModel, UserEmailModel, UserModel } from "../models";

type ReactionCursorToken = { createdAt: string; id: string };

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

function encodeCursor(cursor: ReactionCursorToken): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

function decodeCursor(raw?: string | null): ReactionCursorToken | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        if (typeof parsed?.createdAt === "string" && typeof parsed?.id === "string") {
            return parsed as ReactionCursorToken;
        }
    } catch {
        // ignore malformed cursor
    }
    return null;
}

function buildReactionCursorFilter(cursor: ReactionCursorToken | null) {
    if (!cursor) return {};

    const createdAt = new Date(cursor.createdAt);
    if (Number.isNaN(createdAt.getTime())) return {};

    if (!Types.ObjectId.isValid(cursor.id)) {
        return { created_at: { $lt: createdAt } };
    }

    const reactionId = new Types.ObjectId(cursor.id);
    return {
        $or: [
            { created_at: { $lt: createdAt } },
            { created_at: createdAt, _id: { $lt: reactionId } },
        ],
    };
}

// Get user profile by user ID
async function getUserProfile(req: Request, res: Response) {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ message: "User ID is required" });

        const user = await UserModel.findById(userId).select("-password");
        if (!user) return res.status(404).json({ message: "User not found" });

        // Get follower and following counts
        const followerCount = await FollowModel.countDocuments({ followee_id: userId });
        const followingCount = await FollowModel.countDocuments({ follower_id: userId });

        // Count posts
        const postCount = await PostModel.countDocuments({ user_id: userId });

        // Check if viewer is following this user
        const reqAny = req as any;
        let isFollowing = null;
        if (reqAny.user?.id && reqAny.user.id != userId) {
            const existingFollow = await FollowModel.findOne({ follower_id: reqAny.user.id, followee_id: userId });
            isFollowing = !!existingFollow;
        }

        return res.status(200).json({ user, follower_count: followerCount, following_count: followingCount, post_count: postCount, is_following: isFollowing });
    } catch (error) {
        console.error("Error in getUserProfile:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

// Get user's organizations
async function getUserOrganizations(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const memberships = await OrganizationMembershipModel.find({ user_id: reqAny.user.id }).populate("org_id").exec();
        const organizations = memberships.map(m => m.org_id);

        return res.status(200).json({ organizations });
    } catch (error) {
        console.error("Error in getUserOrganizations:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

// Handle following and unfollowing users
async function followUser(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const { targetUserId, action } = req.body;
        if (!targetUserId || !action) return res.status(400).json({ message: "Target user ID and action are required" });
        if (action !== "follow" && action !== "unfollow") return res.status(400).json({ message: "Invalid action" });
        if (targetUserId === reqAny.user.id) return res.status(400).json({ message: "Cannot follow/unfollow yourself" });

        const targetUser = await UserModel.findById(targetUserId);
        if (!targetUser) return res.status(404).json({ message: "Target user not found" });

        if (action === "follow") {
            const existingFollow = await FollowModel.findOne({ follower_id: reqAny.user.id, followee_id: targetUserId });
            if (existingFollow) return res.status(409).json({ message: "Already following this user" });

            await FollowModel.create({ follower_id: reqAny.user.id, followee_id: targetUserId });
            return res.status(200).json({ message: "Successfully followed the user" });
        } else {
            const existingFollow = await FollowModel.findOne({ follower_id: reqAny.user.id, followee_id: targetUserId });
            if (!existingFollow) return res.status(404).json({ message: "Not following this user" });

            await existingFollow.deleteOne();
            return res.status(200).json({ message: "Successfully unfollowed the user" });
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
        const viewerId = typeof viewerIdRaw === "string" ? viewerIdRaw : viewerIdRaw?.toString?.();
        if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

        const limit = parseLimit(req.query.limit, 10, 1, 50);
        const cursor = decodeCursor(req.query.cursor as string | undefined);

        const cursorFilter = buildReactionCursorFilter(cursor);
        const saveFilter = { user_id: viewerId, ...cursorFilter } as Record<string, unknown>;

        const saves = await PostSaveModel.find(saveFilter)
            .sort({ created_at: -1, _id: -1 })
            .limit(limit + 1)
            .lean()
            .exec();

        const hasMore = saves.length > limit;
        const pageSaves = hasMore ? saves.slice(0, limit) : saves;

        const postIds = Array.from(new Set(pageSaves.map((save: any) => String(save.post_id))));
        const posts = await PostModel.find({ _id: { $in: postIds } }).lean().exec();
        const postMap = new Map(posts.map((post: any) => [post._id.toString(), post]));

        const authorIds = Array.from(new Set(posts.map((post: any) => String(post.user_id))));
        const authors = await UserModel.find({ _id: { $in: authorIds } }).lean().exec();
        const authorMap = new Map(authors.map((author: any) => [author._id.toString(), author]));

        let reactionMap = new Map<string, string>();
        if (postIds.length > 0) {
            const reactions = await PostReactionModel.find({ post_id: { $in: postIds }, user_id: viewerId }).lean().exec();
            reactionMap = new Map(reactions.map((reaction: any) => [String(reaction.post_id), reaction.key]));
        }

        const items = pageSaves
            .map((save: any) => {
                const post = postMap.get(String(save.post_id));
                if (!post) return null;
                const author = authorMap.get(String(post.user_id));
                const postId = post._id.toString();
                return {
                    postId,
                    savedAt: save.created_at instanceof Date
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
                        createdAt: post.created_at instanceof Date
                            ? post.created_at.toISOString()
                            : new Date(post.created_at ?? Date.now()).toISOString(),
                        updatedAt: post.updated_at instanceof Date
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
        const nextCursor = hasMore && lastSave?.created_at
            ? encodeCursor({
                createdAt: lastSave.created_at instanceof Date
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
        const viewerId = typeof viewerIdRaw === "string" ? viewerIdRaw : viewerIdRaw?.toString?.();
        if (!viewerId) return res.status(401).json({ message: "Unauthorized" });

        const limit = parseLimit(req.query.limit, 10, 1, 50);
        const cursor = decodeCursor(req.query.cursor as string | undefined);

        const cursorFilter = buildReactionCursorFilter(cursor);
        const reactionFilter = { user_id: viewerId, ...cursorFilter } as Record<string, unknown>;

        const reactions = await PostReactionModel.find(reactionFilter)
            .sort({ created_at: -1, _id: -1 })
            .limit(limit + 1)
            .lean()
            .exec();

        const hasMore = reactions.length > limit;
        const pageReactions = hasMore ? reactions.slice(0, limit) : reactions;

        const postIds = Array.from(new Set(pageReactions.map((reaction: any) => String(reaction.post_id))));
        const posts = await PostModel.find({ _id: { $in: postIds } }).lean().exec();
        const postMap = new Map(posts.map((post: any) => [post._id.toString(), post]));

        const authorIds = Array.from(new Set(posts.map((post: any) => String(post.user_id))));
        const authors = await UserModel.find({ _id: { $in: authorIds } }).lean().exec();
        const authorMap = new Map(authors.map((author: any) => [author._id.toString(), author]));

        let savedSet = new Set<string>();
        if (postIds.length > 0) {
            const saves = await PostSaveModel.find({ post_id: { $in: postIds }, user_id: viewerId }).lean().exec();
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
                    reactedAt: reaction.created_at instanceof Date
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
                        createdAt: post.created_at instanceof Date
                            ? post.created_at.toISOString()
                            : new Date(post.created_at ?? Date.now()).toISOString(),
                        updatedAt: post.updated_at instanceof Date
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
        const nextCursor = hasMore && lastReaction?.created_at
            ? encodeCursor({
                createdAt: lastReaction.created_at instanceof Date
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

// Create a new email for the user
async function createEmail(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const { email } = req.body;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

        if (!normalizedEmail) return res.status(400).json({ message: "Email is required" });

        const emailParts = normalizedEmail.split("@");
        if (emailParts.length !== 2) return res.status(400).json({ message: "Invalid email format" });

        const [, emailDomain] = emailParts;

        const existingEmail = await UserEmailModel.findOne({ email: normalizedEmail, user_id: reqAny.user.id });
        if (existingEmail) return res.status(409).json({ message: "Email already exists" });
        
        // If the user is trying to add a work email, ensure they belong to the organization, if this one is the first work email create new organization
        if (emailDomain) {
            let organization = await OrganizationModel.findOne({ domains: emailDomain });
            if (organization) {
                const membership = await OrganizationMembershipModel.findOne({ user_id: reqAny.user.id, org_id: organization._id });
                if (!membership) {
                    // add user to organization
                    await OrganizationMembershipModel.create({ user_id: reqAny.user.id, org_id: organization._id, role: "member" });
                }
            } else {
                // create new organization
                organization = await OrganizationModel.create({ name: emailDomain.split(".")[0], domains: [emailDomain] });
                await OrganizationMembershipModel.create({ user_id: reqAny.user.id, org_id: organization._id, role: "member" });
            }
        }

        const newEmail = await UserEmailModel.create({ email: normalizedEmail, user_id: reqAny.user.id });
        return res.status(201).json({ message: "Email created successfully", email: newEmail });
    } catch (error) {
        console.error("Error in createEmail:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

// Get all emails for the user
async function getEmails(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

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
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const { emailId } = req.params;
        if (!emailId) return res.status(400).json({ message: "Email ID is required" });

        const email = await UserEmailModel.findOne({ _id: emailId, user_id: reqAny.user.id });
        if (!email) return res.status(404).json({ message: "Email not found" });

        await email.deleteOne();

        // delete organization membership if no more emails from that organization
        const emailParts = email.email.split("@");
        if (emailParts.length === 2) {
            const emailDomain = emailParts[1];
            const organization = await OrganizationModel.findOne({ domains: emailDomain });
            if (organization) {
                const otherEmails = await UserEmailModel.find({ user_id: reqAny.user.id });
                const hasOtherOrgEmail = otherEmails.some(e => e.email.endsWith(`@${emailDomain}`));
                if (!hasOtherOrgEmail) {
                    await OrganizationMembershipModel.deleteMany({ user_id: reqAny.user.id, org_id: organization._id });
                }
            }
        }

        return res.status(200).json({ message: "Email deleted successfully" });
    } catch (error) {
        console.error("Error in deleteEmail:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

export { createEmail, deleteEmail, followUser, getEmails, getReactedVideos, getUserProfile, getSavedVideos, getUserOrganizations };

