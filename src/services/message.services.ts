import {
  ConversationModel,
  ConversationParticipantModel,
  MessageModel,
  MessageReadModel,
} from "../models";
import { Types } from "mongoose";
import { Request, Response } from "express";
import { sseService } from "./sse.services";

// Get or create a conversation between users
async function getOrCreateConversation(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const { user_ids } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: "user_ids array is required" });
    }

    const userId = reqAny.user.id;
    const otherUserIds = user_ids.map((id) => new Types.ObjectId(id));
    const allUserIds = [userId, ...otherUserIds].sort((a, b) =>
      a.toString().localeCompare(b.toString())
    );

    // Find existing conversation with exact same participants
    const existingParticipants = await ConversationParticipantModel.aggregate([
      {
        $group: {
          _id: "$conversation_id",
          users: { $push: "$user_id" },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: allUserIds.length,
        },
      },
    ]);

    for (const group of existingParticipants) {
      const groupUserIds = group.users.map((id: any) => id.toString()).sort();
      const allUserIdsStr = allUserIds.map((id) => id.toString()).sort();

      if (JSON.stringify(groupUserIds) === JSON.stringify(allUserIdsStr)) {
        const conversation = await ConversationModel.findById(group._id);
        return res.status(200).json({ conversation });
      }
    }

    // Create new conversation
    const conversation = await ConversationModel.create({
      name: null,
      avatar: null,
      last_message_id: null,
      last_message_at: null,
    });

    // Add all participants
    await ConversationParticipantModel.insertMany(
      allUserIds.map((uid) => ({
        conversation_id: conversation._id,
        user_id: uid,
        last_read_at: null,
      }))
    );

    return res.status(200).json({ conversation });
  } catch (error) {
    console.error("Error in getOrCreateConversation:", error);
    return res.status(500).json({ error: "Failed to create conversation" });
  }
}

