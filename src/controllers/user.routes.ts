import express from "express";
import * as services from "../services/user.services";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";

const userRouter = express.Router();
userRouter.use(getUserIdFromToken);

userRouter.post("/email", async (req, res) => {
    await services.createEmail(req, res);
});

userRouter.get("/email", async (req, res) => {
    await services.getEmails(req, res);
});

userRouter.delete("/email/:emailId", async (req, res) => {
    await services.deleteEmail(req, res);
});

export default userRouter;
