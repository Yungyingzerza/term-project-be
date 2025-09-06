import { Request, Response } from "express";
import { minioClient } from "../lib/minio";

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