// Get all conversations for a user
async function getUserConversations(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const before = req.query.before
      ? new Date(req.query.before as string)
      : undefined;

    const query: any = { user_id: userId };

    const participations = await ConversationParticipantModel.find(query)
      .select("conversation_id last_read_at")
      .lean();

    const conversationIds = participations.map((p) => p.conversation_id);

    const conversationQuery: any = { _id: { $in: conversationIds } };
    if (before) {
      conversationQuery.last_message_at = { $lt: before };
    }

    const conversations = await ConversationModel.find(conversationQuery)
      .sort({ last_message_at: -1, _id: -1 })
      .limit(limit)
      .populate("last_message_id")
      .lean();

    // Get participants for each conversation
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (convo) => {
        const participants = await ConversationParticipantModel.find({
          conversation_id: convo._id,
        })
          .populate("user_id", "_id username handle picture_url")
          .lean();

        const userParticipation = participations.find(
          (p) => p.conversation_id.toString() === convo._id.toString()
        );

        // Calculate unread count
        const unreadCount = await MessageModel.countDocuments({
          conversation_id: convo._id,
          created_at: {
            $gt: userParticipation?.last_read_at || new Date(0),
          },
          sender_id: { $ne: userId },
        });

        return {
          ...convo,
          participants: participants.map((p) => ({
            _id: (p.user_id as any)?._id,
            username: (p.user_id as any)?.username,
            handle: (p.user_id as any)?.handle,
            picture_url: (p.user_id as any)?.picture_url,
          })),
          unread_count: unreadCount,
          last_read_at: userParticipation?.last_read_at,
        };
      })
    );

    return res.status(200).json({ conversations: conversationsWithDetails });
  } catch (error) {
    console.error("Error in getUserConversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

// Send a message
async function sendMessage(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const senderId = reqAny.user.id;
    const conversationId = new Types.ObjectId(req.params.conversationId);
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Message text is required" });
    }

    if (text.length > 4000) {
      return res
        .status(400)
        .json({ error: "Message text too long (max 4000 characters)" });
    }

    // Verify sender is participant
    const participant = await ConversationParticipantModel.findOne({
      conversation_id: conversationId,
      user_id: senderId,
    });

    if (!participant) {
      return res
        .status(403)
        .json({ error: "User is not a participant of this conversation" });
    }

    // Create message
    const message = await MessageModel.create({
      conversation_id: conversationId,
      sender_id: senderId,
      text: text.trim(),
    });

    // Update conversation's last_message
    await ConversationModel.findByIdAndUpdate(conversationId, {
      last_message_id: message._id,
      last_message_at: new Date(),
    });

    // Get all participants to notify
    const participants = await ConversationParticipantModel.find({
      conversation_id: conversationId,
      user_id: { $ne: senderId },
    }).lean();

    // Send SSE notification to all other participants
    participants.forEach((p) => {
      sseService.sendToUser(p.user_id.toString(), {
        type: "new_message",
        conversation_id: conversationId.toString(),
        message_id: message._id.toString(),
      });
    });

    return res.status(200).json({ message });
  } catch (error) {
    console.error("Error in sendMessage:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
}

// Get messages in a conversation
async function getMessages(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id;
    const conversationId = new Types.ObjectId(req.params.conversationId);
    const limit = parseInt(req.query.limit as string) || 50;
    const before = req.query.before as string | undefined;

    // Verify user is participant
    const participant = await ConversationParticipantModel.findOne({
      conversation_id: conversationId,
      user_id: userId,
    });

    if (!participant) {
      return res
        .status(403)
        .json({ error: "User is not a participant of this conversation" });
    }

    const query: any = { conversation_id: conversationId };
    if (before) {
      query._id = { $lt: new Types.ObjectId(before) };
    }

    const messages = await MessageModel.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .populate("sender_id", "_id username handle picture_url")
      .lean();

    return res.status(200).json({ messages: messages.reverse() });
  } catch (error) {
    console.error("Error in getMessages:", error);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
}

// Mark messages as read
async function markAsRead(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id;
    const conversationId = new Types.ObjectId(req.params.conversationId);
    const now = new Date();

    // Update participant's last_read_at
    await ConversationParticipantModel.findOneAndUpdate(
      {
        conversation_id: conversationId,
        user_id: userId,
      },
      {
        last_read_at: now,
      }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error in markAsRead:", error);
    return res.status(500).json({ error: "Failed to mark as read" });
  }
}

// Get unread count for user across all conversations
async function getUnreadCount(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id;
    const participations = await ConversationParticipantModel.find({
      user_id: userId,
    }).lean();

    let totalUnread = 0;

    for (const participation of participations) {
      const unread = await MessageModel.countDocuments({
        conversation_id: participation.conversation_id,
        created_at: {
          $gt: participation.last_read_at || new Date(0),
        },
        sender_id: { $ne: userId },
      });

      totalUnread += unread;
    }

    return res.status(200).json({ unread_count: totalUnread });
  } catch (error) {
    console.error("Error in getUnreadCount:", error);
    return res.status(500).json({ error: "Failed to fetch unread count" });
  }
}

// Update conversation settings (name, avatar)
async function updateConversation(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id;
    const conversationId = new Types.ObjectId(req.params.conversationId);
    const { name, avatar } = req.body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (avatar !== undefined) updates.avatar = avatar;

    // Verify user is participant
    const participant = await ConversationParticipantModel.findOne({
      conversation_id: conversationId,
      user_id: userId,
    });

    if (!participant) {
      return res
        .status(403)
        .json({ error: "User is not a participant of this conversation" });
    }

    const conversation = await ConversationModel.findByIdAndUpdate(
      conversationId,
      updates,
      { new: true }
    );

    return res.status(200).json({ conversation });
  } catch (error) {
    console.error("Error in updateConversation:", error);
    return res.status(500).json({ error: "Failed to update conversation" });
  }
}

// SSE connection endpoint
async function connectSSE(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    const userId = reqAny.user.id.toString();
    sseService.addClient(userId, res);
  } catch (error) {
    console.error("Error in connectSSE:", error);
    return res.status(500).json({ error: "Failed to connect to SSE" });
  }
}

// Get SSE stats
async function getSSEStats(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ error: "Authentication required" });

    return res.status(200).json({
      connected_users: sseService.getConnectedUsersCount(),
      total_connections: sseService.getTotalConnectionsCount(),
    });
  } catch (error) {
    console.error("Error in getSSEStats:", error);
    return res.status(500).json({ error: "Failed to get SSE stats" });
  }
}

export {
  getOrCreateConversation,
  getUserConversations,
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount,
  updateConversation,
  connectSSE,
  getSSEStats,
};
