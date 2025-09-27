import * as Minio from "minio";

export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "localhost",
  port: parseInt(process.env.MINIO_PORT || "9000"),
  useSSL: process.env.MINIO_USE_SSL === "true" || false,
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});

//initialize bucket
const bucket = "users";

(async () => {
  try {
    const exists = await minioClient.bucketExists(bucket);
    if (!exists) {
      await minioClient.makeBucket(bucket, "");
      console.log(`Bucket "${bucket}" created successfully.`);
    } else {
      console.log(`Bucket "${bucket}" already exists.`);
    }
  } catch (err) {
    console.error("Error in bucket initialization:", err);
  }
})();
