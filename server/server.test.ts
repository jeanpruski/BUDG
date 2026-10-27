import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, verifyOnlineFrontend } from "./index";
import { readConfig, databaseConfig } from "./config";
import { hashPassword, verifyPassword } from "./security";
import { captureMonthlyArchives, saveBudget, type PublicUser } from "./storage";
import { flushMonthlyArchives } from "./jobs";
import { closeMonth, configureHousehold, initialState, resetEverything, saveExpense, saveLine, savePayment, startNextMonth } from "../src/store";

describe("configuration et mots de passe", () => {
  it("exige HTTPS et un dossier privé de sauvegardes en production", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://localhost/budg" };
    expect(() => readConfig(base)).toThrow("APP_ORIGIN");
    expect(() => readConfig({ ...base, APP_ORIGIN: "http://budg.test" })).toThrow("HTTPS");
    expect(() => readConfig({ ...base, APP_ORIGIN: "https://budg.test" })).toThrow("BUDG_BACKUP_DIR");
    expect(() => readConfig({ ...base, APP_ORIGIN: "https://budg.test", BUDG_BACKUP_DIR: "backups" })).toThrow("absolu");
    expect(() => readConfig({ ...base, APP_ORIGIN: "https://budg.test", BUDG_BACKUP_DIR: join(process.cwd(), "dist/backups") })).toThrow("hors");
    expect(readConfig({ ...base, APP_ORIGIN: "https://budg.test", BUDG_BACKUP_DIR: "/tmp/budg-test-private", PORT: "passenger" }).port).toBe("passenger");
  });
  it("garde la vérification TLS PostgreSQL prioritaire sur les paramètres d’URL", () => {
    expect(() => readConfig({ DATABASE_URL: "postgresql://localhost/budg?sslmode=require", DATABASE_SSL: "true" })).toThrow("certificats");
    expect(databaseConfig(readConfig({ DATABASE_URL: "postgresql://localhost/budg", DATABASE_SSL: "true" })).ssl).toEqual({ rejectUnauthorized: true });
    expect(() => readConfig({ DATABASE_URL: "postgresql://localhost/budg", BUDG_BACKUP_DIR: join(process.cwd(), "dist/..private") })).toThrow("hors");
  });
  it("refuse un frontend local en production avant toute connexion à la base", async () => {
    const distDir = await mkdtemp(join(tmpdir(), "budg-marker-test-"));
    try {
      await expect(verifyOnlineFrontend({ production: true, distDir })).rejects.toThrow();
      await writeFile(join(distDir, "budg-runtime.json"), JSON.stringify({ storage: "local" }));
      await expect(verifyOnlineFrontend({ production: true, distDir })).rejects.toThrow("build:online");
      await writeFile(join(distDir, "budg-runtime.json"), JSON.stringify({ storage: "server" }));
      await expect(verifyOnlineFrontend({ production: true, distDir })).resolves.toBeUndefined();
    } finally { await rm(distDir, { recursive: true, force: true }); }
  });
  it("sale les mots de passe et rejette les mauvais secrets", async () => {
    const first = await hashPassword("correct-test-password"), second = await hashPassword("correct-test-password");
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct-test-password", first)).toBe(true);
    expect(await verifyPassword("incorrect", first)).toBe(false);
    expect(await verifyPassword("correct-test-password")).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow("12");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("API et transactions PostgreSQL réelles", () => {
  let admin: Pool, pool: Pool, server: Server, baseUrl: string, privateDir: string;
  let config: ReturnType<typeof readConfig>;
  const schema = `budg_api_${randomUUID().replaceAll("-", "")}`;
  const origin = "https://budg.test";
  const release = "f".repeat(40);
  const password = "correct-test-password";
  const editor: PublicUser = { id: randomUUID(), email: "editor@example.test", displayName: "Éditeur", role: "editor" };
  const viewer: PublicUser = { id: randomUUID(), email: "viewer@example.test", displayName: "Lecteur", role: "viewer" };
  let passwordHash: string;
  type Auth = { cookie: string; csrfToken: string };
  async function request(path: string, method = "GET", body?: unknown, auth?: Auth, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrfToken } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function login(user = editor): Promise<Auth> {
    const response = await request("/api/login", "POST", { email: user.email, password });
    expect(response.status).toBe(200);
    const body = await response.json();
    return { cookie: response.headers.get("set-cookie")!.split(";")[0], csrfToken: body.csrfToken };
  }
  function budget() {
    const configured = configureHousehold(initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08");
    return { ...configured, budget: { ...configured.budget, lines: [] } };
  }
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
    await pool.query(await readFile(join(process.cwd(), "server/migrations/001_online.sql"), "utf8"));
    passwordHash = await hashPassword(password);
    privateDir = await mkdtemp(join(tmpdir(), "budg-api-test-"));
    const distDir = join(privateDir, "dist");
    await mkdir(distDir);
    await writeFile(join(distDir, "index.html"), "<!doctype html><title>BUDG test</title>");
    await writeFile(join(privateDir, ".env"), "PRIVATE_TEST_VALUE");
    config = readConfig({ NODE_ENV: "production", APP_ORIGIN: origin, DATABASE_URL: process.env.TEST_DATABASE_URL,
      BUDG_DIST_DIR: distDir, BUDG_BACKUP_DIR: join(privateDir, "backups") });
    const previousRelease = process.env.BUDG_RELEASE;
    process.env.BUDG_RELEASE = release;
    try { server = createApp(config, pool).listen(0, "127.0.0.1"); }
    finally {
      if (previousRelease === undefined) delete process.env.BUDG_RELEASE;
      else process.env.BUDG_RELEASE = previousRelease;
    }
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE budg_sessions,budg_users,budg_state,budg_backups,budg_audit,budg_login_attempts,budg_monthly_archives RESTART IDENTITY CASCADE");
    await rm(join(privateDir, "backups"), { recursive: true, force: true });
    for (const user of [editor, viewer]) await pool.query(
      "INSERT INTO budg_users(id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)",
      [user.id, user.email, user.displayName, user.role, passwordHash],
    );
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
    if (privateDir) await rm(privateDir, { recursive: true, force: true });
  });

  it("vérifie PostgreSQL et expose uniquement la version capturée au démarrage sans connexion ni cache", async () => {
    const response = await request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ status: "ok", release });
    expect((await pool.query("SELECT count(*) FROM budg_sessions")).rows[0].count).toBe("0");
  });
  it("renvoie une erreur de santé générique si PostgreSQL est indisponible", async () => {
    const query = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("PRIVATE_DATABASE_FAILURE"));
    try {
      const response = await request("/api/health");
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Le serveur ne peut pas accéder aux données. Réessayez plus tard ; aucune remise à zéro n’a été effectuée." });
    } finally { query.mockRestore(); }
  });
  it("refuse les lectures anonymes et crée une session protégée dont seul le hash est stocké", async () => {
    expect((await request("/api/budget")).status).toBe(401);
    expect(await (await request("/api/session")).json()).toEqual({ user: null });
    const response = await request("/api/login", "POST", { email: editor.email.toUpperCase(), password });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Strict");
    const token = cookie.split(";")[0].split("=")[1];
    const session = (await pool.query("SELECT session_hash FROM budg_sessions")).rows[0];
    expect(session.session_hash).not.toBe(token);
    expect(session.session_hash).toMatch(/^[a-f0-9]{64}$/);
    const body = await response.json();
    const auth = { cookie: cookie.split(";")[0], csrfToken: body.csrfToken };
    expect((await (await request("/api/session", "GET", undefined, auth)).json()).user).toEqual(editor);
    expect(await (await request("/api/budget", "GET", undefined, auth)).json()).toEqual({ state: null });
    expect((await request("/api/logout", "POST", undefined, auth)).status).toBe(204);
    expect((await request("/api/budget", "GET", undefined, auth)).status).toBe(401);
  });
  it("impose origine, CSRF et droits serveur même avec un appel direct", async () => {
    expect((await request("/api/login", "POST", { email: editor.email, password }, undefined, { Origin: "https://evil.test" })).status).toBe(403);
    const editorAuth = await login(), viewerAuth = await login(viewer);
    const payload = { state: budget(), expectedRevision: 0 };
    expect((await request("/api/budget", "PUT", payload, { ...editorAuth, csrfToken: "" })).status).toBe(403);
    expect((await request("/api/budget", "PUT", payload, editorAuth, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await request("/api/budget", "PUT", payload, viewerAuth)).status).toBe(403);
    expect((await request("/api/backups", "GET", undefined, viewerAuth)).status).toBe(200);
    expect((await request("/api/audit", "GET", undefined, viewerAuth)).status).toBe(200);
    expect((await pool.query("SELECT count(*) FROM budg_state")).rows[0].count).toBe("0");
  });
  it("valide côté serveur et conserve l’état après un budget invalide ou une révision forcée", async () => {
    const auth = await login();
    const state = budget();
    expect((await request("/api/budget", "PUT", { state, expectedRevision: 0 }, auth)).status).toBe(200);
    const invalid = { ...state, members: [{ ...state.members[0], incomeCents: -1 }, state.members[1]] };
    expect((await request("/api/budget", "PUT", { state: invalid, expectedRevision: 1 }, auth)).status).toBe(422);
    expect((await request("/api/budget", "PUT", { state, expectedRevision: -1 }, auth)).status).toBe(422);
    const loaded = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(loaded.revision).toBe(1); expect(loaded.members[0].incomeCents).toBe(300000);
    expect((await pool.query("SELECT count(*) FROM budg_backups")).rows[0].count).toBe("0");
  });
  it("arbitre deux premières écritures concurrentes sans perdre la sauvegarde gagnante", async () => {
    const auth = await login();
    const results = await Promise.all([1, 2].map(() => request("/api/budget", "PUT", { state: budget(), expectedRevision: 0 }, auth)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await pool.query("SELECT revision FROM budg_state")).rows[0].revision).toBe("1");
  });
  it("trace création, correction, suppression et ne retrace pas un passage aux archives", async () => {
    let state = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 20000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    const payment = { id: "payment-1", memberId: "jean", amountCents: 10000, date: "2026-08-01", note: "Initial" };
    state = await saveBudget(pool, savePayment(state, payment), 0, editor);
    state = await saveBudget(pool, savePayment(state, { ...payment, note: "Corrigé" }), state.revision, editor);
    state = savePayment(state, { ...payment, id: "payment-2", memberId: "miruna" });
    state = await saveBudget(pool, startNextMonth(closeMonth(state)), state.revision, editor);
    const audit = (await pool.query("SELECT action,entity_id,before_data,after_data FROM budg_audit ORDER BY id")).rows;
    expect(audit.map((entry) => [entry.entity_id, entry.action])).toEqual([
      ["payment-1", "added"], ["payment-1", "updated"], ["payment-2", "added"],
    ]);
    expect(audit[1].before_data.note).toBe("Initial"); expect(audit[1].after_data.note).toBe("Corrigé");
    await saveBudget(pool, resetEverything(state), state.revision, editor);
    const actions = (await pool.query("SELECT action FROM budg_audit ORDER BY id")).rows.map((r) => r.action);
    expect(actions).toEqual(["added", "updated", "added", "deleted", "deleted"]);
  });
  it("annule budget, copie et traces ensemble si la transaction échoue", async () => {
    let state = await saveBudget(pool, budget(), 0, editor);
    await pool.query("CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$");
    await pool.query("CREATE TRIGGER fail_audit BEFORE INSERT ON budg_audit FOR EACH ROW EXECUTE FUNCTION fail_audit()");
    try {
      state = savePayment(state, { id: "rollback", memberId: "jean", amountCents: 100, date: "2026-08-01", note: "" });
      await expect(saveBudget(pool, state, 1, editor)).rejects.toThrow();
      expect((await pool.query("SELECT revision FROM budg_state")).rows[0].revision).toBe("1");
      expect((await pool.query("SELECT count(*) FROM budg_backups")).rows[0].count).toBe("0");
      expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
    } finally { await pool.query("DROP TRIGGER fail_audit ON budg_audit"); await pool.query("DROP FUNCTION fail_audit()"); }
  });
  it("actualise la copie provisoire après une correction tardive puis fige exactement la clôture", async () => {
    const options = (date: string) => ({ timeZone: "Europe/Paris", now: new Date(date) });
    let state = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    state = savePayment(state, { id: "jean-payment", memberId: "jean", amountCents: 5000, date: "2026-08-01", note: "" });
    state = savePayment(state, { id: "miruna-payment", memberId: "miruna", amountCents: 5000, date: "2026-08-01", note: "" });
    const expense = { id: "last-expense", lineId: "courses", amountCents: 1000, date: "2026-08-31", description: "Dernier achat" };
    state = await saveBudget(pool, saveExpense(state, expense, false), 0, editor, options("2026-08-31T21:00:00Z"));
    expect((await pool.query("SELECT count(*) FROM budg_monthly_archives")).rows[0].count).toBe("0");
    // Midnight captures the live SQL state even when no daily file exists.
    await captureMonthlyArchives(pool, null, state, options("2026-08-31T22:00:00Z"));
    let archive = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(archive.finalized).toBe(false); expect(archive.source_revision).toBe("1");
    state = await saveBudget(pool, saveExpense(state, { ...expense, amountCents: 2000, description: "Montant corrigé" }, false), 1, editor, options("2026-09-02T10:00:00Z"));
    archive = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(archive.finalized).toBe(false); expect(archive.snapshot.state.budget.expenses[0].amountCents).toBe(2000);
    state = await saveBudget(pool, closeMonth(state), 2, editor, options("2026-09-03T10:00:00Z"));
    archive = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(archive.finalized).toBe(true); expect(archive.source_revision).toBe("3");
    expect(archive.snapshot.state.budget.status).toBe("CLOSED");
    expect(archive.snapshot.audit).toHaveLength(4);
    const finalSnapshot = JSON.stringify(archive.snapshot);
    state = await saveBudget(pool, startNextMonth(state), 3, editor, options("2026-09-04T10:00:00Z"));
    await saveBudget(pool, resetEverything(state), 4, editor, options("2026-09-04T11:00:00Z"));
    archive = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(JSON.stringify(archive.snapshot)).toBe(finalSnapshot);
    expect(archive.published_revision).toBe("0");
  });
  it("capture une clôture anticipée et annule la sauvegarde si la mise en attente SQL échoue", async () => {
    let prepared = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    prepared = savePayment(prepared, { id: "jean-payment", memberId: "jean", amountCents: 5000, date: "2026-08-01", note: "" });
    prepared = savePayment(prepared, { id: "miruna-payment", memberId: "miruna", amountCents: 5000, date: "2026-08-01", note: "" });
    let state = await saveBudget(pool, prepared, 0, editor, { now: new Date("2026-08-15T12:00:00Z") });
    await pool.query("CREATE FUNCTION fail_monthly() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$");
    await pool.query("CREATE TRIGGER fail_monthly BEFORE INSERT ON budg_monthly_archives FOR EACH ROW EXECUTE FUNCTION fail_monthly()");
    try {
      await expect(saveBudget(pool, closeMonth(state), 1, editor, { now: new Date("2026-08-16T12:00:00Z") })).rejects.toThrow();
      expect((await pool.query("SELECT revision,data FROM budg_state")).rows[0]).toMatchObject({ revision: "1", data: { budget: { status: "ACTIVE" } } });
      expect((await pool.query("SELECT count(*) FROM budg_backups")).rows[0].count).toBe("0");
    } finally { await pool.query("DROP TRIGGER fail_monthly ON budg_monthly_archives"); await pool.query("DROP FUNCTION fail_monthly()"); }
    state = await saveBudget(pool, closeMonth(state), 1, editor, { now: new Date("2026-08-16T12:00:00Z") });
    const archive = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(archive.finalized).toBe(true); expect(archive.snapshot.state.revision).toBe(state.revision);
  });
  it("confirme la sauvegarde financière malgré une panne disque et publie ensuite la copie SQL exacte", async () => {
    const auth = await login();
    await mkdir(join(privateDir, "backups"));
    await writeFile(join(privateDir, "backups", "monthly"), "obstacle disque simulé");
    const response = await request("/api/budget", "PUT", { state: budget(), expectedRevision: 0 }, auth);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.state.revision).toBe(1); expect(saved.warnings).toHaveLength(1);
    const queued = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-08'")).rows[0];
    expect(queued.published_revision).toBe("0");
    expect((await pool.query("SELECT revision FROM budg_state")).rows[0].revision).toBe("1");
    await rm(join(privateDir, "backups", "monthly"));
    expect((await flushMonthlyArchives(config, pool)).pending).toBe(0);
    const copy = JSON.parse(await readFile(join(privateDir, "backups", "monthly", "2026-08.json"), "utf8"));
    expect(copy).toEqual(queued.snapshot);
    expect((await pool.query("SELECT published_revision FROM budg_monthly_archives WHERE month='2026-08'")).rows[0].published_revision).toBe("1");
  });
  it("limite les connexions en base et refuse de servir les fichiers privés", async () => {
    for (let i = 0; i < 10; i++) expect((await request("/api/login", "POST", { email: editor.email, password: "incorrect" })).status).toBe(401);
    expect((await request("/api/login", "POST", { email: editor.email, password })).status).toBe(429);
    expect((await pool.query("SELECT max(attempts) FROM budg_login_attempts")).rows[0].max).toBe(11);
    for (const path of ["/.env", "/server/index.ts", "/backups/monthly/2026-08.json", "/package.json", "/../.env"]) {
      const response = await request(path); expect(response.status).toBe(404); expect(await response.text()).not.toContain("PRIVATE_TEST_VALUE");
    }
    expect((await request("/")).status).toBe(200);
  });
});
