import { type Express, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { hashToken, generateToken } from "./auth";

const BRANCH_COOKIE = "__branch";
const BRANCH_SESSION_TTL_HOURS = 12;
const COOKIE_PATH = "/api/pos";

export function requireBranchSession(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.[BRANCH_COOKIE];
  if (!raw) {
    return res.status(401).json({ error: "Branch session required" });
  }

  const tokenHash = hashToken(raw);

  pool
    .query(
      `UPDATE branch_sessions
         SET last_seen_at = now()
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING branch_id`,
      [tokenHash]
    )
    .then((result) => {
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "Branch session required" });
      }
      (req as any).branchId = result.rows[0].branch_id;
      next();
    })
    .catch((err) => {
      console.error("[branchAuth] session lookup error:", err);
      return res.status(500).json({ error: "Internal error" });
    });
}

export function registerBranchAuthRoutes(app: Express) {
  const isProd = process.env.NODE_ENV === "production";

  app.post("/api/pos/branch/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: "username and password are required" });
      }

      const acctRes = await pool.query(
        `SELECT id, branch_id, password_hash FROM branch_accounts WHERE username = $1 AND is_active = true`,
        [username]
      );
      if (acctRes.rows.length === 0) {
        return res.status(401).json({ error: "Invalid branch credentials" });
      }

      const acct = acctRes.rows[0];
      const valid = await bcrypt.compare(password, acct.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid branch credentials" });
      }

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + BRANCH_SESSION_TTL_HOURS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO branch_sessions (token_hash, branch_id, expires_at) VALUES ($1, $2, $3)`,
        [tokenHash, acct.branch_id, expiresAt]
      );

      res.clearCookie(BRANCH_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      res.cookie(BRANCH_COOKIE, rawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: expiresAt,
      });

      return res.json({ data: { branch_id: acct.branch_id }, error: null });
    } catch (err) {
      console.error("[branchAuth] login error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/branch/direct-login", async (req: Request, res: Response) => {
    try {
      const { branch_id } = req.body || {};
      if (!branch_id) {
        return res.status(400).json({ error: "branch_id is required" });
      }

      const branchRes = await pool.query(
        `SELECT id FROM branches WHERE id = $1 AND is_active = true`,
        [branch_id]
      );
      if (branchRes.rows.length === 0) {
        return res.status(404).json({ error: "Branch not found or inactive" });
      }

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + BRANCH_SESSION_TTL_HOURS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO branch_sessions (token_hash, branch_id, expires_at) VALUES ($1, $2, $3)`,
        [tokenHash, branch_id, expiresAt]
      );

      res.clearCookie(BRANCH_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      res.cookie(BRANCH_COOKIE, rawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: expiresAt,
      });

      return res.json({ data: { branch_id }, error: null });
    } catch (err) {
      console.error("[branchAuth] direct-login error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/branch/logout", requireBranchSession, async (req: Request, res: Response) => {
    try {
      const raw = req.cookies?.[BRANCH_COOKIE];
      if (raw) {
        const tokenHash = hashToken(raw);
        await pool.query(
          `UPDATE branch_sessions SET revoked_at = now() WHERE token_hash = $1`,
          [tokenHash]
        );
      }

      res.clearCookie(BRANCH_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
      });

      res.clearCookie(BRANCH_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      return res.json({ data: { ok: true }, error: null });
    } catch (err) {
      console.error("[branchAuth] logout error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/branch/context", requireBranchSession, (req: Request, res: Response) => {
    return res.json({ data: { branch_id: (req as any).branchId }, error: null });
  });
}
