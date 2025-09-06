import { Request, Response } from "express";
import { minioClient } from "../lib/minio";

const MIN_CHUNK_SIZE = 64 * 1024; // 64 KiB
const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256 KiB works better on 4G
const MAX_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB

function parseRange(rangeHeader: string | undefined, size: number) {
  if (!rangeHeader) return null;
  const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end } as const;
}

function determineChunkSize(req: Request): number {
  const q = req.query.cs as string | undefined;
  if (q) {
    const n = parseInt(q, 10);
    if (!Number.isNaN(n)) {
      return Math.min(Math.max(n, MIN_CHUNK_SIZE), MAX_CHUNK_SIZE);
    }
  }
  const saveData = (req.headers["save-data"] || "").toString().toLowerCase();
  if (saveData === "on") return 128 * 1024;
  return DEFAULT_CHUNK_SIZE;
}

function pickContentType(objectKey: string, fallback: string): string {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".ts")) return "video/mp2t";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4s")) return "video/iso.segment";
  if (lower.endsWith(".mpd")) return "application/dash+xml";
  return fallback;
}

function coalesceWildcardParam(val: any): string {
  if (Array.isArray(val)) return val.join("/");
  return typeof val === "string" ? val : "";
}

export async function streamObject(req: Request, res: Response) {
  try {
    const bucket = req.params.bucket;
    const paramsAny = req.params as any;
    const objectKey = coalesceWildcardParam(
      paramsAny.object ?? paramsAny.path ?? paramsAny[0]
    );
    if (!bucket || !objectKey) {
      return res.status(400).json({ message: "Missing bucket or object key" });
    }

    const stat = await minioClient.statObject(bucket, objectKey);
    const size = stat.size as number;
    const inferred = pickContentType(objectKey, "application/octet-stream");
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
    const end = Math.min(
      start + determineChunkSize(req) - 1,
      requestedEnd,
      size - 1
    );
    const length = end - start + 1;

    const stream = await minioClient.getPartialObject(
      bucket,
      objectKey,
      start,
      length
    );
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(length));
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
      return res.status(404).json({ message: "Object not found" });
    }
    return res.status(500).json({ message: "Failed to stream object" });
  }
}
