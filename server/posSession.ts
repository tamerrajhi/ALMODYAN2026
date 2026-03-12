import { type Express, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { hashToken, generateToken } from "./auth";
import { requireBranchSession } from "./branchAuth";

const POS_COOKIE = "__pos";
const POS_ADMIN_COOKIE = "__pos_admin";
const BRANCH_COOKIE = "__branch";
const POS_SESSION_TTL_HOURS = 12;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;
const COOKIE_PATH = "/api/pos";

export async function verifyUserPin(
  userId: string,
  pin: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  const pinRow = await pool.query(
    `SELECT pin_hash, failed_attempts, locked_until FROM user_pins WHERE user_id = $1 AND is_active = true`,
    [userId]
  );
  if (pinRow.rows.length === 0) {
    return { ok: false, status: 400, error: "PIN غير مضبوط لهذا المستخدم" };
  }

  const { pin_hash, failed_attempts, locked_until } = pinRow.rows[0];

  if (locked_until && new Date(locked_until) > new Date()) {
    const remainMs = new Date(locked_until).getTime() - Date.now();
    const remainMin = Math.ceil(remainMs / 60000);
    return { ok: false, status: 423, error: `الحساب مقفل. حاول بعد ${remainMin} دقيقة` };
  }

  const valid = await bcrypt.compare(pin, pin_hash);
  if (!valid) {
    const newAttempts = (failed_attempts || 0) + 1;
    const lockUntil =
      newAttempts >= MAX_PIN_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;

    await pool.query(
      `UPDATE user_pins SET failed_attempts = $1, locked_until = $2, updated_at = now() WHERE user_id = $3`,
      [newAttempts, lockUntil, userId]
    );

    return { ok: false, status: 401, error: "رمز PIN غير صحيح" };
  }

  await pool.query(
    `UPDATE user_pins SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`,
    [userId]
  );

  return { ok: true, status: 200 };
}

function requirePosAdminToken(req: Request, res: Response, next: NextFunction) {
  const raw = req.cookies?.[POS_ADMIN_COOKIE];
  if (!raw) {
    return res.status(401).json({ error: "POS admin session required" });
  }
  const tokenHash = hashToken(raw);
  pool
    .query(
      `SELECT pa.id AS admin_id, pa.username, pa.display_name
       FROM pos_admin_tokens pat
       JOIN pos_admin_accounts pa ON pa.id = pat.admin_id
       WHERE pat.token_hash = $1
         AND pat.revoked_at IS NULL
         AND pat.expires_at > now()
         AND pa.is_active = true`,
      [tokenHash]
    )
    .then((result) => {
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "POS admin session required" });
      }
      (req as any).posAdminId = result.rows[0].admin_id;
      (req as any).posAdminUsername = result.rows[0].username;
      (req as any).posAdminDisplayName = result.rows[0].display_name;
      next();
    })
    .catch((err) => {
      console.error("[posSession] admin token lookup error:", err);
      return res.status(500).json({ error: "Internal error" });
    });
}

export function requirePosSession(req: Request, res: Response, next: NextFunction) {
  const branchId = (req as any).branchId;
  if (!branchId) {
    return res.status(401).json({ error: "Branch session required" });
  }

  const raw = req.cookies?.[POS_COOKIE];
  if (!raw) {
    return res.status(401).json({ error: "POS session required" });
  }

  const tokenHash = hashToken(raw);

  pool
    .query(
      `UPDATE pos_session_tokens t
         SET last_seen_at = now()
       FROM pos_sessions s
       WHERE t.pos_session_id = s.id
         AND t.token_hash = $1
         AND t.revoked_at IS NULL
         AND t.expires_at > now()
         AND s.closed_at IS NULL
         AND s.branch_id = $2
       RETURNING s.id AS pos_session_id, s.cashier_user_id, s.branch_id, s.pos_admin_id`,
      [tokenHash, branchId]
    )
    .then((result) => {
      if (result.rows.length === 0) {
        return res.status(401).json({ error: "POS session required" });
      }
      (req as any).posSessionId = result.rows[0].pos_session_id;
      (req as any).cashierUserId = result.rows[0].cashier_user_id;
      (req as any).posAdminId = result.rows[0].pos_admin_id || null;
      next();
    })
    .catch((err) => {
      console.error("[posSession] session lookup error:", err);
      return res.status(500).json({ error: "Internal error" });
    });
}

