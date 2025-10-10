import express from "express";
import * as services from "../services/feed.services";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";
const feedRouter = express.Router();
feedRouter.use(getUserIdFromToken);

// GET /feed?algo=for-you|following&limit&cursor
feedRouter.get("/", async (req, res) => {
  await services.getFeed(req, res);
});
// GET /feed/user/handle/:handle?limit&cursor
feedRouter.get("/user/handle/:handle", async (req, res) => {
  await services.getFeedByUserHandle(req, res);
});

// GET /feed/organization/:orgId?limit&cursor
feedRouter.get("/organization/:orgId", async (req, res) => {
  await services.getFeedByOrganizationId(req, res);
});

// PUT /feed/:postId/reaction { key: ReactionKey }
feedRouter.put("/:postId/reaction", async (req, res) => {
  await services.reactToPost(req, res);
});

// DELETE /feed/:postId/reaction
feedRouter.delete("/:postId/reaction", async (req, res) => {
  await services.removeReaction(req, res);
});

// PUT /feed/:postId/save
feedRouter.put("/:postId/save", async (req, res) => {
  await services.savePost(req, res);
});

// DELETE /feed/:postId/save
feedRouter.delete("/:postId/save", async (req, res) => {
  await services.removeSave(req, res);
});

// POST /feed/:postId/views { watchTimeSeconds }
feedRouter.post("/:postId/views", async (req, res) => {
  await services.recordView(req, res);
});

// POST /feed/:postId/comments
feedRouter.post("/:postId/comments", async (req, res) => {
  await services.addComment(req, res);
});

// POST /feed/:postId/comments/:commentId/replies
feedRouter.post("/:postId/comments/:commentId/replies", async (req, res) => {
  await services.addReply(req, res);
});

// GET /feed/:postId/comments/:commentId/replies?limit&cursor
feedRouter.get("/:postId/comments/:commentId/replies", async (req, res) => {
  await services.getRepliesByCommentId(req, res);
});

// GET /feed/:postId
feedRouter.get("/:postId", async (req, res) => {
  await services.getPostById(req, res);
});

// GET /feed/:postId/comments?limit&cursor
feedRouter.get("/:postId/comments", async (req, res) => {
  await services.getCommentsByPostId(req, res);
});

export default feedRouter;
