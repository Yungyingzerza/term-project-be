import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { Types } from "mongoose";
import { minioClient } from "../lib/minio";
import {
  FollowModel,
  OrganizationMembershipModel,
  PostModel,
  PostOrgModel,
  UserModel,
} from "../models";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VisibilityOption = "Public" | "Friends" | "Private" | "Organizations";

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  "Public",
  "Friends",
  "Private",
  "Organizations",
];

function normalizeVisibility(raw: unknown): VisibilityOption {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const canonical =
        trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
      if ((VISIBILITY_OPTIONS as string[]).includes(canonical)) {
        return canonical as VisibilityOption;
      }
    }
  }
  return "Public";
}

function extractHashtags(source: unknown): string[] {
  if (typeof source !== "string") return [];
  const matches = source.match(/#([\p{L}0-9_]+)/gu) ?? [];
  const unique = new Set(
    matches
      .map((tag) => tag.slice(1).trim())
      .filter(Boolean)
      .map((tag) => tag.toLowerCase())
  );
  return Array.from(unique);
}

function coerceStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const acc: string[] = [];
    for (const item of value) {
      acc.push(...coerceStringArray(item));
    }
    return acc;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return coerceStringArray(parsed);
      } catch {
        // fall through to other parsing strategies
      }
    }
    if (trimmed.includes(",")) {
      return trimmed
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

function firstHeader(req: Request, header: string): string | undefined {
  const value = req.get(header);
  if (!value) return undefined;
  return value.split(",")[0]?.trim() || undefined;
}

function resolveConfiguredBase(): string | undefined {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function resolvePublicBase(req: Request): string {
  const configured = resolveConfiguredBase();
  if (configured) return configured;

  const proto = firstHeader(req, "X-Forwarded-Proto") || req.protocol;
  const host =
    firstHeader(req, "X-Forwarded-Host") || req.get("host") || "localhost";
  const forwardedPort = firstHeader(req, "X-Forwarded-Port");

  let origin = `${proto}://${host}`;
  if (forwardedPort && !host.includes(":")) {
    origin = `${proto}://${host}:${forwardedPort}`;
  }

  let prefixSource =
    process.env.PUBLIC_BASE_PATH?.trim() ||
    firstHeader(req, "X-Forwarded-Prefix");
  if (!prefixSource && process.env.NODE_ENV === "production") {
    prefixSource = "chillchill";
  }
  if (prefixSource) {
    const normalized = prefixSource.split("/").filter(Boolean).join("/");
    if (normalized) {
      origin = `${origin}/${normalized}`;
    }
  }

  return origin.replace(/\/+$/, "");
}

function buildPublicUrl(req: Request, pathname: string): string {
  const base = resolvePublicBase(req);
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const relativePath = pathname.replace(/^\/+/, "");
  return new URL(relativePath, baseWithSlash).toString();
}

function pickImageExtension(file: Express.Multer.File): string {
  const fromName = path.extname(file.originalname || "").toLowerCase();
  if (/^\.[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  const subtype = (file.mimetype || "").split("/")[1];
  if (subtype) {
    const clean = subtype
      .split("+")[0]
      ?.replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    if (clean) {
      return `.${clean}`;
    }
  }
  return ".jpg";
}

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

type LeanPost = {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  visibility: VisibilityOption;
};

async function ensureCanViewPost(
  req: Request,
  res: Response,
  ownerParam: string | undefined,
  postId: string | undefined
): Promise<LeanPost | null> {
  if (!postId || !Types.ObjectId.isValid(postId)) {
    res.status(404).json({ message: "Post not found" });
    return null;
  }

  const post = (await PostModel.findById(postId)
    .select("_id user_id visibility")
    .lean()
    .exec()) as LeanPost | null;

  if (!post) {
    res.status(404).json({ message: "Post not found" });
    return null;
  }

  const ownerId = post.user_id.toString();
  if (ownerParam && ownerParam !== ownerId) {
    res.status(404).json({ message: "Post not found" });
    return null;
  }

  const reqAny = req as any;
  const viewerRaw = reqAny.user?.id ?? null;
  const viewerId = viewerRaw ? viewerRaw.toString() : undefined;

  if (post.visibility === "Public") {
    return post;
  }

  if (viewerId && viewerId === ownerId) {
    return post;
  }

  if (!viewerRaw) {
    res.status(403).json({ message: "Post is not accessible" });
    return null;
  }

  switch (post.visibility) {
    case "Private": {
      res.status(403).json({ message: "Post is not accessible" });
      return null;
    }
    case "Friends": {
      const [viewerFollowsOwner, ownerFollowsViewer] = await Promise.all([
        FollowModel.exists({
          follower_id: viewerRaw,
          followee_id: post.user_id,
        }).exec(),
        FollowModel.exists({
          follower_id: post.user_id,
          followee_id: viewerRaw,
        }).exec(),
      ]);

      if (viewerFollowsOwner && ownerFollowsViewer) {
        return post;
      }

      res.status(403).json({ message: "Post is not accessible" });
      return null;
    }
    case "Organizations": {
      const postOrgs = await PostOrgModel.find({ post_id: post._id })
        .select("org_id")
        .lean()
        .exec();
      const orgIds = postOrgs.map((entry: any) => entry.org_id);
      if (orgIds.length === 0) {
        res.status(403).json({ message: "Post is not accessible" });
        return null;
      }

      const membership = await OrganizationMembershipModel.exists({
        user_id: viewerRaw,
        org_id: { $in: orgIds },
      }).exec();

      if (membership) {
        return post;
      }

      res.status(403).json({ message: "Post is not accessible" });
      return null;
    }
    default: {
      res.status(403).json({ message: "Post is not accessible" });
      return null;
    }
  }
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

    if (!(await ensureCanViewPost(req, res, owner, postId))) return;

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
    if (!(await ensureCanViewPost(req, res, owner, postId))) return;
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

      resolve({ width, height, fps: Math.round(fps) || 30 });
    });
  });
}

