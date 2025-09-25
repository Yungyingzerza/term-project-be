import express from "express";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";
import * as services from "../services/user.services";

const userRouter = express.Router();
userRouter.use(getUserIdFromToken);

userRouter.get("/profile/:userId", async (req, res) => {
    await services.getUserProfile(req, res);
});

userRouter.post("/follow", async (req, res) => {
    await services.followUser(req, res);
});

userRouter.post("/email", async (req, res) => {
    await services.createEmail(req, res);
});

userRouter.get("/email", async (req, res) => {
    await services.getEmails(req, res);
});

userRouter.delete("/email/:emailId", async (req, res) => {
    await services.deleteEmail(req, res);
});

userRouter.get("/reactions/videos", async (req, res) => {
    await services.getReactedVideos(req, res);
});

userRouter.get("/saves/videos", async (req, res) => {
    await services.getSavedVideos(req, res);
});

export default userRouter;
