import express from "express";
import * as services from "../services/media.services";

const mediaRouter = express.Router();

// Proxy stream from MinIO with Range support
// Example: GET /media/firstbucket/path/to/file.mp4
mediaRouter.get("/:bucket{/*path}", async (req, res) => {
  await services.streamObject(req, res);
});

// HEAD for metadata probing (length, type, ranges)
// mediaRouter.head("/:bucket{/*path}", async (req, res) => {
//   await services.headObject(req, res);
// });

export default mediaRouter;
