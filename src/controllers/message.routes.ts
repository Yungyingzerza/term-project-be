import express from "express";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";
import * as services from "../services/message.services";

const messageRouter = express.Router();
messageRouter.use(getUserIdFromToken);

// SSE endpoint - establish connection for real-time updates
messageRouter.get("/sse", async (req, res) => {
  await services.connectSSE(req, res);
});

// Get or create a conversation with specific users
messageRouter.post("/conversations", async (req, res) => {
  await services.getOrCreateConversation(req, res);
});

// Get all conversations for the current user
messageRouter.get("/conversations", async (req, res) => {
  await services.getUserConversations(req, res);
});

// Send a message in a conversation
messageRouter.post(
  "/conversations/:conversationId/messages",
  async (req, res) => {
    await services.sendMessage(req, res);
  }
);

// Get messages in a conversation
messageRouter.get(
  "/conversations/:conversationId/messages",
  async (req, res) => {
    await services.getMessages(req, res);
  }
);

// Mark conversation as read
messageRouter.post("/conversations/:conversationId/read", async (req, res) => {
  await services.markAsRead(req, res);
});

// Get total unread message count
messageRouter.get("/unread-count", async (req, res) => {
  await services.getUnreadCount(req, res);
});

// Update conversation settings
messageRouter.patch("/conversations/:conversationId", async (req, res) => {
  await services.updateConversation(req, res);
});

// Health check endpoint for SSE service
messageRouter.get("/sse/stats", async (req, res) => {
  await services.getSSEStats(req, res);
});

export default messageRouter;
