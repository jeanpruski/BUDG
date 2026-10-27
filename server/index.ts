import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { Pool } from "pg";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { validateState } from "../src/domain";
import { readConfig, databaseConfig, type ServerConfig } from "./config";
import { secretToken, tokenHash, sameToken, verifyPassword } from "./security";
import { ApiError, saveBudget, type PublicUser } from "./storage";
import { flushMonthlyArchives } from "./jobs";

type Session = { user: PublicUser; csrfToken: string; sessionHash: string };
type AuthRequest = Request & { auth?: Session };
type AsyncRoute = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>;
const route = (handler: AsyncRoute): RequestHandler => (req, res, next) => { void handler(req, res, next).catch(next); };
const invalidLogin = "Connexion impossible. Vérifiez vos identifiants ou réessayez plus tard.";
export const cookieName = (config: Pick<ServerConfig, "production">) => config.production ? "__Host-budg-session" : "budg-session";

function readCookie(req: Request, name: string): string | undefined {
  const entry = req.headers.cookie?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  const token = entry?.slice(name.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
function originGuard(config: ServerConfig): RequestHandler {
  return (req, _res, next) => {
    if (req.get("Origin") !== config.appOrigin || req.get("Sec-Fetch-Site") === "cross-site")
      return next(new ApiError(403, "L’origine de cette requête est refusée."));
    next();
  };
}
const requireLogin: RequestHandler = (req: AuthRequest, _res, next) =>
  req.auth ? next() : next(new ApiError(401, "Connectez-vous pour accéder au budget."));
const requireEditor: RequestHandler = (req: AuthRequest, _res, next) =>
  req.auth?.user.role === "editor" ? next() : next(new ApiError(403, "Ce compte dispose d’un accès en lecture seule."));
const requireCsrf: RequestHandler = (req: AuthRequest, _res, next) => {
  const token = req.get("X-CSRF-Token") || "";
  if (!req.auth || !token || !sameToken(token, req.auth.csrfToken))
    return next(new ApiError(403, "Rechargez la page avant de réessayer cette action."));
  next();
};
const requireJson: RequestHandler = (req, _res, next) =>
  req.is("application/json") ? next() : next(new ApiError(415, "Une requête JSON est nécessaire."));

async function consumeLoginAttempt(pool: Pool, key: string, limit: number): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO budg_login_attempts(key,attempts,window_start) VALUES ($1,1,now())
     ON CONFLICT(key) DO UPDATE SET
       attempts=CASE WHEN budg_login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE budg_login_attempts.attempts+1 END,
       window_start=CASE WHEN budg_login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE budg_login_attempts.window_start END
     RETURNING attempts`, [key],
  );
  return result.rows[0].attempts <= limit;
}

export function createApp(config: ServerConfig, pool: Pool) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (config.production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.use("/api", express.json({ limit: "10mb", strict: true }));
  app.use("/api", route(async (req, _res, next) => {
    const token = readCookie(req, cookieName(config));
    if (token) {
      const result = await pool.query(
        `SELECT u.id,u.email,u.display_name AS "displayName",u.role,s.csrf_token AS "csrfToken",s.session_hash AS "sessionHash"
         FROM budg_sessions s JOIN budg_users u ON u.id=s.user_id
         WHERE s.session_hash=$1 AND s.expires_at>now() AND u.enabled=true`, [tokenHash(token)],
      );
      const row = result.rows[0];
      if (row) req.auth = {
        user: { id: row.id, email: row.email, displayName: row.displayName, role: row.role },
        csrfToken: row.csrfToken, sessionHash: row.sessionHash,
      };
    }
    next();
  }));
  app.get("/api/session", (req: AuthRequest, res) =>
    res.json(req.auth ? { user: req.auth.user, csrfToken: req.auth.csrfToken } : { user: null }),
  );
  app.post("/api/login", originGuard(config), requireJson, route(async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const ipAllowed = await consumeLoginAttempt(pool, `ip:${tokenHash(req.ip || "unknown")}`, 30);
    if (!ipAllowed) {
      res.setHeader("Retry-After", "900");
      throw new ApiError(429, invalidLogin);
    }
    const emailAllowed = await consumeLoginAttempt(pool, `email:${tokenHash(email.slice(0, 254))}`, 10);
    if (!emailAllowed) {
      res.setHeader("Retry-After", "900");
      throw new ApiError(429, invalidLogin);
    }
    if (!email || email.length > 254 || !password || Buffer.byteLength(password) > 1024)
      throw new ApiError(401, invalidLogin);
    const result = await pool.query(
      `SELECT id,email,display_name AS "displayName",role,password_hash AS "passwordHash",enabled FROM budg_users WHERE email=$1`, [email],
    );
    const row = result.rows[0];
    const valid = await verifyPassword(password, row?.passwordHash);
    if (!valid || !row?.enabled) throw new ApiError(401, invalidLogin);
    const token = secretToken(), csrfToken = secretToken();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (req.auth) await client.query("DELETE FROM budg_sessions WHERE session_hash=$1", [req.auth.sessionHash]);
      await client.query(
        `INSERT INTO budg_sessions(session_hash,user_id,csrf_token,expires_at)
         VALUES ($1,$2,$3,now()+($4::integer * interval '1 day'))`,
        [tokenHash(token), row.id, csrfToken, config.sessionTtlDays],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    res.cookie(cookieName(config), token, {
      httpOnly: true, secure: config.production, sameSite: "strict", path: "/",
      maxAge: config.sessionTtlDays * 86_400_000,
    });
    res.json({ user: { id: row.id, email: row.email, displayName: row.displayName, role: row.role }, csrfToken });
  }));
  app.post("/api/logout", requireLogin, originGuard(config), requireCsrf, route(async (req, res) => {
    await pool.query("DELETE FROM budg_sessions WHERE session_hash=$1", [req.auth!.sessionHash]);
    res.clearCookie(cookieName(config), { httpOnly: true, secure: config.production, sameSite: "strict", path: "/" });
    res.status(204).end();
  }));
  app.get("/api/budget", requireLogin, route(async (_req, res) => {
    const result = await pool.query("SELECT data FROM budg_state WHERE id=1");
    res.json({ state: result.rows[0] ? validateState(result.rows[0].data) : null });
  }));
  app.put("/api/budget", requireLogin, requireEditor, originGuard(config), requireCsrf, requireJson, route(async (req, res) => {
    const state = await saveBudget(pool, req.body?.state, req.body?.expectedRevision, req.auth!.user, { timeZone: config.timeZone });
    const warnings: string[] = [];
    // Financial data is committed. A disk problem must never turn this successful save into an error.
    try {
      const result = await flushMonthlyArchives(config, pool);
      if (result.pending > 0) warnings.push("Une archive mensuelle attend sa publication. La prochaine tâche horaire réessaiera automatiquement.");
    } catch {
      console.error("BUDG: une archive mensuelle reste en attente de publication.");
      warnings.push("Une archive mensuelle reste en attente de publication sur disque. Les données et la copie mensuelle sont conservées en base ; une nouvelle tentative sera effectuée automatiquement.");
    }
    res.json({ state, ...(warnings.length ? { warnings } : {}) });
  }));
  app.get("/api/backups", requireLogin, route(async (_req, res) => {
    const result = await pool.query("SELECT id,created_at AS \"createdAt\",data FROM budg_backups ORDER BY revision DESC,created_at DESC,id DESC LIMIT 20");
    res.json({ backups: result.rows.map((row) => ({ id: row.id, createdAt: row.createdAt, state: validateState(row.data) })) });
  }));
  app.get("/api/audit", requireLogin, route(async (req, res) => {
    const limit = Number(req.query.limit || 100);
    const before = typeof req.query.before === "string" ? req.query.before : null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (before !== null && !/^[1-9]\d{0,18}$/.test(before)))
      throw new ApiError(422, "Pagination invalide.");
    const result = await pool.query(
      `SELECT id,created_at AS "createdAt",actor_user_id AS "actorUserId",actor_email AS "actorEmail",
       actor_display_name AS "actorDisplayName",entity_type AS "entityType",entity_id AS "entityId",
       entity_month AS "month",action,revision,before_data AS "before",after_data AS "after"
       FROM budg_audit WHERE ($1::bigint IS NULL OR id<$1::bigint) ORDER BY id DESC LIMIT $2`, [before, limit],
    );
    res.json({ entries: result.rows, nextBefore: result.rows.length === limit ? result.rows.at(-1).id : null });
  }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Cette route n’existe pas." }));
  // Only the built public directory is exposed; never fall back to project files.
  app.use(express.static(config.distDir, { dotfiles: "deny", index: false, fallthrough: true }));
  app.get("/", (_req, res, next) => res.sendFile(resolve(config.distDir, "index.html"), (error) => { if (error) next(error); }));
  app.use((_req, res) => res.status(404).type("text").send("Introuvable"));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 413) return res.status(status).json({ error: status === 413 ? "La requête est trop volumineuse." : "La requête JSON est invalide." });
    if (status === 404) return res.status(404).json({ error: "Introuvable" });
    // Do not log credentials, request bodies, SQL parameters or connection strings.
    console.error("BUDG: une opération serveur a échoué.");
    res.status(503).json({ error: "Le serveur ne peut pas accéder aux données. Réessayez plus tard ; aucune remise à zéro n’a été effectuée." });
  });
  return app;
}

export async function verifyOnlineFrontend(config: Pick<ServerConfig, "production" | "distDir">) {
  if (config.production) {
    const runtime = JSON.parse(await readFile(resolve(config.distDir, "budg-runtime.json"), "utf8"));
    if (runtime?.storage !== "server") throw new Error("Le frontend doit être compilé avec npm run build:online.");
  }
}
export async function startServer() {
  const config = readConfig();
  await verifyOnlineFrontend(config);
  const pool = new Pool(databaseConfig(config));
  pool.on("error", () => console.error("BUDG: connexion PostgreSQL interrompue."));
  await pool.query("SELECT 1 FROM budg_users LIMIT 1");
  const app = createApp(config, pool);
  const server = typeof config.port === "number" ? app.listen(config.port, config.host) : app.listen(config.port);
  server.on("listening", () => console.log("BUDG: serveur prêt."));
  const stop = () => { server.close(() => { void pool.end().finally(() => process.exit(0)); }); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  return server;
}
if (typeof require !== "undefined" && require.main === module)
  void startServer().catch(() => { console.error("BUDG: démarrage impossible. Vérifiez la configuration et les migrations."); process.exitCode = 1; });
