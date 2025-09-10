import { createClient } from "redis";

const url = process.env.REDIS_URL || "redis://localhost:6379";

export const redisClient = createClient({ url });

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

export async function ensureRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
}

