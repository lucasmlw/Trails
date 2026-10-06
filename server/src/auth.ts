import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction, Router } from "express";
import express from "express";
import { z } from "zod";
import { db, now } from "./db.js";
import { env } from "./config.js";
import type { User } from "@trails/shared";

export const SESSION_COOKIE = "trails_session";

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

export function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export function ensureUser(username: string, password: string, displayName: string) {
  if (!username || !password) return;
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  const hash = bcrypt.hashSync(password, 12);
  if (existing) {
    // Keep the configured credentials authoritative so a password can be rotated via env.
    if (!bcrypt.compareSync(password, existing.password_hash) || existing.display_name !== displayName) {
      db.prepare("UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?").run(hash, displayName, existing.id);
      console.log(`Updated credentials for user "${username}"`);
    }
    return;
  }
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)").run(
    crypto.randomUUID(),
    username,
    hash,
    displayName,
    now(),
  );
  console.log(`Created user "${username}"`);
}

export function seedUsersFromEnv() {
  const { owner, friend } = env.users;
  ensureUser(owner.username, owner.password, owner.displayName);
  ensureUser(friend.username, friend.password, friend.displayName);
  const count = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  if (count === 0) {
    console.warn(
      "No users exist. Set OWNER_USERNAME/OWNER_PASSWORD and FRIEND_USERNAME/FRIEND_PASSWORD in .env (see .env.example) or run `npm run seed-users`.",
    );
  }
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createSession(userId: string, userAgent: string | undefined) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + env.sessionDays * 86400_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now(),
    expires,
    userAgent ?? null,
  );
  return { token, expires };
}

function readToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
}

export function getUserFromRequest(req: Request): User | null {
  const token = readToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export interface AuthedRequest extends Request {
  user: User;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  (req as AuthedRequest).user = user;
  next();
}

function setSessionCookie(res: Response, token: string, expires: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.secureCookies,
    expires: new Date(expires),
    path: "/",
  });
}

export function authRouter(): Router {
  const router = express.Router();

  const loginSchema = z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(1).max(500),
  });

  const attempts = new Map<string, { count: number; until: number }>();

  router.post("/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }
    const ip = req.ip ?? "unknown";
    const attempt = attempts.get(ip);
    if (attempt && attempt.count >= 10 && attempt.until > Date.now()) {
      res.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }
    const { username, password } = parsed.data;
    const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    const ok = row ? bcrypt.compareSync(password, row.password_hash) : false;
    if (!row || !ok) {
      const a = attempts.get(ip) ?? { count: 0, until: 0 };
      a.count += 1;
      a.until = Date.now() + 15 * 60_000;
      attempts.set(ip, a);
      res.status(401).json({ error: "Incorrect username or password" });
      return;
    }
    attempts.delete(ip);
    const { token, expires } = createSession(row.id, req.headers["user-agent"]);
    setSessionCookie(res, token, expires);
    res.json({ user: toUser(row), token, expires });
  });

  router.post("/logout", (req, res) => {
    const token = readToken(req);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const user = getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json({ user });
  });

  router.get("/users", requireAuth, (_req, res) => {
    const rows = db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[];
    res.json({ users: rows.map(toUser) });
  });

  return router;
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
}
