import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { CorsOptions } from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();

function normalizeOrigin(origin: string): string | null {
  if (!origin) return null;
  try {
    const { protocol, hostname, port } = new URL(origin);
    const host = port ? `${hostname}:${port}` : hostname;
    return `${protocol}//${host}`;
  } catch (err) {
    if (typeof origin === "string") {
      return origin.replace(/\/$/, "");
    }
    return null;
  }
}

const allowedOrigins = new Set<string>();
[
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://192.168.1.11:3000",
  "https://chillchill.yungying.com",
].forEach((origin) => {
  const normalized = normalizeOrigin(origin);
  if (normalized) {
    allowedOrigins.add(normalized);
  }
});

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
      return callback(null, normalizedOrigin);
    }

    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  optionsSuccessStatus: 204,
};

const corsMiddleware = cors(corsOptions);

//connect to mongodb
mongoose
  .connect(process.env.MONGO || "")
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB", err);
  });

const app = express();

//setup middlewares
app.use(corsMiddleware);
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.sendStatus(corsOptions.optionsSuccessStatus ?? 204);
    return;
  }
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: "100mb" }));

//import routes
import exampleRouter from "./controllers/example.routes";
import lineRouter from "./controllers/line.routes";
import feedRouter from "./controllers/feed.routes";
import mediaRouter from "./controllers/media.routes";
import userRouter from "./controllers/user.routes";

//list of routes
//-=-=-=-should edit below this line to add your routes-=-=-=-=-//
app.get("/", (req, res) => {
  res.json({
    version: "1.0.1",
  });
});

app.use("/example", exampleRouter);
app.use("/line", lineRouter);
app.use("/feed", feedRouter);
app.use("/media", mediaRouter);
app.use("/user", userRouter);

//-=-=-=-=-should edit above this line to add your routes-=-=-=-=-//

app.listen(process.env.PORT, () => {
  console.log(`Server is running at http://localhost:${process.env.PORT}`);
});
