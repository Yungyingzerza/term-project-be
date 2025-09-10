import { Request, Response } from "express";
import { minioClient } from "../lib/minio";
import { PostModel } from "../models";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { spawn } from "child_process";

const unlinkAsync = promisify(fs.unlink);

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
    const bucket = req.params.bucket;
    const objectKey = req.params.object;
    if (!bucket || !objectKey) {
      return res.status(400).json({ message: "Missing bucket or object key" });
    }

    const objectKeyWithExtension = `${objectKey}.mp4`;

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
    const bucket = "firstbucket";
    const objectKey = req.params.object + ".jpg";
    if (!objectKey) {
      return res.status(400).json({ message: "Missing object key" });
    }

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

async function ensureBucket(bucket: string) {
  const exists = await minioClient.bucketExists(bucket).catch(() => false);
  if (!exists) await minioClient.makeBucket(bucket, "us-east-1");
}

export async function uploadVideo(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });
    const file = reqAny.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "Missing file 'video'" });

    // 1) Create a Post first to get postId
    const { caption, music, visibility, allowComments } = req.body as any;
    const post = await PostModel.create({
      user_id: reqAny.user.id,
      caption: caption || "",
      music: music || "",
      video_src: "temp",
      visibility: visibility || "Public",
      allow_comments:
        typeof allowComments === "string"
          ? allowComments === "true"
          : allowComments ?? true,
    });
    const postId = String(post._id);

    // 2) Probe original
    const info = await ffprobe(file.path);
    const outPath = path.join(path.dirname(file.path), `${postId}.mp4`);

    // 3) Transcode with requested parameters based on original
    await runFfmpeg(file.path, outPath, {
      height: info.height || 1080,
      fps: info.fps || 30,
      audioBitrateK: info.audioBitrateK ?? 128,
    });

    // 4) Upload to MinIO
    const bucket = process.env.MINIO_BUCKET || "firstbucket";
    await ensureBucket(bucket);
    const objectName = `${postId}.mp4`;
    const meta = { "Content-Type": "video/mp4" } as any;
    await minioClient.fPutObject(bucket, objectName, outPath, meta);

    // 5) Update Post with video_src and maybe thumbnail later
    const video_src = `${req.protocol}://${req.get(
      "host"
    )}/media/${bucket}/${postId}`;
    post.video_src = video_src;
    await post.save();

    console.log("delete", file.path, outPath);

    // 6) Cleanup temp files
    try {
      await unlinkAsync(file.path);
      await unlinkAsync(outPath);
    } catch {}

    return res.status(201).json({ postId, post });
  } catch (err: any) {
    console.error("uploadVideo error", err);
    return res.status(500).json({
      message: "Failed to upload",
      error: err?.message || String(err),
    });
  }
}
