import express from "express";
import * as services from "../services/media.services";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";

const mediaRouter = express.Router();
mediaRouter.use(getUserIdFromToken);

mediaRouter.get("/photo/:object", async (req, res) => {
  await services.photo(req, res);
});
// Proxy stream from MinIO with Range support
// Example: GET /media/firstbucket/path/to/file.mp4
mediaRouter.get("/:bucket/:object", async (req, res) => {
  await services.streamObject(req, res);
});

// HEAD for metadata probing (length, type, ranges)
// mediaRouter.head("/:bucket{/*path}", async (req, res) => {
//   await services.headObject(req, res);
// });

export default mediaRouter;
