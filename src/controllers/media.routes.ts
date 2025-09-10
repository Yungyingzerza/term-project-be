import express from "express";
import * as services from "../services/media.services";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";
import multer from "multer";
import fs from "fs";
import path from "path";

const mediaRouter = express.Router();
mediaRouter.use(getUserIdFromToken);

// Use disk storage in local ./temp dir to avoid large memory usage and keep files within project
const TEMP_DIR = path.resolve(process.cwd(), "temp");
try {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
} catch {}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TEMP_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok =
      /^video\//.test(file.mimetype) ||
      /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.originalname);
    cb(null, ok);
  },
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB cap
});

mediaRouter.get("/photo/:object", async (req, res) => {
  await services.photo(req, res);
});
// Proxy stream from MinIO with Range support
// Example: GET /media/firstbucket/path/to/file.mp4
mediaRouter.get("/:bucket/:object", async (req, res) => {
  await services.streamObject(req, res);
});

// Upload video -> ffmpeg transcode -> MinIO -> create Post
mediaRouter.post("/upload", upload.single("video"), async (req, res) => {
  await services.uploadVideo(req, res);
});

// HEAD for metadata probing (length, type, ranges)
// mediaRouter.head("/:bucket{/*path}", async (req, res) => {
//   await services.headObject(req, res);
// });

export default mediaRouter;
