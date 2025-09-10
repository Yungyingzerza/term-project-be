import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import axios from "axios";
import { randomBytes, createHmac } from "crypto";
import { UserModel, LineAccountModel } from "../models";
import { ensureRedis } from "../lib/redis";
dotenv.config();

function generateState(length = 20) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

async function authorization(req, res) {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    if (!state || state !== req.cookies.lineState) {
      return res.status(403).send("Invalid or missing state.");
    }

    const token = await axios.post(
      "https://api.line.me/oauth2/v2.1/token",
      {
        grant_type: "authorization_code",
        code: code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
      },
      { headers: { "content-type": "application/x-www-form-urlencoded" } }
    );

    const profile = await axios.get("https://api.line.me/v2/profile", {
      headers: {
        Authorization: `Bearer ${token.data.access_token}`,
      },
    });

    // Check if user exists in the database
    let user = await LineAccountModel.findOne({
      line_account_id: profile.data.userId,
    });

    if (!user) {
      // If user does not exist, create a new user
      const tempUser = new UserModel({
        username: profile.data.displayName,
        handle: `line_${profile.data.userId}`,
        picture_url: profile.data.pictureUrl,
      });
      await tempUser.save();

      user = new LineAccountModel({
        user_id: tempUser._id,
        line_account_id: profile.data.userId,
      });
      await user.save();
    }

    // Generate 2 JWT token acess and refresh token use sub as user._id
    const jwtToken = jwt.sign(
      {
        sub: user.user_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }
    );

    const refreshToken = jwt.sign(
      {
        sub: user.user_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Persist refresh token metadata in Redis
    const decoded: any = jwt.decode(refreshToken);
    const exp = typeof decoded?.exp === "number" ? decoded.exp : Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const hmacSecret = process.env.REFRESH_TOKEN_HMAC_SECRET || process.env.JWT_SECRET || "default_hmac_secret";
    const hash = createHmac("sha256", hmacSecret).update(refreshToken).digest("hex");
    const family = `FAM-${randomBytes(6).toString("hex")}`;

    const entry = {
      uid: String(user.user_id),
      family,
      hash,
      rotated_to: "",
      revoked: false,
      exp,
    };

    try {
      const client = await ensureRedis();
      const key = `rt:${family}:${hash}`;
      const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
      await client.set(key, JSON.stringify(entry), { EX: ttl });
    } catch (e) {
      console.error("Failed to store refresh token in Redis:", e?.message || e);
    }

    return res
      .cookie("accessToken", jwtToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 5 * 60 * 1000, // 5 minutes
        domain: process.env.COOKIE_DOMAIN,
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        domain: process.env.COOKIE_DOMAIN,
      })
      .status(201)
      .redirect(process.env.REDIRECT_URI_AFTER_LOGIN);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Internal Server Error", detail: err.message });
  }
}

async function authentication(req, res) {
  try {
    const state = generateState();

    res.cookie("lineState", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 5 * 60 * 1000, // 5 minutes
      domain: process.env.COOKIE_DOMAIN,
    });

    const redirectUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${process.env.CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&state=${state}&scope=profile%20openid`;

    res.redirect(redirectUrl);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export { authentication, authorization };
