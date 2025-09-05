import express from "express";
import * as services from "../services/feed.services";

const feedRouter = express.Router();

// GET /feed?algo=for-you|following&limit&cursor
feedRouter.get("/", async (req, res) => {
  await services.getFeed(req, res);
});

export default feedRouter;

