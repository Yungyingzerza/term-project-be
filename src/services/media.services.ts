import { Request, Response } from "express";
import { minioClient } from "../lib/minio";
import { PostModel } from "../models";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { spawn } from "child_process";

const unlinkAsync = promisify(fs.unlink);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeUnlink(p?: string, label?: string) {
  if (!p) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fs.promises.unlink(p);
      return;
    } catch (err: any) {
      if (err?.code === "ENOENT") return; // already gone
      if (err?.code === "EBUSY" || err?.code === "EPERM") {
        // transient lock; backoff and retry
        await wait(150 * attempt);
        continue;
      }
      // Log and stop retrying on other errors
      console.warn(`Failed to unlink ${label || "file"} at ${p}:`, err);
      return;
    }
  }
}

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MiB for better CDN caching

function parseRange(rangeHeader: string | undefined, size: number) {
  if (!rangeHeader) return null;
  const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end } as const;
}

export async function streamObject(req: Request, res: Response) {
  try {
    const bucket = "users";
    const owner = req.params.user;
    const postId = req.params.postId;
    const objectKeyBase = req.params.object;

    if (!bucket || !objectKeyBase) {
      return res.status(400).json({ message: "Missing bucket or object key" });
    }

    const objectKeyWithExtension = `${owner}/${postId}/${objectKeyBase}.mp4`;

    const stat = await minioClient.statObject(bucket, objectKeyWithExtension);
    const size = stat.size as number;
    const inferred = "video/mp4";
    const contentType =
      (stat as any).contentType ||
      (stat as any).metaData?.["content-type"] ||
      inferred;

    const parsed = parseRange(req.headers.range as string | undefined, size);

    // Determine chunk window
    let start = parsed?.start ?? 0;
    if (start >= size) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    const requestedEnd = parsed?.end ?? size - 1;
    const end = Math.min(start + CHUNK_SIZE - 1, requestedEnd, size - 1);
    const length = end - start + 1;

    const stream = await minioClient.getPartialObject(
      bucket,
      objectKeyWithExtension,
      start,
      length
    );
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(length));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Vary", "Range");
    if ((stat as any).etag) res.setHeader("ETag", (stat as any).etag);
    if ((stat as any).lastModified)
      res.setHeader(
        "Last-Modified",
        new Date((stat as any).lastModified).toUTCString()
      );
    res.setHeader("Cache-Control", "public, max-age=86400");
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (err: any) {
    if (err?.code === "NoSuchKey" || err?.code === "NotFound") {
      return res.status(404).json({ message: "Object not found" });
    }
    return res.status(500).json({ message: "Failed to stream object" });
  }
}

export async function photo(req: Request, res: Response) {
  try {
    const bucket = "users";
    const owner = req.params.user;
    const postId = req.params.postId;
    const objectKeyBase = req.params.object;

    if (!objectKeyBase) {
      return res.status(400).json({ message: "Missing object key" });
    }
    const objectKey = `${owner}/${postId}/${objectKeyBase}.jpg`;

    const stat = await minioClient.statObject(bucket, objectKey);
    const size = stat.size as number;
    const inferred = "image/jpeg";
    const contentType =
      (stat as any).contentType ||
      (stat as any).metaData?.["content-type"] ||
      inferred;

    const stream = await minioClient.getObject(bucket, objectKey);
    res.status(200);
    res.setHeader("Content-Length", String(size));
    res.setHeader("Content-Type", contentType);
    if ((stat as any).etag) res.setHeader("ETag", (stat as any).etag);
    if ((stat as any).lastModified)
      res.setHeader(
        "Last-Modified",
        new Date((stat as any).lastModified).toUTCString()
      );
    res.setHeader("Cache-Control", "public, max-age=86400");
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (err: any) {
    if (err?.code === "NoSuchKey" || err?.code === "NotFound") {
      return res.status(404).json({ message: "Photo not found" });
    }
    return res.status(500).json({ message: "Failed to get photo" });
  }
}

type ProbeInfo = {
  width: number;
  height: number;
  fps: number;
  audioBitrateK: number | null;
};

async function ffprobe(filePath: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate",
      "-of",
      "default=nw=1:nk=1",
      filePath,
    ];
    const proc = spawn("ffprobe", args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited ${code}`));
      const lines = out.trim().split(/\r?\n/);
      const [wStr, hStr, fpsStr] = lines;
      const width = parseInt(wStr, 10) || 0;
      const height = parseInt(hStr, 10) || 0;
      // fpsStr like "30000/1001" or "30/1"
      const fpsParts = (fpsStr || "0/1").split("/");
      const fps =
        fpsParts.length === 2
          ? Number(fpsParts[0]) / Number(fpsParts[1])
          : Number(fpsStr);

      // Probe audio bitrate (kbps)
      const aargs = [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=bit_rate",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ];
      const aproc = spawn("ffprobe", aargs);
      let aout = "";
      let aerr = "";
      aproc.stdout.on("data", (d) => (aout += d.toString()));
      aproc.stderr.on("data", (d) => (aerr += d.toString()));
      aproc.on("close", (acode) => {
        if (acode !== 0) {
          // No audio stream fallback
          return resolve({
            width,
            height,
            fps: Math.round(fps) || 30,
            audioBitrateK: null,
          });
        }
        const bit = parseInt(aout.trim(), 10);
        const audioBitrateK = Number.isFinite(bit)
          ? Math.round(bit / 1000)
          : null;
        resolve({ width, height, fps: Math.round(fps) || 30, audioBitrateK });
      });
    });
  });
}

function runFfmpeg(
  input: string,
  output: string,
  opts: { height: number; fps: number; audioBitrateK: number | null }
) {
  const { height, fps, audioBitrateK } = opts;
  const args = [
    "-y",
    "-i",
    input,
    "-vf",
    `scale=-2:${height},fps=${Math.max(1, Math.round(fps))}`,
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "23",
    "-profile:v",
    "high",
    "-level",
    "5.2",
    "-x264-params",
    "keyint=240:min-keyint=240:scenecut=0:vbv-maxrate=24000:vbv-bufsize=48000",
    ...(audioBitrateK ? ["-c:a", "aac", "-b:a", `${audioBitrateK}k`] : ["-an"]),
    "-movflags",
    "+faststart",
    output,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg exited ${code}`));
    });
  });
}

