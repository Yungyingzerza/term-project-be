import express from "express";
import * as services from "../services/line.services";
const lineRouter = express.Router();

lineRouter.get("/authentication", async (req, res) => {
  await services.authentication(req, res);
});

lineRouter.get("/callback", async (req, res) => {
  await services.authorization(req, res);
});

export default lineRouter;
