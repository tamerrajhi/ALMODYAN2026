import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./db";

const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || "168", 10); // 7 days default
const COOKIE_NAME = "__session";

export function isSessionAuthEnabled(): boolean {
  return process.env.SESSION_AUTH_ENABLED === "true";
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function setSessionCookie(res: Response, rawToken: string, expiresAt: Date): void {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function checkOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  const origin = req.get("origin") || req.get("referer") || "";
  if (!origin) {
    return true;
  }
  try {
    const host = req.get("host") || "";
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

function featureGate(_req: Request, res: Response): boolean {
  if (!isSessionAuthEnabled()) {
    res.status(501).json({ error: "Session auth is not enabled", code: "SESSION_AUTH_DISABLED" });
    return false;
  }
  return true;
}

async function loadUserPayload(userId: string) {
  const profileRes = await pool.query(
    `SELECT id, user_id, email, username, full_name, avatar_url, default_branch_id, is_active
     FROM profiles WHERE user_id = $1`,
    [userId]
  );
  if (profileRes.rows.length === 0) return null;
  const profile = profileRes.rows[0];

  const rolesRes = await pool.query(
    `SELECT CASE WHEN cr.is_admin = true THEN 'admin' ELSE 'user' END AS role
     FROM user_custom_roles ucr
     JOIN custom_roles cr ON cr.id = ucr.role_id
     WHERE ucr.user_id = $1`,
    [userId]
  );

  const branchesRes = await pool.query(
    `SELECT ub.branch_id, b.name AS branch_name
     FROM user_branches ub
     LEFT JOIN branches b ON b.id = ub.branch_id
     WHERE ub.user_id = $1`,
    [userId]
  );

  return {
    user: {
      id: profile.user_id,
      email: profile.email,
      username: profile.username,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      default_branch_id: profile.default_branch_id,
    },
    profile: {
      id: profile.id,
      user_id: profile.user_id,
      is_active: profile.is_active,
    },
    roles: rolesRes.rows.map((r: any) => r.role),
    branches: branchesRes.rows.map((b: any) => ({
      branch_id: b.branch_id,
      branch_name: b.branch_name,
    })),
  };
}

export function registerAuthRoutes(app: any): void {
  // POST /api/auth/login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    if (!featureGate(req, res)) return;
    if (!checkOrigin(req)) {
      return res.status(403).json({ error: "Origin mismatch" });
    }

    try {
      const { email_or_username, password } = req.body;
      if (!email_or_username || !password) {
        return res.status(400).json({ error: "email_or_username and password are required" });
      }

      let profileRes;
      if (email_or_username.includes("@")) {
        profileRes = await pool.query(
          `SELECT user_id, password_hash, is_active FROM profiles WHERE email = $1`,
          [email_or_username]
        );
      } else {
        profileRes = await pool.query(
          `SELECT user_id, password_hash, is_active FROM profiles WHERE username = $1`,
          [email_or_username]
        );
      }
      if (profileRes.rows.length === 0) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const profile = profileRes.rows[0];
      if (!profile.is_active) {
        return res.status(401).json({ error: "Account is disabled" });
      }
      if (!profile.password_hash) {
        return res.status(401).json({ error: "Password not set. Please contact administrator." });
      }

      const valid = await bcrypt.compare(password, profile.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          profile.user_id,
          tokenHash,
          expiresAt,
          req.ip || req.socket.remoteAddress || null,
          req.get("user-agent") || null,
        ]
      );

      setSessionCookie(res, rawToken, expiresAt);

      const payload = await loadUserPayload(profile.user_id);
      return res.json(payload);
    } catch (err) {
      console.error("[auth/login] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!featureGate(req, res)) return;

    try {
      const rawToken = req.cookies?.[COOKIE_NAME];
      if (!rawToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const tokenHash = hashToken(rawToken);
      const sessionRes = await pool.query(
        `SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = $1`,
        [tokenHash]
      );
      if (sessionRes.rows.length === 0) {
        clearSessionCookie(res);
        return res.status(401).json({ error: "Session not found" });
      }

      const session = sessionRes.rows[0];
      if (new Date(session.expires_at) < new Date()) {
        await pool.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
        clearSessionCookie(res);
        return res.status(401).json({ error: "Session expired" });
      }

      const payload = await loadUserPayload(session.user_id);
      if (!payload) {
        clearSessionCookie(res);
        return res.status(401).json({ error: "User not found" });
      }

      return res.json(payload);
    } catch (err) {
      console.error("[auth/me] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const rawToken = req.cookies?.[COOKIE_NAME];
      if (!rawToken) {
        return res.json({ authenticated: false, user: null });
      }
      const tokenHash = hashToken(rawToken);
      const sessionRes = await pool.query(
        `SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = $1`,
        [tokenHash]
      );
      if (sessionRes.rows.length === 0 || new Date(sessionRes.rows[0].expires_at) < new Date()) {
        return res.json({ authenticated: false, user: null });
      }
      const payload = await loadUserPayload(sessionRes.rows[0].user_id);
      if (!payload) {
        return res.json({ authenticated: false, user: null });
      }
      return res.json({ authenticated: true, user: payload.user });
    } catch (err) {
      console.error("[auth/session] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    if (!featureGate(req, res)) return;
    if (!checkOrigin(req)) {
      return res.status(403).json({ error: "Origin mismatch" });
    }

    try {
      const rawToken = req.cookies?.[COOKIE_NAME];
      if (rawToken) {
        const tokenHash = hashToken(rawToken);
        await pool.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
      }
      clearSessionCookie(res);
      return res.json({ ok: true });
    } catch (err) {
      console.error("[auth/logout] error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
}
