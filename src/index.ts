import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config();

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

//import routes
import exampleRouter from "./controllers/example.routes";
import lineRouter from "./controllers/line.routes";
import feedRouter from "./controllers/feed.routes";
import mediaRouter from "./controllers/media.routes";

//setup middlewares
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.1.11:3000",
      "https://skillswap.yungying.com",
      "https://fs-g03.iecmu.com",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);
app.use(express.json({ limit: "100mb" }));

//list of routes
//-=-=-=-should edit below this line to add your routes-=-=-=-=-//
app.get("/", (req, res) => {
  res.json({
    version: "1.0.0",
  });
});

app.use("/example", exampleRouter);
app.use("/line", lineRouter);
app.use("/feed", feedRouter);
app.use("/media", mediaRouter);

//-=-=-=-=-should edit above this line to add your routes-=-=-=-=-//

app.listen(process.env.PORT, () => {
  console.log(`Server is running at http://localhost:${process.env.PORT}`);
});
