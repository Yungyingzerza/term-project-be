import express from "express";
import * as services from "../services/explore.services";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";

const exploreRouter = express.Router();
exploreRouter.use(getUserIdFromToken);

// GET /explore?q=searchQuery&type=all|users|organizations|posts&limit&cursor
exploreRouter.get("/", async (req, res) => {
  await services.explore(req, res);
});

export default exploreRouter;
