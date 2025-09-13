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
    const exp =
      typeof decoded?.exp === "number"
        ? decoded.exp
        : Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const hmacSecret = process.env.REFRESH_TOKEN_HMAC_SECRET as string;
    const hash = createHmac("sha256", hmacSecret)
      .update(refreshToken)
      .digest("hex");
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
      const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
      // Store by family+hash and also by hash for quick lookup
      const keyByFamily = `rtfam:${family}:${hash}`;
      const keyByHash = `rt:${hash}`;
      await client.set(keyByFamily, JSON.stringify(entry), { EX: ttl });
      await client.set(keyByHash, JSON.stringify(entry), { EX: ttl });
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

async function refreshAccessToken(req, res) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token" });
    }

    // Verify token signature and expiration
    let payload: any;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    // Recompute hash to lookup in Redis
    const hmacSecret = process.env.REFRESH_TOKEN_HMAC_SECRET as string;
    const hash = createHmac("sha256", hmacSecret)
      .update(refreshToken)
      .digest("hex");

    // Fetch stored entry
    const client = await ensureRedis();
    const raw = await client.get(`rt:${hash}`);
    if (!raw) {
      return res.status(401).json({ error: "Refresh token not recognized" });
    }

    const entry = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (entry.revoked) {
      try {
        for await (const key of client.scanIterator({
          MATCH: `rtfam:${entry.family}:*`,
          COUNT: 100,
        })) {
          const k = String(key);
          const parts = k.split(":");
          const tokenHash = parts[2];
          await client.del(k);
          if (tokenHash) await client.del(`rt:${tokenHash}`);
        }
      } catch (e) {
        console.error("Failed to purge family tokens:", e?.message || e);
      }
      return res
        .clearCookie("accessToken", {
          domain: process.env.COOKIE_DOMAIN,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .clearCookie("refreshToken", {
          domain: process.env.COOKIE_DOMAIN,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
        })
        .status(401)
        .json({ error: "Refresh token reuse detected; family revoked" });
    }
    if (typeof entry.exp === "number" && entry.exp < now) {
      return res.status(401).json({ error: "Refresh token expired" });
    }

    if (String(entry.uid) !== String(payload.sub)) {
      return res.status(401).json({ error: "Token subject mismatch" });
    }

    // Rotate refresh token: revoke current, chain to new
    const newRefreshToken = jwt.sign(
      { sub: payload.sub },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    const decodedNew: any = jwt.decode(newRefreshToken);
    const newExp =
      typeof decodedNew?.exp === "number"
        ? decodedNew.exp
        : now + 7 * 24 * 60 * 60;
    const newHash = createHmac("sha256", hmacSecret)
      .update(newRefreshToken)
      .digest("hex");

    const newEntry = {
      uid: String(entry.uid),
      family: String(entry.family),
      hash: newHash,
      rotated_to: "",
      revoked: false,
      exp: newExp,
    };

    const ttlNew = Math.max(1, newExp - now);
    await client.set(
      `rtfam:${entry.family}:${newHash}`,
      JSON.stringify(newEntry),
      { EX: ttlNew }
    );
    await client.set(`rt:${newHash}`, JSON.stringify(newEntry), { EX: ttlNew });

    // Mark old as revoked and link rotation
    entry.revoked = true;
    entry.rotated_to = newHash;
    const oldKeyByHash = `rt:${hash}`;
    const oldKeyByFamily = `rtfam:${entry.family}:${hash}`;
    const oldTTLHash = await client.ttl(oldKeyByHash);
    const oldTTLFam = await client.ttl(oldKeyByFamily);
    const ttlHash = oldTTLHash > 0 ? oldTTLHash : Math.max(1, entry.exp - now);
    const ttlFam = oldTTLFam > 0 ? oldTTLFam : Math.max(1, entry.exp - now);
    await client.set(oldKeyByHash, JSON.stringify(entry), { EX: ttlHash });
    await client.set(oldKeyByFamily, JSON.stringify(entry), { EX: ttlFam });

    // Issue new access token
    const accessToken = jwt.sign({ sub: payload.sub }, process.env.JWT_SECRET, {
      expiresIn: "5m",
    });

    return res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 5 * 60 * 1000,
        domain: process.env.COOKIE_DOMAIN,
      })
      .cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: (newExp - now) * 1000,
        domain: process.env.COOKIE_DOMAIN,
      })
      .status(200)
      .json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

async function me(req, res) {
  try {
    // Read access token from cookie or Authorization header
    const cookieToken = req.cookies?.accessToken;
    const headerAuth = req.headers?.authorization || "";
    const bearerToken = headerAuth.startsWith("Bearer ")
      ? headerAuth.slice(7)
      : undefined;
    const accessToken = cookieToken || bearerToken;

    if (!accessToken) {
      return res.status(401).json({ error: "No access token" });
    }

    let payload: any;
    try {
      payload = jwt.verify(accessToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired access token" });
    }

    const user = await UserModel.findById(payload.sub).lean();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      id: String(user._id),
      username: user.username,
      handle: user.handle,
      picture_url: user.picture_url,
      exp: payload.exp,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export { authentication, authorization, refreshAccessToken, me };
