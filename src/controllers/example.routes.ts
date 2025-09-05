import express from "express";
import * as services from "../services/example.services";
const exampleRouter = express.Router();

exampleRouter.get("/", async (req, res) => {
  await services.example(req, res);
});

export default exampleRouter;