function runFfmpeg(
  input: string,
  output: string,
  opts: { height: number; fps: number }
) {
  const { height, fps } = opts;
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
    "-c:a",
    "copy",
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

    const body = req.body as any;
    const caption =
      typeof body?.caption === "string"
        ? body.caption
        : body?.caption?.toString?.() ?? "";
    const music =
      typeof body?.music === "string"
        ? body.music
        : body?.music?.toString?.() ?? "";
    const allowCommentsRaw = body?.allowComments;
    const allowComments =
      typeof allowCommentsRaw === "string"
        ? allowCommentsRaw === "true"
        : allowCommentsRaw ?? true;

    const requestedVisibility = normalizeVisibility(body?.visibility);
    const wantsOrgOnlyVisibility = requestedVisibility === "Organizations";
    const orgIdsRaw = body?.orgIds ?? body?.org_id ?? body?.org_ids;
    let orgIdStrings = Array.from(
      new Set(
        coerceStringArray(orgIdsRaw)
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );

    let membershipDocs:
      | { org_id: Types.ObjectId | string }[]
      | null
      | undefined = null;

    if (wantsOrgOnlyVisibility && orgIdStrings.length === 0) {
      membershipDocs = await OrganizationMembershipModel.find({
        user_id: reqAny.user.id,
      })
        .select("org_id")
        .lean()
        .exec();
      orgIdStrings = Array.from(
        new Set(
          (membershipDocs || []).map((entry: any) => String(entry.org_id))
        )
      );
    }

    const invalidOrgIds = orgIdStrings.filter(
      (id) => !Types.ObjectId.isValid(id)
    );
    if (invalidOrgIds.length > 0) {
      return res.status(400).json({
        message: "Invalid organization id(s)",
        orgIds: invalidOrgIds,
      });
    }

    let orgObjectIds: Types.ObjectId[] = [];
    if (orgIdStrings.length > 0) {
      const memberships =
        membershipDocs ??
        (await OrganizationMembershipModel.find({
          user_id: reqAny.user.id,
          org_id: { $in: orgIdStrings },
        })
          .select("org_id")
          .lean()
          .exec());

      const allowed = new Set(memberships.map((m: any) => String(m.org_id)));
      const unauthorized = orgIdStrings.filter((id) => !allowed.has(id));
      if (unauthorized.length > 0) {
        return res.status(403).json({
          message: "You are not a member of the requested organization(s)",
          orgIds: unauthorized,
        });
      }
      orgObjectIds = orgIdStrings.map((id) => new Types.ObjectId(id));
    }

    if (wantsOrgOnlyVisibility && orgObjectIds.length === 0) {
      const message =
        orgIdStrings.length === 0
          ? "You must belong to at least one organization to use organization visibility"
          : "Organization visibility requires at least one org id";
      return res.status(400).json({
        message,
      });
    }

    const tagsFromBody = coerceStringArray(body?.tags).map((tag) =>
      tag.toLowerCase()
    );
    const tagsFromCaption = extractHashtags(caption);
    const tags = Array.from(new Set([...tagsFromBody, ...tagsFromCaption]));

    // 1) Create a Post first to get postId
    const post = await PostModel.create({
      user_id: reqAny.user.id,
      caption,
      music,
      tags,
      video_src: "temp",
      visibility: "Private",
      allow_comments: allowComments,
    });
    const postId = String(post._id);

    // 2) Probe original
    const info = await ffprobe(file.path);
    outPath = path.join(path.dirname(file.path), `${postId}.mp4`);

    // 3) Transcode with requested parameters based on original
    await runFfmpeg(file.path, outPath, {
      height: info.height || 1080,
      fps: info.fps || 30,
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
    const video_src = buildPublicUrl(req, `media/${basePath}`);
    const thumbnail = buildPublicUrl(req, `media/photo/${basePath}`);
    post.video_src = video_src;
    post.thumbnail = thumbnail;
    post.visibility = wantsOrgOnlyVisibility
      ? "Organizations"
      : requestedVisibility;
    post.tags = tags;
    post.allow_comments = allowComments;
    await post.save();

    if (orgObjectIds.length > 0) {
      const payload = orgObjectIds.map((orgId) => ({
        post_id: post._id,
        org_id: orgId,
      }));
      await PostOrgModel.insertMany(payload, { ordered: false });
    }

    // Cleanup is handled in finally

    return res.status(201).json({
      postId,
      post,
      orgViewIds: orgIdStrings,
      tags,
    });
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

export async function uploadVideoMock(req: Request, res: Response) {
  let inPath: string | undefined;
  let outPath: string | undefined;
  let thumbPath: string | undefined;
  try {
    const reqAny = req as any;
    const file = reqAny.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "Missing file 'video'" });
    inPath = file.path;

    const body = req.body as any;

    // Get userId from body for mocking
    const userId = body?.userId || body?.user_id;
    if (!userId) {
      return res
        .status(400)
        .json({ message: "Missing userId in request body" });
    }

    // Verify user exists
    const userExists = await UserModel.exists({ _id: userId });
    if (!userExists) {
      return res.status(400).json({ message: "User not found" });
    }

    const caption =
      typeof body?.caption === "string"
        ? body.caption
        : body?.caption?.toString?.() ?? "";
    const music =
      typeof body?.music === "string"
        ? body.music
        : body?.music?.toString?.() ?? "";
    const allowCommentsRaw = body?.allowComments;
    const allowComments =
      typeof allowCommentsRaw === "string"
        ? allowCommentsRaw === "true"
        : allowCommentsRaw ?? true;

    const requestedVisibility = normalizeVisibility(body?.visibility);
    const wantsOrgOnlyVisibility = requestedVisibility === "Organizations";
    const orgIdsRaw = body?.orgIds ?? body?.org_id ?? body?.org_ids;
    let orgIdStrings = Array.from(
      new Set(
        coerceStringArray(orgIdsRaw)
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );

    let membershipDocs:
      | { org_id: Types.ObjectId | string }[]
      | null
      | undefined = null;

    if (wantsOrgOnlyVisibility && orgIdStrings.length === 0) {
      membershipDocs = await OrganizationMembershipModel.find({
        user_id: userId,
      })
        .select("org_id")
        .lean()
        .exec();
      orgIdStrings = Array.from(
        new Set(
          (membershipDocs || []).map((entry: any) => String(entry.org_id))
        )
      );
    }

    const invalidOrgIds = orgIdStrings.filter(
      (id) => !Types.ObjectId.isValid(id)
    );
    if (invalidOrgIds.length > 0) {
      return res.status(400).json({
        message: "Invalid organization id(s)",
        orgIds: invalidOrgIds,
      });
    }

    let orgObjectIds: Types.ObjectId[] = [];
    if (orgIdStrings.length > 0) {
      const memberships =
        membershipDocs ??
        (await OrganizationMembershipModel.find({
          user_id: userId,
          org_id: { $in: orgIdStrings },
        })
          .select("org_id")
          .lean()
          .exec());

      const allowed = new Set(memberships.map((m: any) => String(m.org_id)));
      const unauthorized = orgIdStrings.filter((id) => !allowed.has(id));
      if (unauthorized.length > 0) {
        return res.status(403).json({
          message: "User is not a member of the requested organization(s)",
          orgIds: unauthorized,
        });
      }
      orgObjectIds = orgIdStrings.map((id) => new Types.ObjectId(id));
    }

    if (wantsOrgOnlyVisibility && orgObjectIds.length === 0) {
      const message =
        orgIdStrings.length === 0
          ? "User must belong to at least one organization to use organization visibility"
          : "Organization visibility requires at least one org id";
      return res.status(400).json({
        message,
      });
    }

    const tagsFromBody = coerceStringArray(body?.tags).map((tag) =>
      tag.toLowerCase()
    );
    const tagsFromCaption = extractHashtags(caption);
    const tags = Array.from(new Set([...tagsFromBody, ...tagsFromCaption]));

    // 1) Create a Post first to get postId
    const post = await PostModel.create({
      user_id: userId,
      caption,
      music,
      tags,
      video_src: "temp",
      visibility: "Private",
      allow_comments: allowComments,
    });
    const postId = String(post._id);

    // 2) Probe original
    const info = await ffprobe(file.path);
    outPath = path.join(path.dirname(file.path), `${postId}.mp4`);

    // 3) Transcode with requested parameters based on original
    await runFfmpeg(file.path, outPath, {
      height: info.height || 1080,
      fps: info.fps || 30,
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
    const video_src = buildPublicUrl(req, `media/${basePath}`);
    const thumbnail = buildPublicUrl(req, `media/photo/${basePath}`);
    post.video_src = video_src;
    post.thumbnail = thumbnail;
    post.visibility = wantsOrgOnlyVisibility
      ? "Organizations"
      : requestedVisibility;
    post.tags = tags;
    post.allow_comments = allowComments;
    await post.save();

    if (orgObjectIds.length > 0) {
      const payload = orgObjectIds.map((orgId) => ({
        post_id: post._id,
        org_id: orgId,
      }));
      await PostOrgModel.insertMany(payload, { ordered: false });
    }

    // Cleanup is handled in finally

    return res.status(201).json({
      postId,
      post,
      orgViewIds: orgIdStrings,
      tags,
    });
  } catch (err: any) {
    console.error("uploadVideoMock error", err);
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

export async function uploadProfileImage(req: Request, res: Response) {
  let tempPath: string | undefined;
  try {
    const reqAny = req as any;
    if (!reqAny.user?.id)
      return res.status(401).json({ message: "Unauthorized" });

    const file = reqAny.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: "Missing file 'image'" });

    tempPath = file.path;
    const userId = String(reqAny.user.id);

    const bucket = process.env.MINIO_BUCKET || "users";
    await ensureBucket(bucket);

    const ext = pickImageExtension(file);
    const filename = `${randomUUID()}${ext}`;
    const objectName = `${userId}/profile/${filename}`;
    const meta = {
      "Content-Type": file.mimetype || "image/jpeg",
    } as any;

    await minioClient.fPutObject(bucket, objectName, file.path, meta);

    const pictureUrl = buildPublicUrl(
      req,
      `media/profile/${userId}/${filename}`
    );

    const updatedUser = await UserModel.findByIdAndUpdate(
      reqAny.user.id,
      { picture_url: pictureUrl },
      { new: true, runValidators: true }
    ).select("_id username handle picture_url");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Profile image uploaded successfully",
      pictureUrl,
      user: updatedUser,
    });
  } catch (err: any) {
    console.error("uploadProfileImage error", err);
    return res.status(500).json({
      message: "Failed to upload profile image",
      error: err?.message || String(err),
    });
  } finally {
    await safeUnlink(tempPath, "profile image temp");
  }
}

export async function profilePhoto(req: Request, res: Response) {
  try {
    const bucket = process.env.MINIO_BUCKET || "users";
    const owner = req.params.user;
    const filename = req.params.filename;

    if (!owner || !filename) {
      return res.status(400).json({ message: "Missing owner or filename" });
    }

    const objectKey = `${owner}/profile/${filename}`;
    const stat = await minioClient.statObject(bucket, objectKey);
    const size = stat.size as number;
    const contentType =
      (stat as any).contentType ||
      (stat as any).metaData?.["content-type"] ||
      "image/jpeg";

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
      return res.status(404).json({ message: "Profile image not found" });
    }
    console.error("profilePhoto error", err);
    return res.status(500).json({ message: "Failed to stream profile image" });
  }
}