export function registerPosSessionRoutes(app: Express) {
  const isProd = process.env.NODE_ENV === "production";

  app.get("/api/pos/cashiers", requireBranchSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;

      const result = await pool.query(
        `SELECT DISTINCT
           p.user_id,
           p.username,
           p.full_name,
           cr.role_key,
           CASE
             WHEN cr.is_admin = true THEN true
             WHEN cr.role_key = 'branch_supervisor_pos_plus_unique_returns' THEN true
             ELSE false
           END AS is_supervisor
         FROM user_branches ub
         JOIN profiles p ON p.user_id = ub.user_id
         LEFT JOIN user_custom_roles ucr ON ucr.user_id = p.user_id
         LEFT JOIN custom_roles cr ON cr.id = ucr.role_id
         WHERE ub.branch_id = $1
           AND (
             cr.role_key IN ('branch_seller_pos_only', 'branch_supervisor_pos_plus_unique_returns')
             OR cr.is_admin = true
           )
         ORDER BY p.full_name`,
        [branchId]
      );

      return res.json({ data: result.rows, error: null });
    } catch (err) {
      console.error("[posSession] cashiers error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/cashier/enter", requireBranchSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const { cashier_user_id, pin } = req.body || {};

      if (!cashier_user_id || !pin) {
        return res.status(400).json({ error: "cashier_user_id and pin are required" });
      }

      const ubCheck = await pool.query(
        `SELECT 1 FROM user_branches WHERE user_id = $1 AND branch_id = $2`,
        [cashier_user_id, branchId]
      );
      if (ubCheck.rows.length === 0) {
        return res.status(403).json({ error: "هذا المستخدم غير مرتبط بهذا الفرع" });
      }

      const pinResult = await verifyUserPin(cashier_user_id, pin);
      if (!pinResult.ok) {
        return res.status(pinResult.status).json({ error: pinResult.error });
      }

      const sessionRes = await pool.query(
        `INSERT INTO pos_sessions (branch_id, cashier_user_id, created_by_user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [branchId, cashier_user_id, (req as any).userId || null]
      );
      const posSessionId = sessionRes.rows[0].id;

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + POS_SESSION_TTL_HOURS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO pos_session_tokens (token_hash, pos_session_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash, posSessionId, expiresAt]
      );

      res.clearCookie(POS_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      res.cookie(POS_COOKIE, rawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: expiresAt,
      });

      return res.json({ data: { pos_session_id: posSessionId, cashier_user_id }, error: null });
    } catch (err) {
      console.error("[posSession] enter error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/cashier/exit", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const raw = req.cookies?.[POS_COOKIE];
      if (raw) {
        const tokenHash = hashToken(raw);
        await pool.query(
          `UPDATE pos_session_tokens SET revoked_at = now() WHERE token_hash = $1`,
          [tokenHash]
        );
      }

      const posSessionId = (req as any).posSessionId;
      if (posSessionId) {
        await pool.query(
          `UPDATE pos_sessions SET closed_at = now() WHERE id = $1`,
          [posSessionId]
        );
      }

      res.clearCookie(POS_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
      });

      return res.json({ data: { ok: true }, error: null });
    } catch (err) {
      console.error("[posSession] exit error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/session/context", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    const posAdminId = (req as any).posAdminId;
    const cashierUserId = (req as any).cashierUserId;

    let cashierKind: "user" | "admin" = "user";
    let cashierName: string | null = null;
    let cashierAdminId: string | null = null;
    let sellerProfileId: string | null = null;
    let sellerDisplayName: string | null = null;

    if (posAdminId) {
      cashierKind = "admin";
      cashierAdminId = posAdminId;
      const adminRow = await pool.query(
        `SELECT display_name, username, profile_id FROM pos_admin_accounts WHERE id = $1`,
        [posAdminId]
      );
      if (adminRow.rows.length > 0) {
        cashierName = adminRow.rows[0].display_name || adminRow.rows[0].username;
        sellerProfileId = adminRow.rows[0].profile_id || null;
        sellerDisplayName = cashierName;
      }
    } else if (cashierUserId) {
      cashierKind = "user";
      const profileRow = await pool.query(
        `SELECT id, full_name, username FROM profiles WHERE user_id = $1`,
        [cashierUserId]
      );
      if (profileRow.rows.length > 0) {
        cashierName = profileRow.rows[0].full_name || profileRow.rows[0].username;
        sellerProfileId = profileRow.rows[0].id;
        sellerDisplayName = cashierName;
      }
    }

    return res.json({
      data: {
        pos_session_id: (req as any).posSessionId,
        cashier_user_id: cashierUserId || null,
        branch_id: (req as any).branchId,
        pos_admin: !!posAdminId,
        pos_admin_id: posAdminId || null,
        cashier_kind: cashierKind,
        cashier_name: cashierName,
        cashier_admin_id: cashierAdminId,
        seller_profile_id: sellerProfileId,
        seller_display_name: sellerDisplayName,
      },
      error: null,
    });
  });

  app.get("/api/pos/branch-sellers", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const result = await pool.query(`
        SELECT p.id AS profile_id, p.user_id, p.full_name, p.username,
               COALESCE(NULLIF(p.full_name,''), p.username) AS display_name
        FROM user_branches ub
        JOIN profiles p ON p.user_id = ub.user_id
        WHERE ub.branch_id = $1
          AND p.is_active = true
        ORDER BY COALESCE(NULLIF(p.full_name,''), p.username)
      `, [branchId]);
      return res.json({ data: { sellers: result.rows }, error: null });
    } catch (err) {
      console.error("[posSession] branch-sellers error:", err);
      return res.status(500).json({ data: null, error: "Internal error" });
    }
  });

  app.post("/api/pos/admin/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان" });
      }

      const adminRow = await pool.query(
        `SELECT id, password_hash, display_name, username FROM pos_admin_accounts WHERE username = $1 AND is_active = true`,
        [username.trim()]
      );

      if (adminRow.rows.length === 0) {
        return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }

      const { id: adminId, password_hash, display_name, username: adminUsername } = adminRow.rows[0];
      const valid = await bcrypt.compare(password, password_hash);
      if (!valid) {
        return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }

      let profileId: string | null = null;
      const existingProfile = await pool.query(
        `SELECT profile_id FROM pos_admin_accounts WHERE id = $1`,
        [adminId]
      );
      profileId = existingProfile.rows[0]?.profile_id || null;

      if (!profileId) {
        const newProfile = await pool.query(
          `INSERT INTO profiles (id, full_name, username, is_active, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, true, now(), now())
           RETURNING id`,
          [display_name || adminUsername, `pos_admin_${adminUsername}`]
        );
        profileId = newProfile.rows[0].id;
        await pool.query(
          `UPDATE pos_admin_accounts SET profile_id = $1 WHERE id = $2`,
          [profileId, adminId]
        );
        console.log(`[posSession] Created profile ${profileId} for admin ${adminId}`);
      }

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + POS_SESSION_TTL_HOURS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO pos_admin_tokens (token_hash, admin_id, expires_at)
         VALUES ($1, $2, $3)`,
        [tokenHash, adminId, expiresAt]
      );

      res.clearCookie(POS_ADMIN_COOKIE, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
      });

      res.cookie(POS_ADMIN_COOKIE, rawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: expiresAt,
      });

      return res.json({
        data: {
          ok: true,
          admin_id: adminId,
          display_name: display_name || adminUsername,
        },
        error: null,
      });
    } catch (err) {
      console.error("[posSession] admin login error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/admin/context", requirePosAdminToken, async (req: Request, res: Response) => {
    return res.json({
      data: {
        admin_id: (req as any).posAdminId,
        display_name: (req as any).posAdminDisplayName,
      },
      error: null,
    });
  });

  app.get("/api/pos/admin/branches", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id AS branch_id, name, code FROM branches WHERE is_active = true ORDER BY name`
      );
      return res.json({ data: result.rows, error: null });
    } catch (err) {
      console.error("[posSession] admin branches error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/admin/select-branch", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).posAdminId;
      const adminDisplayName = (req as any).posAdminDisplayName;
      const { branch_id } = req.body || {};

      if (!branch_id) {
        return res.status(400).json({ error: "branch_id مطلوب" });
      }

      const branchCheck = await pool.query(
        `SELECT id, name, code FROM branches WHERE id = $1 AND is_active = true`,
        [branch_id]
      );
      if (branchCheck.rows.length === 0) {
        return res.status(404).json({ error: "الفرع غير موجود أو غير نشط" });
      }

      const branchRow = branchCheck.rows[0];
      const isProd = process.env.NODE_ENV === "production";

      const client = await pool.connect();
      let branchRawToken: string;
      let branchExpiresAt: Date;
      let posRawToken: string;
      let posExpiresAt: Date;
      let posSessionId: string;
      try {
        await client.query('BEGIN');

        const oldBranchToken = req.cookies?.[BRANCH_COOKIE];
        if (oldBranchToken) {
          const oldHash = hashToken(oldBranchToken);
          await client.query(`UPDATE branch_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [oldHash]);
        }
        const oldPosToken = req.cookies?.[POS_COOKIE];
        if (oldPosToken) {
          const oldPosHash = hashToken(oldPosToken);
          await client.query(
            `UPDATE pos_session_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
            [oldPosHash]
          );
        }

        branchRawToken = generateToken();
        const branchTokenHash = hashToken(branchRawToken);
        branchExpiresAt = new Date(Date.now() + POS_SESSION_TTL_HOURS * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO branch_sessions (token_hash, branch_id, expires_at) VALUES ($1, $2, $3)`,
          [branchTokenHash, branch_id, branchExpiresAt]
        );

        const sessionRes = await client.query(
          `INSERT INTO pos_sessions (branch_id, cashier_user_id, created_by_user_id, pos_admin_id)
           VALUES ($1, NULL, NULL, $2)
           RETURNING id`,
          [branch_id, adminId]
        );
        posSessionId = sessionRes.rows[0].id;

        posRawToken = generateToken();
        const posTokenHash = hashToken(posRawToken);
        posExpiresAt = new Date(Date.now() + POS_SESSION_TTL_HOURS * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO pos_session_tokens (token_hash, pos_session_id, expires_at)
           VALUES ($1, $2, $3)`,
          [posTokenHash, posSessionId, posExpiresAt]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      res.clearCookie(BRANCH_COOKIE, { httpOnly: true, secure: isProd, sameSite: "lax", path: COOKIE_PATH });
      res.cookie(BRANCH_COOKIE, branchRawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: branchExpiresAt,
      });

      res.clearCookie(POS_COOKIE, { httpOnly: true, secure: isProd, sameSite: "lax", path: COOKIE_PATH });
      res.cookie(POS_COOKIE, posRawToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: posExpiresAt,
      });

      return res.json({
        data: {
          ok: true,
          branch_id: branch_id,
          branch_name: branchRow.name,
          branch_code: branchRow.code,
          pos_session_id: posSessionId,
          pos_admin: true,
          cashier_kind: "admin",
          cashier_name: adminDisplayName,
        },
        error: null,
      });
    } catch (err) {
      console.error("[posSession] admin select-branch error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/admin/assume-self", requireBranchSession, requirePosSession, requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const adminId = (req as any).posAdminId;
      const adminDisplayName = (req as any).posAdminDisplayName;
      const isProdEnv = process.env.NODE_ENV === "production";

      const client = await pool.connect();
      let posRawToken: string;
      let posExpiresAt: Date;
      let posSessionId: string;
      try {
        await client.query('BEGIN');

        const oldPosRaw = req.cookies?.[POS_COOKIE];
        if (oldPosRaw) {
          const oldHash = hashToken(oldPosRaw);
          await client.query(`UPDATE pos_session_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [oldHash]);
        }

        const sessionRes = await client.query(
          `INSERT INTO pos_sessions (branch_id, cashier_user_id, created_by_user_id, pos_admin_id)
           VALUES ($1, NULL, NULL, $2)
           RETURNING id`,
          [branchId, adminId]
        );
        posSessionId = sessionRes.rows[0].id;

        posRawToken = generateToken();
        const posTokenHash = hashToken(posRawToken);
        posExpiresAt = new Date(Date.now() + POS_SESSION_TTL_HOURS * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO pos_session_tokens (token_hash, pos_session_id, expires_at)
           VALUES ($1, $2, $3)`,
          [posTokenHash, posSessionId, posExpiresAt]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      res.clearCookie(POS_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: COOKIE_PATH });
      res.clearCookie(POS_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: "/" });
      res.cookie(POS_COOKIE, posRawToken, {
        httpOnly: true,
        secure: isProdEnv,
        sameSite: "lax",
        path: COOKIE_PATH,
        expires: posExpiresAt,
      });

      return res.json({
        data: {
          ok: true,
          pos_session_id: posSessionId,
          pos_admin: true,
          cashier_kind: "admin",
          cashier_name: adminDisplayName,
        },
        error: null,
      });
    } catch (err) {
      console.error("[posSession] admin assume-self error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/branch/logout", async (req: Request, res: Response) => {
    const isProdEnv = process.env.NODE_ENV === "production";
    try {
      const posRaw = req.cookies?.[POS_COOKIE];
      if (posRaw) {
        await pool.query(`UPDATE pos_session_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashToken(posRaw)]);
      }
      const branchRaw = req.cookies?.[BRANCH_COOKIE];
      if (branchRaw) {
        await pool.query(`UPDATE branch_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(branchRaw)]);
      }
    } catch (err) {
      console.error("[posSession] branch logout revocation error:", err);
    }
    res.clearCookie(POS_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: COOKIE_PATH });
    res.clearCookie(BRANCH_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: COOKIE_PATH });
    res.clearCookie(POS_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: "/" });
    res.clearCookie(BRANCH_COOKIE, { httpOnly: true, secure: isProdEnv, sameSite: "lax", path: "/" });
    res.json({ ok: true });
  });

  app.post("/api/pos/logout", async (req: Request, res: Response) => {
    const isProdEnv = process.env.NODE_ENV === "production";
    try {
      const posRaw = req.cookies?.[POS_COOKIE];
      if (posRaw) {
        await pool.query(`UPDATE pos_session_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashToken(posRaw)]);
      }
      const branchRaw = req.cookies?.[BRANCH_COOKIE];
      if (branchRaw) {
        await pool.query(`UPDATE branch_sessions SET revoked_at = now() WHERE token_hash = $1`, [hashToken(branchRaw)]);
      }
      const adminRaw = req.cookies?.[POS_ADMIN_COOKIE];
      if (adminRaw) {
        await pool.query(`UPDATE pos_admin_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashToken(adminRaw)]);
      }
    } catch (err) {
      console.error("[posSession] logout revocation error:", err);
    }
    res.clearCookie(POS_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: COOKIE_PATH,
    });
    res.clearCookie(BRANCH_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: COOKIE_PATH,
    });
    res.clearCookie(POS_ADMIN_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: COOKIE_PATH,
    });
    res.clearCookie(POS_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: "/",
    });
    res.clearCookie(BRANCH_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: "/",
    });
    res.clearCookie(POS_ADMIN_COOKIE, {
      httpOnly: true,
      secure: isProdEnv,
      sameSite: "lax",
      path: "/",
    });
    res.json({ ok: true });
  });

  app.get("/api/pos/users", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT
           p.user_id,
           p.username,
           p.full_name,
           p.is_active,
           cr.role_key,
           cr.role_name,
           CASE WHEN up.pin_hash IS NOT NULL THEN true ELSE false END AS has_pin,
           CASE
             WHEN cr.is_admin = true THEN true
             WHEN cr.role_key = 'branch_supervisor_pos_plus_unique_returns' THEN true
             ELSE false
           END AS is_supervisor,
           COALESCE(
             (SELECT string_agg(b.name, '، ' ORDER BY b.name)
              FROM user_branches ub2
              JOIN branches b ON b.id = ub2.branch_id
              WHERE ub2.user_id = p.user_id), ''
           ) AS branch_names
         FROM profiles p
         JOIN user_custom_roles ucr ON ucr.user_id = p.user_id
         JOIN custom_roles cr ON cr.id = ucr.role_id
         LEFT JOIN user_pins up ON up.user_id = p.user_id AND up.is_active = true
         WHERE cr.role_key IN ('branch_seller_pos_only', 'branch_supervisor_pos_plus_unique_returns')
            OR cr.is_admin = true
         ORDER BY p.full_name`
      );
      return res.json({ data: result.rows, error: null });
    } catch (err) {
      console.error("[posSession] pos users list error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/users/set-pin", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { user_id, pin } = req.body || {};
      if (!user_id || !pin) {
        return res.status(400).json({ error: "user_id و pin مطلوبان" });
      }
      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: "PIN يجب أن يكون 4 أرقام" });
      }

      const pinHash = await bcrypt.hash(pin, 10);
      await pool.query(
        `INSERT INTO user_pins (user_id, pin_hash, is_active, created_at, updated_at)
         VALUES ($1, $2, true, now(), now())
         ON CONFLICT (user_id) WHERE is_active = true
         DO UPDATE SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()`,
        [user_id, pinHash]
      );

      return res.json({ data: { ok: true }, error: null });
    } catch (err) {
      console.error("[posSession] set-pin error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/admin-accounts", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, username, display_name, is_active, profile_id, email, phone, created_at
         FROM pos_admin_accounts
         ORDER BY created_at`
      );
      return res.json({ data: result.rows, error: null });
    } catch (err) {
      console.error("[posSession] admin accounts list error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/admin-accounts", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { username, password, display_name, email, phone } = req.body || {};
      if (!username || !password || !display_name) {
        return res.status(400).json({ error: "اسم المستخدم وكلمة المرور والاسم مطلوبين" });
      }
      if (username.length < 3) {
        return res.status(400).json({ error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" });
      }
      if (password.length < 4) {
        return res.status(400).json({ error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" });
      }

      const existing = await pool.query(
        `SELECT id FROM pos_admin_accounts WHERE username = $1`,
        [username]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: "اسم المستخدم مستخدم بالفعل" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO pos_admin_accounts (id, username, password_hash, display_name, is_active, email, phone, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, true, $4, $5, now())
         RETURNING id, username, display_name, is_active, email, phone, created_at`,
        [username, passwordHash, display_name, email || null, phone || null]
      );

      return res.json({ data: result.rows[0], error: null });
    } catch (err) {
      console.error("[posSession] create admin account error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/admin-accounts/:id/toggle-active", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE pos_admin_accounts SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "الحساب غير موجود" });
      }
      return res.json({ data: result.rows[0], error: null });
    } catch (err) {
      console.error("[posSession] toggle admin active error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.put("/api/pos/admin-accounts/:id", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { display_name, username, email, phone } = req.body || {};
      if (!display_name || !username) {
        return res.status(400).json({ error: "الاسم واسم المستخدم مطلوبين" });
      }
      if (username.length < 3) {
        return res.status(400).json({ error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" });
      }
      const dup = await pool.query(
        `SELECT id FROM pos_admin_accounts WHERE username = $1 AND id != $2`,
        [username, id]
      );
      if (dup.rows.length > 0) {
        return res.status(400).json({ error: "اسم المستخدم مستخدم بالفعل" });
      }
      const result = await pool.query(
        `UPDATE pos_admin_accounts SET display_name = $1, username = $2, email = $3, phone = $4 WHERE id = $5
         RETURNING id, username, display_name, is_active, email, phone, created_at`,
        [display_name, username, email || null, phone || null, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "الحساب غير موجود" });
      }
      return res.json({ data: result.rows[0], error: null });
    } catch (err) {
      console.error("[posSession] edit admin account error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/admin-accounts/:id/reset-password", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { password } = req.body || {};
      if (!password || password.length < 4) {
        return res.status(400).json({ error: "كلمة المرور يجب أن تكون 4 أحرف على الأقل" });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `UPDATE pos_admin_accounts SET password_hash = $1 WHERE id = $2 RETURNING id`,
        [passwordHash, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "الحساب غير موجود" });
      }
      return res.json({ data: { ok: true }, error: null });
    } catch (err) {
      console.error("[posSession] reset admin password error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/customers", requireBranchSession, async (req: Request, res: Response) => {
    try {
      const search = (req.query.search as string || '').trim();
      let query = `SELECT id, name, phone, email, customer_code, tax_number, is_active FROM customers WHERE is_active = true`;
      const params: string[] = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (name ILIKE $1 OR phone ILIKE $1 OR customer_code ILIKE $1)`;
      }

      query += ` ORDER BY name LIMIT 50`;

      const result = await pool.query(query, params);
      return res.json({ data: result.rows, error: null });
    } catch (err) {
      console.error("[posSession] customers list error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/pos/customers", requireBranchSession, async (req: Request, res: Response) => {
    try {
      const { name, phone, email, tax_number } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "اسم العميل مطلوب" });
      }

      const codeRes = await pool.query(
        `SELECT customer_code FROM customers ORDER BY customer_code DESC NULLS LAST LIMIT 1`
      );
      let nextCode = 'C001';
      if (codeRes.rows.length > 0 && codeRes.rows[0].customer_code) {
        const match = codeRes.rows[0].customer_code.match(/C(\d+)/);
        if (match) {
          nextCode = `C${String(parseInt(match[1]) + 1).padStart(3, '0')}`;
        }
      }

      const result = await pool.query(
        `INSERT INTO customers (name, phone, email, tax_number, customer_code, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), now())
         RETURNING id, name, phone, email, customer_code, tax_number`,
        [name.trim(), phone?.trim() || null, email?.trim() || null, tax_number?.trim() || null, nextCode]
      );

      return res.json({ data: result.rows[0], error: null });
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: "هذا العميل مسجل مسبقاً" });
      }
      console.error("[posSession] create customer error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/sales-returns", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const filterByBranch = !posAdminId;
      const result = await pool.query(`
        SELECT r.id, r.return_number AS invoice_number, r.return_date AS invoice_date,
          r.original_sale_id, r.original_invoice_id, r.customer_id, r.branch_id,
          r.subtotal::float AS subtotal, r.tax_amount::float AS tax_amount,
          r.total_amount::float AS total_amount, r.status, r.notes, r.created_at,
          oi.invoice_number AS original_invoice_number,
          CASE WHEN r.customer_id IS NOT NULL THEN json_build_object('full_name', c.name) ELSE NULL END AS customers,
          CASE WHEN r.branch_id IS NOT NULL THEN json_build_object('branch_name', b.name) ELSE NULL END AS branches
        FROM returns r
        LEFT JOIN customers c ON r.customer_id = c.id
        LEFT JOIN branches b ON r.branch_id = b.id
        LEFT JOIN invoices oi ON r.original_invoice_id = oi.id
        WHERE r.return_type = 'sales_return'
          AND r.original_sale_id IS NOT NULL
          AND ($1::boolean = false OR r.branch_id = $2)
        ORDER BY r.created_at DESC
      `, [filterByBranch, branchId]);
      res.json(result.rows);
    } catch (error) {
      console.error("[posSession] sales-returns error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/sales-invoices", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const filterByBranch = !posAdminId;
      const { payment_status, start_date, end_date, serial_search } = req.query;
      let where = `WHERE inv.invoice_type IN ('sales', 'sales_return') AND inv.sale_id IS NOT NULL`;
      const params: any[] = [filterByBranch, branchId];
      where += ` AND ($1::boolean = false OR inv.branch_id = $2)`;
      if (payment_status && payment_status !== 'all') { params.push(payment_status); where += ` AND inv.status = $${params.length}`; }
      if (start_date) { params.push(start_date); where += ` AND inv.invoice_date >= $${params.length}`; }
      if (end_date) { params.push(end_date); where += ` AND inv.invoice_date <= $${params.length}`; }
      if (serial_search && typeof serial_search === 'string' && serial_search.trim()) {
        params.push(`%${serial_search.trim()}%`);
        where += ` AND inv.id IN (SELECT s.invoice_id FROM sales s JOIN unique_items ui ON ui.sale_id = s.id WHERE ui.serial_no ILIKE $${params.length} AND s.invoice_id IS NOT NULL)`;
      }
      const result = await pool.query(`
        SELECT inv.*, inv.subtotal::float AS subtotal, inv.tax_amount::float AS tax_amount,
          inv.discount_amount::float AS discount_amount, inv.total_amount::float AS total_amount,
          inv.paid_amount::float AS paid_amount, inv.remaining_amount::float AS remaining_amount,
          CASE WHEN inv.customer_id IS NOT NULL THEN json_build_object('full_name', COALESCE(c.full_name, c.name), 'customer_code', c.customer_code, 'vat_number', c.tax_number) ELSE NULL END AS customer,
          CASE WHEN inv.branch_id IS NOT NULL THEN json_build_object('branch_name', b.name) ELSE NULL END AS branch,
          CASE WHEN inv.sale_id IS NOT NULL THEN json_build_object('sale_code', sa.sale_code) ELSE NULL END AS sale
        FROM invoices inv
        LEFT JOIN customers c ON inv.customer_id = c.id
        LEFT JOIN branches b ON inv.branch_id = b.id
        LEFT JOIN sales sa ON inv.sale_id = sa.id
        ${where}
        ORDER BY inv.created_at DESC
      `, params);
      res.json(result.rows);
    } catch (error) {
      console.error("[posSession] sales-invoices error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/invoice/:id", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const result = await pool.query(
        `SELECT i.*,
          row_to_json(c.*) AS customer,
          b.id AS branch_id, b.name AS branch_name, b.code AS branch_code,
          je.id AS je_id, je.entry_number
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        LEFT JOIN branches b ON i.branch_id = b.id
        LEFT JOIN journal_entries je ON i.journal_entry_id = je.id
        WHERE i.id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
      const invoice = result.rows[0];
      if (!posAdminId && invoice.branch_id !== branchId) {
        return res.status(403).json({ error: 'الفاتورة لا تنتمي لهذا الفرع' });
      }
      res.json(invoice);
    } catch (error) {
      console.error("[posSession] invoice view error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/invoice-items", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const { sale_id, invoice_id } = req.query;
      const jewelryJsonBuild = `json_build_object('id', ji.id, 'item_code', ji.serial_no, 'model', ji.model, 'description', ji.description, 'type', ji.type, 'metal', ji.metal, 'g_weight', ji.g_weight, 'd_weight', ji.d_weight, 'b_weight', ji.b_weight, 'clarity', ji.clarity, 'stone', ji.stone, 'tag_price', ji.tag_price, 'supp_ref', ji.supp_ref, 'supp_inv', upi.supp_inv)`;

      if (!posAdminId && invoice_id) {
        const branchCheck = await pool.query(`SELECT branch_id FROM invoices WHERE id = $1`, [invoice_id]);
        if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
        if (branchCheck.rows[0].branch_id !== branchId) return res.status(403).json({ error: 'الفاتورة لا تنتمي لهذا الفرع' });
      }
      if (!posAdminId && sale_id) {
        const branchCheck = await pool.query(`SELECT branch_id FROM sales WHERE id = $1`, [sale_id]);
        if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'البيع غير موجود' });
        if (branchCheck.rows[0].branch_id !== branchId) return res.status(403).json({ error: 'البيع لا ينتمي لهذا الفرع' });
      }

      if (sale_id) {
        const result = await pool.query(`
          SELECT si.id, si.item_id, si.sale_price,
            ${jewelryJsonBuild} AS jewelry_items
          FROM sale_items si
          LEFT JOIN unique_items ji ON si.item_id = ji.id
          LEFT JOIN unique_purchase_invoices upi ON ji.unique_invoice_id = upi.id
          WHERE si.sale_id = $1
        `, [sale_id]);
        if (result.rows.length > 0) return res.json(result.rows);
      }
      if (invoice_id) {
        const result = await pool.query(`
          SELECT sii.*,
            ${jewelryJsonBuild} AS jewelry_items
          FROM sales_invoice_items sii
          LEFT JOIN unique_items ji ON sii.jewelry_item_id = ji.id
          LEFT JOIN unique_purchase_invoices upi ON ji.unique_invoice_id = upi.id
          WHERE sii.invoice_id = $1
        `, [invoice_id]);
        return res.json(result.rows);
      }
      res.json([]);
    } catch (error) {
      console.error("[posSession] invoice-items error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  const POS_TABLE_READ_ALLOWLIST = new Set([
    'sales', 'customers', 'branches', 'return_settings', 'profiles',
    'returns', 'return_items', 'chart_of_accounts', 'unique_items', 'invoices',
  ]);

  const POS_SAFE_COL_RE = /^[a-z_][a-z0-9_]*$/;

  const POS_COLUMN_ALIASES: Record<string, Record<string, string>> = {
    branches: { branch_name: 'name', branch_code: 'code' },
    customers: { full_name: 'name', customer_name: 'name' },
  };

  function posResolveColumn(table: string, col: string): string {
    return POS_COLUMN_ALIASES[table]?.[col] || col;
  }

  const POS_TABLE_ORDERABLE_COLUMNS: Record<string, Set<string>> = {
    sales: new Set(['id', 'sale_number', 'sale_date', 'status', 'created_at']),
    customers: new Set(['id', 'name', 'code', 'phone', 'created_at', 'is_active']),
    branches: new Set(['id', 'name', 'branch_name', 'code', 'branch_code', 'is_active', 'created_at']),
    returns: new Set(['id', 'return_number', 'return_date', 'status', 'created_at']),
    profiles: new Set(['id', 'email', 'full_name', 'created_at']),
    chart_of_accounts: new Set(['id', 'account_code', 'account_name', 'account_type', 'created_at']),
    invoices: new Set(['id', 'invoice_number', 'invoice_date', 'status', 'created_at', 'total_amount']),
    unique_items: new Set(['id', 'serial_no', 'stockcode', 'model', 'created_at', 'branch_id', 'status']),
  };

  app.post("/api/pos/table-read", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    const branchId = (req as any).branchId;
    const posAdminId = (req as any).posAdminId;
    const { table, select, filters, order, limit, single, maybeSingle } = req.body;

    if (!table || !POS_TABLE_READ_ALLOWLIST.has(table)) {
      return res.status(403).json({ data: null, error: { message: `Table '${table}' not allowed for POS` } });
    }

    try {
      let selectCols: string;
      if (select && select !== '*') {
        const cols = select.split(',').map((c: string) => c.trim()).filter((c: string) => POS_SAFE_COL_RE.test(c));
        selectCols = cols.map((c: string) => {
          const resolved = posResolveColumn(table, c);
          return resolved !== c ? `${resolved} AS ${c}` : c;
        }).join(', ');
      } else {
        const aliases = POS_COLUMN_ALIASES[table];
        if (aliases) {
          const aliasCols = Object.entries(aliases).map(([alias, real]) => `${real} AS ${alias}`);
          selectCols = `*, ${aliasCols.join(', ')}`;
        } else {
          selectCols = '*';
        }
      }

      let sql = `SELECT ${selectCols} FROM ${table}`;
      const params: any[] = [];
      let paramIdx = 1;

      const conditions: string[] = [];

      if (!posAdminId && ['sales', 'returns', 'invoices', 'unique_items'].includes(table)) {
        conditions.push(`branch_id = $${paramIdx++}`);
        params.push(branchId);
      }

      if (filters && Array.isArray(filters) && filters.length > 0) {
        for (const f of filters) {
          if (!f.column || !POS_SAFE_COL_RE.test(f.column)) continue;
          const col = posResolveColumn(table, f.column);
          switch (f.type) {
            case 'eq':
              conditions.push(`${col} = $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'neq':
              conditions.push(`${col} != $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'gt':
              conditions.push(`${col} > $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'gte':
              conditions.push(`${col} >= $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'lt':
              conditions.push(`${col} < $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'lte':
              conditions.push(`${col} <= $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'in':
              if (Array.isArray(f.value) && f.value.length > 0) {
                const inPlaceholders = f.value.map(() => `$${paramIdx++}`).join(',');
                conditions.push(`${col} IN (${inPlaceholders})`);
                params.push(...f.value);
              }
              break;
            case 'is':
              if (f.value === null) {
                conditions.push(`${col} IS NULL`);
              } else {
                conditions.push(`${col} = $${paramIdx++}`);
                params.push(f.value);
              }
              break;
            case 'ilike':
              conditions.push(`${col} ILIKE $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'like':
              conditions.push(`${col} LIKE $${paramIdx++}`);
              params.push(f.value);
              break;
            case 'not':
              if (f.operator === 'is' && f.value === null) {
                conditions.push(`${col} IS NOT NULL`);
              } else {
                conditions.push(`${col} != $${paramIdx++}`);
                params.push(f.value);
              }
              break;
          }
        }
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      if (order) {
        const allowedCols = POS_TABLE_ORDERABLE_COLUMNS[table];
        if (allowedCols) {
          const orders = Array.isArray(order) ? order : [order];
          const validOrders = orders.filter((o: any) => o.column && POS_SAFE_COL_RE.test(o.column) && allowedCols.has(o.column));
          if (validOrders.length > 0) {
            const orderClauses = validOrders.map((o: any) => {
              const resolved = posResolveColumn(table, o.column);
              const dir = o.ascending === false ? 'DESC' : 'ASC';
              return `${resolved} ${dir}`;
            });
            sql += ` ORDER BY ${orderClauses.join(', ')}`;
          }
        }
      }

      if (limit && typeof limit === 'number' && limit > 0) {
        sql += ` LIMIT ${Math.min(limit, 5000)}`;
      }

      if (single || maybeSingle) {
        sql += limit ? '' : ' LIMIT 2';
      }

      const result = await pool.query(sql, params);

      if (single) {
        if (result.rows.length === 0) {
          return res.json({ data: null, error: { message: 'Row not found' } });
        }
        return res.json({ data: result.rows[0], error: null });
      }
      if (maybeSingle) {
        return res.json({ data: result.rows[0] || null, error: null });
      }
      res.json({ data: result.rows, error: null });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Query failed";
      console.error(`[pos/table-read] ERROR table=${table} => ${errMsg}`);
      res.status(500).json({ data: null, error: { message: errMsg } });
    }
  });

  const POS_RPC_ALLOWLIST = new Set([
    'get_customer_credit_balance',
    'complete_pos_piece_return_atomic',
  ]);

  app.post("/api/pos/rpc/:fnName", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    const { fnName } = req.params;
    const { args } = req.body;

    if (!POS_RPC_ALLOWLIST.has(fnName)) {
      return res.status(403).json({ data: null, error: { message: `Function '${fnName}' not allowed for POS` } });
    }

    try {
      let query: string;
      let queryParams: any[] = [];

      if (fnName === 'get_customer_credit_balance') {
        query = `SELECT public.get_customer_credit_balance($1::uuid) as result`;
        queryParams = [args.p_customer_id || args.customer_id];
      } else if (fnName === 'complete_pos_piece_return_atomic') {
        query = `SELECT public.complete_pos_piece_return_atomic($1::jsonb) as result`;
        queryParams = [JSON.stringify(args.p_payload || args)];
      } else {
        return res.status(403).json({ data: null, error: { message: `Function '${fnName}' not allowed` } });
      }

      const result = await pool.query(query, queryParams);
      const data = result.rows[0]?.result;
      res.json({ data, error: null });
    } catch (error) {
      console.error(`[pos/rpc] ${fnName} error:`, error);
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : "RPC execution failed" } });
    }
  });

  app.get("/api/pos/sale-by-serial", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const { serial_no, branch_id } = req.query;
      if (!serial_no || typeof serial_no !== 'string' || serial_no.trim().length < 2) {
        return res.json({ data: null, error: 'Serial number required (min 2 chars)' });
      }
      const searchTerm = serial_no.trim();
      const params: any[] = [`%${searchTerm}%`];
      let branchFilter = '';
      if (!posAdminId) {
        params.push(branchId);
        branchFilter = ` AND ui.branch_id = $${params.length}`;
      } else if (branch_id) {
        params.push(branch_id);
        branchFilter = ` AND ui.branch_id = $${params.length}`;
      }
      const result = await pool.query(`
        SELECT ui.id AS item_id, ui.serial_no, ui.stockcode, ui.model, ui.description, ui.cost,
          ui.tag_price, ui.sale_id, ui.status AS item_status, ui.branch_id AS item_branch_id,
          s.id AS sale_id, s.sale_code, s.created_at AS sale_date, s.total_amount AS sale_total,
          s.customer_id, s.branch_id AS sale_branch_id,
          inv.id AS invoice_id, inv.invoice_number, inv.status AS invoice_status,
          COALESCE(c.full_name, c.name) AS customer_name,
          b.name AS branch_name
        FROM unique_items ui
        LEFT JOIN sales s ON ui.sale_id = s.id
        LEFT JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE (ui.serial_no ILIKE $1 OR ui.stockcode ILIKE $1)
          AND ui.sale_id IS NOT NULL
          ${branchFilter}
        ORDER BY s.created_at DESC
        LIMIT 10
      `, params);
      res.json({ data: result.rows, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/invoices-for-link", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const { branch_id, search } = req.query;
      const effectiveBranch = posAdminId ? (branch_id || branchId) : branchId;
      if (!effectiveBranch) return res.json([]);
      const params: any[] = [effectiveBranch];
      let searchFilter = '';
      if (search && typeof search === 'string' && search.trim()) {
        params.push(`%${search.trim()}%`);
        searchFilter = ` AND (inv.invoice_number ILIKE $${params.length} OR s.sale_code ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
      }
      const result = await pool.query(`
        SELECT inv.id, inv.invoice_number, inv.invoice_date, inv.total_amount::float AS total_amount, inv.sale_id,
          s.sale_code, COALESCE(c.full_name, c.name) AS customer_name
        FROM invoices inv
        LEFT JOIN sales s ON inv.sale_id = s.id
        LEFT JOIN customers c ON inv.customer_id = c.id
        WHERE inv.branch_id = $1 AND inv.invoice_type = 'sales' AND inv.status != 'cancelled' ${searchFilter}
        ORDER BY inv.created_at DESC
        LIMIT 20
      `, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/sale-items-by-barcode", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const { barcode } = req.query;
      if (!barcode) return res.json([]);
      const params: any[] = [`%${barcode}%`];
      let branchFilter = '';
      if (!posAdminId) {
        params.push(branchId);
        branchFilter = ` AND inv.branch_id = $${params.length}`;
      }
      const result = await pool.query(`
        SELECT DISTINCT inv.sale_id
        FROM sales_invoice_items sii
        JOIN invoices inv ON inv.id = sii.invoice_id
        INNER JOIN unique_items ji ON sii.jewelry_item_id = ji.id
        WHERE (ji.stockcode ILIKE $1 OR ji.serial_no ILIKE $1)
          AND inv.sale_id IS NOT NULL
          ${branchFilter}
      `, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.get("/api/pos/sale-items", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posAdminId = (req as any).posAdminId;
      const { sale_id } = req.query;
      if (!sale_id) return res.json([]);
      if (!posAdminId) {
        const branchCheck = await pool.query(`SELECT branch_id FROM sales WHERE id = $1`, [sale_id]);
        if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'البيع غير موجود' });
        if (branchCheck.rows[0].branch_id !== branchId) return res.status(403).json({ error: 'البيع لا ينتمي لهذا الفرع' });
      }
      const result = await pool.query(`
        SELECT sii.id, sii.jewelry_item_id AS item_id, sii.unit_price AS sale_price,
          json_build_object(
            'id', ji.id, 'item_code', ji.serial_no, 'model', ji.model, 'description', ji.description,
            'type', ji.type, 'metal', ji.metal, 'g_weight', ji.g_weight, 'd_weight', ji.d_weight,
            'b_weight', ji.b_weight, 'clarity', ji.clarity, 'stone', ji.stone,
            'tag_price', ji.tag_price, 'sold_at', ji.sold_at, 'stockcode', ji.stockcode, 'cost', ji.cost,
            'supp_ref', ji.supp_ref
          ) AS jewelry_items
        FROM sales_invoice_items sii
        JOIN invoices inv ON inv.id = sii.invoice_id
        LEFT JOIN unique_items ji ON sii.jewelry_item_id = ji.id
        WHERE inv.sale_id = $1
      `, [sale_id]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post("/api/pos/override", requireBranchSession, requirePosSession, async (req: Request, res: Response) => {
    try {
      const branchId = (req as any).branchId;
      const posSessionId = (req as any).posSessionId;
      const posAdminId = (req as any).posAdminId;
      const { action_key, supervisor_user_id, pin, notes } = req.body || {};

      if (action_key !== "pos_return_confirm") {
        return res.status(400).json({ error: "action_key غير مدعوم" });
      }

      if (posAdminId) {
        const insertRes = await pool.query(
          `INSERT INTO supervisor_overrides (pos_session_id, branch_id, action_key, approved_by_user_id, notes)
           VALUES ($1, $2, 'pos_return_confirm', NULL, $3)
           RETURNING id`,
          [posSessionId, branchId, notes || 'موافقة أدمن POS تلقائية']
        );
        return res.json({ data: { override_id: insertRes.rows[0].id, auto_approved: true }, error: null });
      }

      if (!supervisor_user_id || !pin) {
        return res.status(400).json({ error: "supervisor_user_id and pin are required" });
      }
      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: "رمز PIN يجب أن يكون 4 أرقام" });
      }

      const ubCheck = await pool.query(
        `SELECT 1 FROM user_branches WHERE user_id = $1 AND branch_id = $2`,
        [supervisor_user_id, branchId]
      );
      if (ubCheck.rows.length === 0) {
        return res.status(403).json({ error: "المشرف غير مرتبط بهذا الفرع" });
      }

      const roleCheck = await pool.query(
        `SELECT 1
         FROM user_custom_roles ucr
         JOIN custom_roles cr ON cr.id = ucr.role_id
         WHERE ucr.user_id = $1
           AND (cr.role_key = 'branch_supervisor_pos_plus_unique_returns' OR cr.is_admin = true)`,
        [supervisor_user_id]
      );
      if (roleCheck.rows.length === 0) {
        return res.status(403).json({ error: "هذا المستخدم ليس مشرفاً مخولاً" });
      }

      const pinResult = await verifyUserPin(supervisor_user_id, pin);
      if (!pinResult.ok) {
        return res.status(pinResult.status).json({ error: pinResult.error });
      }

      const insertRes = await pool.query(
        `INSERT INTO supervisor_overrides (pos_session_id, branch_id, action_key, approved_by_user_id, notes)
         VALUES ($1, $2, 'pos_return_confirm', $3, $4)
         RETURNING id`,
        [posSessionId, branchId, supervisor_user_id, notes || null]
      );

      return res.json({ data: { override_id: insertRes.rows[0].id }, error: null });
    } catch (err) {
      console.error("[posSession] override error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.get("/api/pos/admin/branches-with-sellers", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const branchesResult = await pool.query(`SELECT id, name, code FROM branches ORDER BY name`);
      const sellersResult = await pool.query(`
        SELECT ub.branch_id, p.id AS profile_id, p.user_id, p.full_name, p.username,
               COALESCE(NULLIF(p.full_name,''), p.username) AS display_name,
               ub.is_primary
        FROM user_branches ub
        JOIN profiles p ON p.user_id = ub.user_id
        WHERE p.is_active = true
        ORDER BY COALESCE(NULLIF(p.full_name,''), p.username)
      `);
      const branches = branchesResult.rows.map(b => ({
        ...b,
        sellers: sellersResult.rows.filter(s => s.branch_id === b.id),
      }));
      res.json({ data: { branches }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/profiles-active", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT id, user_id, full_name, username, is_active,
               COALESCE(NULLIF(full_name,''), username) AS display_name
        FROM profiles
        WHERE is_active = true
        ORDER BY COALESCE(NULLIF(full_name,''), username)
      `);
      res.json({ data: { profiles: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.post("/api/pos/admin/branch-sellers/assign", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id, profile_id, is_primary } = req.body || {};
      if (!branch_id || !profile_id) {
        return res.status(400).json({ data: null, error: { message: 'branch_id and profile_id are required' } });
      }
      const profileResult = await pool.query(`SELECT id, user_id, full_name, username FROM profiles WHERE id = $1 AND is_active = true`, [profile_id]);
      if (profileResult.rows.length === 0) {
        return res.status(404).json({ data: null, error: { message: 'الملف الشخصي غير موجود أو غير نشط' } });
      }
      const userId = profileResult.rows[0].user_id;
      const result = await pool.query(`
        INSERT INTO user_branches (id, user_id, branch_id, is_primary)
        VALUES (gen_random_uuid(), $1, $2, $3)
        ON CONFLICT (user_id, branch_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
        RETURNING *
      `, [userId, branch_id, is_primary || false]);
      res.json({
        data: {
          assignment: result.rows[0],
          profile: profileResult.rows[0],
        },
        error: null,
      });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.post("/api/pos/admin/branch-sellers/remove", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id, profile_id } = req.body || {};
      if (!branch_id || !profile_id) {
        return res.status(400).json({ data: null, error: { message: 'branch_id and profile_id are required' } });
      }
      const profileResult = await pool.query(`SELECT user_id FROM profiles WHERE id = $1`, [profile_id]);
      if (profileResult.rows.length === 0) {
        return res.status(404).json({ data: null, error: { message: 'الملف الشخصي غير موجود' } });
      }
      const userId = profileResult.rows[0].user_id;
      await pool.query(`DELETE FROM user_branches WHERE user_id = $1 AND branch_id = $2`, [userId, branch_id]);
      res.json({ data: { removed: true }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  // ==================== DASHBOARD ENDPOINTS ====================

  app.get("/api/pos/admin/dashboard/today-kpis", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id } = req.query as Record<string, string>;
      const startDate = start || new Date().toISOString().slice(0, 10);
      const endDate = end || new Date().toISOString().slice(0, 10);
      const params: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59'];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND s.branch_id = $3'; params.push(branch_id); }

      const salesResult = await pool.query(`
        SELECT
          COUNT(*)::int AS sales_count,
          COALESCE(SUM(s.total_amount), 0) AS revenue,
          COALESCE(SUM(s.tax_amount), 0) AS tax,
          COALESCE(SUM(s.discount_amount), 0) AS discounts,
          COALESCE(SUM(s.total_amount) - SUM(s.tax_amount), 0) AS net_sales
        FROM sales s
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${branchFilter}
      `, params);

      const retParams: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59'];
      let retBranchFilter = '';
      if (branch_id) { retBranchFilter = ' AND r.branch_id = $3'; retParams.push(branch_id); }
      const returnsResult = await pool.query(`
        SELECT COALESCE(SUM(r.total_amount), 0) AS returns_amount
        FROM returns r
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2${retBranchFilter}
      `, retParams);

      res.json({
        data: {
          ...salesResult.rows[0],
          returns_amount: returnsResult.rows[0]?.returns_amount || 0,
        },
        error: null,
      });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/profit-snapshot", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, seller_id } = req.query as Record<string, string>;
      const startDate = start || new Date().toISOString().slice(0, 10);
      const endDate = end || new Date().toISOString().slice(0, 10);
      const params: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59'];
      let extraFilter = '';
      let paramIdx = 3;
      if (branch_id) { extraFilter += ` AND s.branch_id = $${paramIdx}`; params.push(branch_id); paramIdx++; }
      if (seller_id) { extraFilter += ` AND s.seller_profile_id = $${paramIdx}`; params.push(seller_id); paramIdx++; }

      const result = await pool.query(`
        SELECT
          COALESCE(SUM(sii.total_price), 0) AS revenue,
          COALESCE(SUM(ui.cost), 0) AS cogs,
          COALESCE(SUM(sii.total_price) - SUM(ui.cost), 0) AS gross_profit
        FROM sales s
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${extraFilter}
      `, params);

      const retParams: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59'];
      let retFilter = '';
      let retIdx = 3;
      if (branch_id) { retFilter += ` AND r.branch_id = $${retIdx}`; retParams.push(branch_id); retIdx++; }
      if (seller_id) { retFilter += ` AND s_orig.seller_profile_id = $${retIdx}`; retParams.push(seller_id); retIdx++; }

      const retResult = await pool.query(`
        SELECT
          COALESCE(SUM(ri.total_price), 0) AS return_amount,
          COALESCE(SUM(ui_ret.cost), 0) AS return_cost
        FROM returns r
        JOIN return_items ri ON ri.return_id = r.id
        JOIN unique_items ui_ret ON ui_ret.id = ri.item_id
        LEFT JOIN sales s_orig ON s_orig.id = r.original_sale_id
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2${retFilter}
      `, retParams);

      const revenue = parseFloat(result.rows[0].revenue);
      const cogs = parseFloat(result.rows[0].cogs);
      const returnAmount = parseFloat(retResult.rows[0]?.return_amount || 0);
      const returnCost = parseFloat(retResult.rows[0]?.return_cost || 0);
      const netRevenue = revenue - returnAmount;
      const netCogs = cogs - returnCost;
      const netProfit = netRevenue - netCogs;

      res.json({
        data: {
          revenue, cogs, gross_profit: revenue - cogs,
          return_amount: returnAmount, return_cost: returnCost,
          net_profit: netProfit,
          gp_percent: netRevenue > 0 ? Math.round((netProfit / netRevenue) * 10000) / 100 : 0,
        },
        error: null,
      });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/top-sellers", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, limit: lim } = req.query as Record<string, string>;
      const startDate = start || new Date().toISOString().slice(0, 10);
      const endDate = end || new Date().toISOString().slice(0, 10);
      const rowLimit = parseInt(lim) || 5;
      const params: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59', rowLimit];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND s.branch_id = $4'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          s.seller_profile_id AS seller_id,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          COALESCE(SUM(sii.total_price), 0) AS revenue,
          COALESCE(SUM(ui.cost), 0) AS cogs,
          COALESCE(SUM(sii.total_price) - SUM(ui.cost), 0) AS net_profit
        FROM sales s
        JOIN profiles p ON p.id = s.seller_profile_id
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${branchFilter}
        GROUP BY s.seller_profile_id, p.full_name, p.username
        ORDER BY revenue DESC
        LIMIT $3
      `, params);

      res.json({ data: { sellers: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/top-branches", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, limit: lim } = req.query as Record<string, string>;
      const startDate = start || new Date().toISOString().slice(0, 10);
      const endDate = end || new Date().toISOString().slice(0, 10);
      const rowLimit = parseInt(lim) || 5;

      const result = await pool.query(`
        SELECT
          s.branch_id,
          b.name AS branch_name,
          COALESCE(SUM(sii.total_price), 0) AS revenue,
          COALESCE(SUM(ui.cost), 0) AS cogs,
          COALESCE(SUM(sii.total_price) - SUM(ui.cost), 0) AS net_profit
        FROM sales s
        JOIN branches b ON b.id = s.branch_id
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2
        GROUP BY s.branch_id, b.name
        ORDER BY revenue DESC
        LIMIT $3
      `, [startDate + ' 00:00:00', endDate + ' 23:59:59', rowLimit]);

      res.json({ data: { branches: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/inventory-valuation", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id } = req.query as Record<string, string>;
      const params: any[] = [];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND ui.branch_id = $1'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          b.id AS branch_id,
          b.name AS branch_name,
          COUNT(ui.id)::int AS item_count,
          COALESCE(SUM(ui.cost), 0) AS total_cost_value,
          COALESCE(SUM(ui.tag_price), 0) AS total_tag_value,
          COALESCE(SUM(ui.tag_price) - SUM(ui.cost), 0) AS potential_margin
        FROM unique_items ui
        JOIN branches b ON b.id = ui.branch_id
        WHERE ui.status = 'in_stock'${branchFilter}
        GROUP BY b.id, b.name
        ORDER BY total_cost_value DESC
      `, params);

      res.json({ data: { branches: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/inventory-aging", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id } = req.query as Record<string, string>;
      const params: any[] = [];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND ui.branch_id = $1'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ui.created_at >= NOW() - INTERVAL '30 days')::int AS age_0_30,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '30 days' AND ui.created_at >= NOW() - INTERVAL '60 days')::int AS age_31_60,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '60 days' AND ui.created_at >= NOW() - INTERVAL '90 days')::int AS age_61_90,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '90 days')::int AS age_over_90,
          COUNT(*)::int AS total_in_stock,
          COALESCE(SUM(ui.cost), 0) AS total_cost,
          COALESCE(SUM(CASE WHEN ui.created_at < NOW() - INTERVAL '90 days' THEN ui.cost ELSE 0 END), 0) AS aging_cost_over_90
        FROM unique_items ui
        WHERE ui.status = 'in_stock'${branchFilter}
      `, params);

      res.json({ data: result.rows[0], error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/dashboard/reconciliation", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, limit: lim } = req.query as Record<string, string>;
      const startDate = start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const endDate = end || new Date().toISOString().slice(0, 10);
      const rowLimit = parseInt(lim) || 50;
      const params: any[] = [startDate + ' 00:00:00', endDate + ' 23:59:59', rowLimit];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND inv.branch_id = $4'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          inv.id AS invoice_id,
          inv.invoice_number,
          b.name AS branch_name,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          inv.total_amount AS invoice_total,
          COALESCE(pay_agg.paid_total, 0) AS paid_total,
          inv.total_amount - COALESCE(pay_agg.paid_total, 0) AS delta
        FROM invoices inv
        JOIN branches b ON b.id = inv.branch_id
        LEFT JOIN profiles p ON p.id = inv.seller_profile_id
        LEFT JOIN LATERAL (
          SELECT SUM(pm.amount) AS paid_total
          FROM payments pm
          WHERE pm.reference_type = 'invoice' AND pm.reference_id = inv.id
            AND pm.status != 'voided'
        ) pay_agg ON true
        WHERE inv.invoice_type = 'sales' AND inv.status = 'posted'
          AND inv.invoice_date BETWEEN $1 AND $2${branchFilter}
          AND inv.total_amount - COALESCE(pay_agg.paid_total, 0) != 0
        ORDER BY ABS(inv.total_amount - COALESCE(pay_agg.paid_total, 0)) DESC
        LIMIT $3
      `, params);

      res.json({ data: { rows: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  // ==================== REPORTS ENDPOINTS ====================

  app.get("/api/pos/admin/reports/seller-net-profit", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, seller_id } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let extraFilter = '';
      let idx = 3;
      if (branch_id) { extraFilter += ` AND s.branch_id = $${idx}`; params.push(branch_id); idx++; }
      if (seller_id) { extraFilter += ` AND s.seller_profile_id = $${idx}`; params.push(seller_id); idx++; }

      const salesResult = await pool.query(`
        SELECT
          s.seller_profile_id AS seller_id,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          COALESCE(SUM(sii.total_price), 0) AS revenue,
          COALESCE(SUM(ui.cost), 0) AS cogs,
          COALESCE(SUM(sii.total_price) - SUM(ui.cost), 0) AS gross_profit,
          COUNT(DISTINCT s.id)::int AS sale_count
        FROM sales s
        JOIN profiles p ON p.id = s.seller_profile_id
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${extraFilter}
        GROUP BY s.seller_profile_id, p.full_name, p.username
        ORDER BY revenue DESC
      `, params);

      const retParams: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let retFilter = '';
      let retIdx = 3;
      if (branch_id) { retFilter += ` AND r.branch_id = $${retIdx}`; retParams.push(branch_id); retIdx++; }
      if (seller_id) { retFilter += ` AND s_orig.seller_profile_id = $${retIdx}`; retParams.push(seller_id); retIdx++; }

      const retResult = await pool.query(`
        SELECT
          s_orig.seller_profile_id AS seller_id,
          COALESCE(SUM(ri.total_price), 0) AS return_amount,
          COALESCE(SUM(ui_ret.cost), 0) AS return_cost,
          COUNT(DISTINCT r.id)::int AS return_count
        FROM returns r
        JOIN return_items ri ON ri.return_id = r.id
        JOIN unique_items ui_ret ON ui_ret.id = ri.item_id
        JOIN sales s_orig ON s_orig.id = r.original_sale_id
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2${retFilter}
        GROUP BY s_orig.seller_profile_id
      `, retParams);

      const returnMap = new Map<string, any>();
      for (const row of retResult.rows) returnMap.set(row.seller_id, row);

      const sellers = salesResult.rows.map((s: any) => {
        const ret = returnMap.get(s.seller_id);
        const returnAmount = parseFloat(ret?.return_amount || 0);
        const returnCost = parseFloat(ret?.return_cost || 0);
        const revenue = parseFloat(s.revenue);
        const cogs = parseFloat(s.cogs);
        const netRevenue = revenue - returnAmount;
        const netCogs = cogs - returnCost;
        const netProfit = netRevenue - netCogs;
        return {
          ...s,
          return_amount: returnAmount,
          return_cost: returnCost,
          return_count: ret?.return_count || 0,
          net_profit: netProfit,
          gp_percent: netRevenue > 0 ? Math.round((netProfit / netRevenue) * 10000) / 100 : 0,
        };
      });

      res.json({ data: { sellers }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/branch-net-profit", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND s.branch_id = $3'; params.push(branch_id); }

      const salesResult = await pool.query(`
        SELECT
          s.branch_id,
          b.name AS branch_name,
          COALESCE(SUM(sii.total_price), 0) AS revenue,
          COALESCE(SUM(ui.cost), 0) AS cogs,
          COALESCE(SUM(sii.total_price) - SUM(ui.cost), 0) AS gross_profit,
          COUNT(DISTINCT s.id)::int AS sale_count
        FROM sales s
        JOIN branches b ON b.id = s.branch_id
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${branchFilter}
        GROUP BY s.branch_id, b.name
        ORDER BY revenue DESC
      `, params);

      const retParams: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let retBranchFilter = '';
      if (branch_id) { retBranchFilter = ' AND r.branch_id = $3'; retParams.push(branch_id); }

      const retResult = await pool.query(`
        SELECT
          r.branch_id,
          COALESCE(SUM(ri.total_price), 0) AS return_amount,
          COALESCE(SUM(ui_ret.cost), 0) AS return_cost,
          COUNT(DISTINCT r.id)::int AS return_count
        FROM returns r
        JOIN return_items ri ON ri.return_id = r.id
        JOIN unique_items ui_ret ON ui_ret.id = ri.item_id
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2${retBranchFilter}
        GROUP BY r.branch_id
      `, retParams);

      const returnMap = new Map<string, any>();
      for (const row of retResult.rows) returnMap.set(row.branch_id, row);

      const branches = salesResult.rows.map((b: any) => {
        const ret = returnMap.get(b.branch_id);
        const returnAmount = parseFloat(ret?.return_amount || 0);
        const returnCost = parseFloat(ret?.return_cost || 0);
        const revenue = parseFloat(b.revenue);
        const cogs = parseFloat(b.cogs);
        const netRevenue = revenue - returnAmount;
        const netCogs = cogs - returnCost;
        const netProfit = netRevenue - netCogs;
        return {
          ...b,
          return_amount: returnAmount,
          return_cost: returnCost,
          return_count: ret?.return_count || 0,
          net_profit: netProfit,
          gp_percent: netRevenue > 0 ? Math.round((netProfit / netRevenue) * 10000) / 100 : 0,
        };
      });

      res.json({ data: { branches }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/inventory-valuation", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id } = req.query as Record<string, string>;
      const params: any[] = [];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND ui.branch_id = $1'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          b.id AS branch_id,
          b.name AS branch_name,
          COUNT(ui.id)::int AS item_count,
          COALESCE(SUM(ui.cost), 0) AS total_cost_value,
          COALESCE(SUM(ui.tag_price), 0) AS total_tag_value,
          COALESCE(SUM(ui.tag_price) - SUM(ui.cost), 0) AS potential_margin,
          CASE WHEN SUM(ui.cost) > 0 THEN ROUND(((SUM(ui.tag_price) - SUM(ui.cost)) / SUM(ui.cost)) * 100, 2) ELSE 0 END AS margin_pct
        FROM unique_items ui
        JOIN branches b ON b.id = ui.branch_id
        WHERE ui.status = 'in_stock'${branchFilter}
        GROUP BY b.id, b.name
        ORDER BY total_cost_value DESC
      `, params);

      const totals = {
        item_count: result.rows.reduce((s: number, r: any) => s + r.item_count, 0),
        total_cost_value: result.rows.reduce((s: number, r: any) => s + parseFloat(r.total_cost_value), 0),
        total_tag_value: result.rows.reduce((s: number, r: any) => s + parseFloat(r.total_tag_value), 0),
        potential_margin: result.rows.reduce((s: number, r: any) => s + parseFloat(r.potential_margin), 0),
      };

      res.json({ data: { branches: result.rows, totals }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/inventory-aging", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { branch_id } = req.query as Record<string, string>;
      const params: any[] = [];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND ui.branch_id = $1'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          b.id AS branch_id,
          b.name AS branch_name,
          COUNT(*) FILTER (WHERE ui.created_at >= NOW() - INTERVAL '30 days')::int AS age_0_30,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '30 days' AND ui.created_at >= NOW() - INTERVAL '60 days')::int AS age_31_60,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '60 days' AND ui.created_at >= NOW() - INTERVAL '90 days')::int AS age_61_90,
          COUNT(*) FILTER (WHERE ui.created_at < NOW() - INTERVAL '90 days')::int AS age_over_90,
          COUNT(*)::int AS total_in_stock,
          COALESCE(SUM(ui.cost), 0) AS total_cost,
          COALESCE(SUM(CASE WHEN ui.created_at < NOW() - INTERVAL '90 days' THEN ui.cost ELSE 0 END), 0) AS aging_cost_over_90
        FROM unique_items ui
        JOIN branches b ON b.id = ui.branch_id
        WHERE ui.status = 'in_stock'${branchFilter}
        GROUP BY b.id, b.name
        ORDER BY total_in_stock DESC
      `, params);

      const totals = {
        age_0_30: result.rows.reduce((s: number, r: any) => s + r.age_0_30, 0),
        age_31_60: result.rows.reduce((s: number, r: any) => s + r.age_31_60, 0),
        age_61_90: result.rows.reduce((s: number, r: any) => s + r.age_61_90, 0),
        age_over_90: result.rows.reduce((s: number, r: any) => s + r.age_over_90, 0),
        total_in_stock: result.rows.reduce((s: number, r: any) => s + r.total_in_stock, 0),
        total_cost: result.rows.reduce((s: number, r: any) => s + parseFloat(r.total_cost), 0),
        aging_cost_over_90: result.rows.reduce((s: number, r: any) => s + parseFloat(r.aging_cost_over_90), 0),
      };

      res.json({ data: { branches: result.rows, totals }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/returns-summary", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, seller_id } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let extraFilter = '';
      let idx = 3;
      if (branch_id) { extraFilter += ` AND r.branch_id = $${idx}`; params.push(branch_id); idx++; }
      if (seller_id) { extraFilter += ` AND s_orig.seller_profile_id = $${idx}`; params.push(seller_id); idx++; }

      const result = await pool.query(`
        SELECT
          s_orig.seller_profile_id AS seller_id,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          b.name AS branch_name,
          r.branch_id,
          COUNT(DISTINCT r.id)::int AS return_count,
          COALESCE(SUM(ri.total_price), 0) AS return_amount,
          COALESCE(SUM(ui_ret.cost), 0) AS return_cost
        FROM returns r
        JOIN return_items ri ON ri.return_id = r.id
        JOIN unique_items ui_ret ON ui_ret.id = ri.item_id
        JOIN sales s_orig ON s_orig.id = r.original_sale_id
        JOIN profiles p ON p.id = s_orig.seller_profile_id
        JOIN branches b ON b.id = r.branch_id
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2${extraFilter}
        GROUP BY s_orig.seller_profile_id, p.full_name, p.username, r.branch_id, b.name
        ORDER BY return_amount DESC
      `, params);

      const reasonResult = await pool.query(`
        SELECT
          ri.reason,
          COUNT(*)::int AS count
        FROM returns r
        JOIN return_items ri ON ri.return_id = r.id
        WHERE r.return_type = 'sales' AND r.status != 'voided'
          AND r.return_date BETWEEN $1 AND $2
          AND ri.reason IS NOT NULL AND ri.reason != ''
        GROUP BY ri.reason
        ORDER BY count DESC
        LIMIT 10
      `, [start + ' 00:00:00', end + ' 23:59:59']);

      res.json({ data: { rows: result.rows, top_reasons: reasonResult.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/reconciliation", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, limit: lim } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const rowLimit = parseInt(lim) || 100;
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59', rowLimit];
      let branchFilter = '';
      if (branch_id) { branchFilter = ' AND inv.branch_id = $4'; params.push(branch_id); }

      const result = await pool.query(`
        SELECT
          inv.id AS invoice_id,
          inv.invoice_number,
          inv.invoice_date,
          b.name AS branch_name,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          inv.total_amount AS invoice_total,
          COALESCE(pay_agg.paid_total, 0) AS paid_total,
          inv.total_amount - COALESCE(pay_agg.paid_total, 0) AS delta
        FROM invoices inv
        JOIN branches b ON b.id = inv.branch_id
        LEFT JOIN profiles p ON p.id = inv.seller_profile_id
        LEFT JOIN LATERAL (
          SELECT SUM(pm.amount) AS paid_total
          FROM payments pm
          WHERE pm.reference_type = 'invoice' AND pm.reference_id = inv.id
            AND pm.status != 'voided'
        ) pay_agg ON true
        WHERE inv.invoice_type = 'sales' AND inv.status = 'posted'
          AND inv.invoice_date BETWEEN $1 AND $2${branchFilter}
          AND inv.total_amount - COALESCE(pay_agg.paid_total, 0) != 0
        ORDER BY ABS(inv.total_amount - COALESCE(pay_agg.paid_total, 0)) DESC
        LIMIT $3
      `, params);

      res.json({ data: { rows: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/payment-mix", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, seller_id } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59'];
      let extraFilter = '';
      let idx = 3;
      if (branch_id) { extraFilter += ` AND pm.branch_id = $${idx}`; params.push(branch_id); idx++; }
      if (seller_id) { extraFilter += ` AND pm.seller_profile_id = $${idx}`; params.push(seller_id); idx++; }

      const result = await pool.query(`
        SELECT
          COALESCE(pm.payment_method, 'غير محدد') AS payment_method,
          COUNT(*)::int AS count,
          COALESCE(SUM(pm.amount), 0) AS total
        FROM payments pm
        WHERE pm.payment_type = 'receipt' AND pm.status != 'voided'
          AND pm.payment_date BETWEEN $1 AND $2${extraFilter}
        GROUP BY pm.payment_method
        ORDER BY total DESC
      `, params);

      const grand_total = result.rows.reduce((s: number, r: any) => s + parseFloat(r.total), 0);
      const rows = result.rows.map((r: any) => ({
        ...r,
        pct: grand_total > 0 ? Math.round((parseFloat(r.total) / grand_total) * 10000) / 100 : 0,
      }));

      res.json({ data: { rows, grand_total }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.get("/api/pos/admin/reports/sold-items-margin", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { start, end, branch_id, seller_id, limit: lim } = req.query as Record<string, string>;
      if (!start || !end) return res.status(400).json({ data: null, error: { message: 'start and end dates are required' } });
      const rowLimit = parseInt(lim) || 200;
      const params: any[] = [start + ' 00:00:00', end + ' 23:59:59', rowLimit];
      let extraFilter = '';
      let idx = 4;
      if (branch_id) { extraFilter += ` AND s.branch_id = $${idx}`; params.push(branch_id); idx++; }
      if (seller_id) { extraFilter += ` AND s.seller_profile_id = $${idx}`; params.push(seller_id); idx++; }

      const result = await pool.query(`
        SELECT
          ui.serial_no,
          inv.invoice_number,
          s.sale_date,
          b.name AS branch_name,
          COALESCE(NULLIF(p.full_name,''), p.username) AS seller_name,
          sii.total_price AS sale_price,
          ui.cost,
          sii.total_price - ui.cost AS margin,
          CASE WHEN ui.cost > 0 THEN ROUND(((sii.total_price - ui.cost) / ui.cost) * 100, 2) ELSE 0 END AS margin_pct,
          ui.model,
          ui.description
        FROM sales s
        JOIN invoices inv ON inv.sale_id = s.id AND inv.invoice_type = 'sales'
        JOIN sales_invoice_items sii ON sii.invoice_id = inv.id
        JOIN unique_items ui ON ui.id = sii.jewelry_item_id
        JOIN branches b ON b.id = s.branch_id
        LEFT JOIN profiles p ON p.id = s.seller_profile_id
        WHERE s.status = 'completed' AND s.sale_date BETWEEN $1 AND $2${extraFilter}
        ORDER BY s.sale_date DESC
        LIMIT $3
      `, params);

      res.json({ data: { rows: result.rows }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  // ==================== DASHBOARD SETTINGS ENDPOINTS ====================

  const ALLOWED_WIDGET_KEYS = ['today_kpis', 'profit_snapshot', 'top_sellers', 'top_branches', 'inventory_valuation', 'inventory_aging', 'reconciliation'];
  const DEFAULT_WIDGETS: Record<string, boolean> = Object.fromEntries(ALLOWED_WIDGET_KEYS.map(k => [k, true]));

  app.get("/api/pos/admin/settings/dashboard", requirePosAdminToken, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`SELECT value FROM app_settings WHERE key = 'pos_dashboard_widgets'`);
      if (result.rows.length === 0) {
        return res.json({ data: { widgets: { ...DEFAULT_WIDGETS } }, error: null });
      }
      try {
        const parsed = JSON.parse(result.rows[0].value);
        const widgets: Record<string, boolean> = {};
        for (const k of ALLOWED_WIDGET_KEYS) {
          widgets[k] = typeof parsed[k] === 'boolean' ? parsed[k] : true;
        }
        return res.json({ data: { widgets }, error: null });
      } catch {
        return res.json({ data: { widgets: { ...DEFAULT_WIDGETS } }, error: null });
      }
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });

  app.put("/api/pos/admin/settings/dashboard", requirePosAdminToken, async (req: Request, res: Response) => {
    try {
      const { widgets } = req.body || {};
      if (!widgets || typeof widgets !== 'object') {
        return res.status(400).json({ data: null, error: { message: 'widgets object is required' } });
      }
      const validated: Record<string, boolean> = {};
      for (const k of ALLOWED_WIDGET_KEYS) {
        if (typeof widgets[k] !== 'boolean') {
          return res.status(400).json({ data: null, error: { message: `Invalid value for widget '${k}': must be boolean` } });
        }
        validated[k] = widgets[k];
      }
      const extraKeys = Object.keys(widgets).filter(k => !ALLOWED_WIDGET_KEYS.includes(k));
      if (extraKeys.length > 0) {
        return res.status(400).json({ data: null, error: { message: `Unknown widget keys: ${extraKeys.join(', ')}` } });
      }
      const jsonValue = JSON.stringify(validated);
      await pool.query(`
        INSERT INTO app_settings (key, value, value_type, scope, description, is_sensitive, is_system, is_editable, updated_at)
        VALUES ('pos_dashboard_widgets', $1, 'json', 'pos_admin', 'POS admin dashboard widget visibility', true, true, true, now())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()
      `, [jsonValue]);
      res.json({ data: { widgets: validated }, error: null });
    } catch (error) {
      res.status(500).json({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  });
}