function extractThumbnail(
  input: string,
  output: string,
  opts: { height: number; ss?: number } = { height: 720 }
) {
  const { height, ss } = opts;
  const args = [
    "-y",
    ...(ss ? ["-ss", String(ss)] : ["-ss", "0.5"]),
    "-i",
    input,
    "-vf",
    `scale=-2:${height}`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    output,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `ffmpeg (thumbnail) exited ${code}`));
    });
  });
}

async function ensureBucket(bucket: string) {
  const exists = await minioClient.bucketExists(bucket).catch(() => false);
  if (!exists) await minioClient.makeBucket(bucket, "us-east-1");
}

export async function uploadVideo(req: Request, res: Response) {
  let inPath: string | undefined;
  let outPath: string | undefined;
  let thumbPath: string | undefined;
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });
    const file = reqAny.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "Missing file 'video'" });
    inPath = file.path;
    const userId = String(reqAny.user.id);

    // 1) Create a Post first to get postId
    const { caption, music, visibility, allowComments } = req.body as any;
    const post = await PostModel.create({
      user_id: reqAny.user.id,
      caption: caption || "",
      music: music || "",
      video_src: "temp",
      visibility: "Private",
      allow_comments:
        typeof allowComments === "string"
          ? allowComments === "true"
          : allowComments ?? true,
    });
    const postId = String(post._id);

    // 2) Probe original
    const info = await ffprobe(file.path);
    outPath = path.join(path.dirname(file.path), `${postId}.mp4`);

    // 3) Transcode with requested parameters based on original
    await runFfmpeg(file.path, outPath, {
      height: info.height || 1080,
      fps: info.fps || 30,
      audioBitrateK: info.audioBitrateK ?? 128,
    });

    // 4) Upload to MinIO
    const bucket = process.env.MINIO_BUCKET || "users";
    await ensureBucket(bucket);
    const basePath = `${userId}/${postId}/${postId}`;
    const objectName = `${basePath}.mp4`;
    const meta = { "Content-Type": "video/mp4" } as any;
    await minioClient.fPutObject(bucket, objectName, outPath, meta);

    // 5) Generate and upload thumbnail (JPEG from near first frame)
    const thumbHeight = Math.min(720, info.height || 720);
    thumbPath = path.join(path.dirname(outPath), `${postId}.jpg`);
    try {
      await extractThumbnail(outPath, thumbPath, {
        height: thumbHeight,
        ss: 0.5,
      });
      const thumbMeta = { "Content-Type": "image/jpeg" } as any;
      await minioClient.fPutObject(
        bucket,
        `${basePath}.jpg`,
        thumbPath,
        thumbMeta
      );
    } catch (e) {
      console.warn("thumbnail generation/upload failed:", e);
    }

    // 6) Update Post with video_src and thumbnail
    const video_src = `${req.protocol}://${req.get("host")}/media/${basePath}`;
    const thumbnail = `${req.protocol}://${req.get(
      "host"
    )}/media/photo/${basePath}`;
    post.video_src = video_src;
    post.thumbnail = thumbnail;
    post.visibility = visibility || "Public";
    await post.save();

    // Cleanup is handled in finally

    return res.status(201).json({ postId, post });
  } catch (err: any) {
    console.error("uploadVideo error", err);
    return res.status(500).json({
      message: "Failed to upload",
      error: err?.message || String(err),
    });
  } finally {
    // Always attempt to clean up temp files
    await safeUnlink(inPath, "upload temp");
    await safeUnlink(outPath, "transcoded temp");
    await safeUnlink(thumbPath, "thumbnail temp");
  }
}
