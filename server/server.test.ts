import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, verifyOnlineFrontend } from "./index";
import * as reportDelivery from "./reportDelivery";
import { readConfig, databaseConfig } from "./config";
import { hashPassword, verifyPassword } from "./security";
import { captureMonthlyArchives, saveBudget, type PublicUser } from "./storage";
import { flushMonthlyArchives, parseServerSnapshot, restoreDisasterSnapshot } from "./jobs";
import { closeBill, closeMonth, configureHousehold, initialState, removePotTransfer, reopenBill, resetEverything, saveExpense, saveLine, saveLineAmount, savePayment, savePotTransfer, startNextMonth } from "../src/store";
import { accountBalance, amountForMonth, budgetSummary, potSummary } from "../src/domain";
import { startTrackingAtMonth } from "../src/budgetStart";

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
  function withPot() {
    let state = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 50000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    for (const member of budgetSummary(state.budget).balances) state = savePayment(state, {
      id: `initial-${member.id}`, memberId: member.id, amountCents: member.remaining, date: "2026-08-01", note: "Contribution du mois précédent",
    });
    state = startNextMonth(closeMonth(state));
    return saveLine(state, { id: "vacances", name: "Vacances", plannedCents: 60000, expenseGroup: "DAILY_LIFE", kind: "RESERVE" });
  }
  function withBills(spentCents = 8000, secondBill = false) {
    let state = saveLine(budget(), { id: "bill", name: "Électricité", plannedCents: 10000, expenseGroup: "HOUSING", kind: "FIXED" });
    if (secondBill) state = saveLine(state, { id: "other-bill", name: "Internet", plannedCents: 10000, expenseGroup: "HOUSING", kind: "FIXED" });
    state = saveLine(state, { id: "reserve", name: "Vacances", plannedCents: 0, expenseGroup: "DAILY_LIFE", kind: "RESERVE" });
    for (const member of budgetSummary(state.budget).balances) state = savePayment(state, {
      id: `bill-funding-${member.id}`, memberId: member.id, amountCents: member.remaining, date: "2026-08-01", note: "Financement réel",
    });
    state = saveExpense(state, { id: "bill-paid", lineId: "bill", amountCents: spentCents, date: "2026-08-02", description: "Facture payée" }, true);
    if (secondBill) state = saveExpense(state, { id: "other-bill-paid", lineId: "other-bill", amountCents: 8000, date: "2026-08-02", description: "Deuxième facture payée" }, true);
    return state;
  }
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
    await pool.query(await readFile(join(process.cwd(), "server/migrations/001_online.sql"), "utf8"));
    await pool.query(await readFile(join(process.cwd(), "server/migrations/002_amount_plans.sql"), "utf8"));
    await pool.query(await readFile(join(process.cwd(), "server/migrations/003_email_reports.sql"), "utf8"));
    await pool.query(await readFile(join(process.cwd(), "server/migrations/004_pot_transfers.sql"), "utf8"));
    await pool.query(await readFile(join(process.cwd(), "server/migrations/005_bill_closures.sql"), "utf8"));
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
    await pool.query("TRUNCATE budg_sessions,budg_users,budg_state,budg_backups,budg_audit,budg_login_attempts,budg_monthly_archives,budg_email_reports RESTART IDENTITY CASCADE");
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
  it("démarre novembre en conservant la préparation d’octobre sans créer de mouvements ni clôture comptable", async () => {
    const auth = await login(), viewerAuth = await login(viewer);
    let preparation = configureHousehold(initialState("2026-10"), ["Camille", "Alex"], [300000, 200000], "2026-10");
    preparation = saveLine(preparation, { ...preparation.budget.lines[0], plannedCents: 100000 });
    const response = await request("/api/budget", "PUT", { state: preparation, expectedRevision: 0 }, auth);
    expect(response.status).toBe(200);
    const previous = (await response.json()).state;
    // Simulate the provisional archive from the first of November without altering I/O timers.
    await captureMonthlyArchives(pool, null, previous, { now: new Date("2026-11-03T12:00:00Z"), timeZone: "Europe/Paris" });
    const provisional = (await pool.query("SELECT snapshot FROM budg_monthly_archives WHERE month='2026-10'")).rows[0].snapshot;
    let next;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
      next = startTrackingAtMonth(previous, "2026-11");
    } finally { vi.useRealTimers(); }
    expect((await request("/api/budget", "PUT", { state: next, expectedRevision: previous.revision }, viewerAuth)).status).toBe(403);
    const savedResponse = await request("/api/budget", "PUT", { state: next, expectedRevision: previous.revision }, auth);
    expect(savedResponse.status).toBe(200);
    const saved = (await savedResponse.json()).state;
    expect(saved.budget).toMatchObject({ id: "2026-11", status: "ACTIVE", payments: [], expenses: [], refunds: [], closedPotCents: 0 });
    expect(saved.archivedBudgets).toEqual([]);
    expect(saved.budget.lines).toEqual(next.budget.lines);
    expect(accountBalance(saved)).toBe(0);
    expect(potSummary(saved).availableCents).toBe(0);
    const backups = (await (await request("/api/backups", "GET", undefined, auth)).json()).backups;
    expect(backups).toHaveLength(1);
    expect(backups[0].state).toEqual(previous);
    expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
    const archive = (await pool.query("SELECT snapshot,finalized FROM budg_monthly_archives WHERE month='2026-10'")).rows[0];
    expect(archive.finalized).toBe(false);
    expect(archive.snapshot).toEqual(provisional);
    expect((await pool.query("SELECT count(*) FROM budg_monthly_archives WHERE finalized")).rows[0].count).toBe("0");
  });
  it("conserve les exceptions et montants habituels après un aller-retour JSON via l’API", async () => {
    const auth = await login();
    let state = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
    state = saveLine(state, { ...state.budget.lines[0], plannedCents: 95000 });
    state = saveLineAmount(state, "credit", 0, "2026-11", "MONTH");
    state = saveLineAmount(state, "credit", 125432, "2026-12", "MONTH");
    state = saveLineAmount(state, "credit", 95000, "2027-01", "FROM_MONTH");
    const response = await request("/api/budget", "PUT", { state, expectedRevision: 0 }, auth);
    expect(response.status).toBe(200);
    const saved = (await response.json()).state;
    const loaded = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(loaded).toEqual(saved);
    expect(loaded.version).toBe(7);
    const line = loaded.budget.lines.find((entry: { id: string }) => entry.id === "credit");
    expect(["2026-11", "2026-12", "2027-01", "2027-02"].map((month) => amountForMonth(line, month))).toEqual([0, 125432, 95000, 95000]);
    expect(line.plannedCents).toBe(0);
    expect(line.shares.map((entry: { amountCents: number }) => entry.amountCents)).toEqual([0, 0]);
    expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
    const invalid = { ...loaded, budget: { ...loaded.budget, lines: loaded.budget.lines.map((entry: { id: string }) => entry.id === "credit" ? { ...entry, plannedCents: 95000 } : entry) } };
    expect((await request("/api/budget", "PUT", { state: invalid, expectedRevision: loaded.revision }, auth)).status).toBe(422);
    expect((await (await request("/api/budget", "GET", undefined, auth)).json()).state).toEqual(loaded);
  });
  it("élargit le format SQL sans réécrire les données V4 et reste idempotent", async () => {
    const legacy = { ...budget(), version: 4, revision: 1 };
    const backupId = randomUUID();
    await pool.query("INSERT INTO budg_state(id,revision,data) VALUES(1,1,$1)", [JSON.stringify(legacy)]);
    await pool.query("INSERT INTO budg_backups(id,revision,data) VALUES($1,1,$2)", [backupId, JSON.stringify(legacy)]);
    const beforeState = (await pool.query("SELECT revision,data,updated_at FROM budg_state")).rows;
    const beforeBackups = (await pool.query("SELECT id,revision,data,created_at FROM budg_backups")).rows;
    for (let i = 0; i < 2; i++) {
      await pool.query(await readFile(join(process.cwd(), "server/migrations/001_online.sql"), "utf8"));
      await pool.query(await readFile(join(process.cwd(), "server/migrations/002_amount_plans.sql"), "utf8"));
      await pool.query(await readFile(join(process.cwd(), "server/migrations/004_pot_transfers.sql"), "utf8"));
      await pool.query(await readFile(join(process.cwd(), "server/migrations/005_bill_closures.sql"), "utf8"));
    }
    expect((await pool.query("SELECT revision,data,updated_at FROM budg_state")).rows).toEqual(beforeState);
    expect((await pool.query("SELECT id,revision,data,created_at FROM budg_backups")).rows).toEqual(beforeBackups);
    const auth = await login();
    const upgraded = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(upgraded.version).toBe(7);
    expect(upgraded.budget).toEqual(legacy.budget);
    expect((await pool.query("SELECT data->>'version' AS version FROM budg_state")).rows[0].version).toBe("4");
    await expect(pool.query("UPDATE budg_state SET data=jsonb_set(data,'{version}','8'::jsonb)")).rejects.toMatchObject({ code: "23514" });
    expect((await request("/api/budget", "PUT", { state: upgraded, expectedRevision: 1 }, auth)).status).toBe(200);
    expect((await pool.query("SELECT data->>'version' AS version FROM budg_state")).rows[0].version).toBe("7");
    const written = (await pool.query("SELECT revision,data,updated_at FROM budg_state")).rows;
    for (let pass = 0; pass < 2; pass++) {
      for (const migration of ["001_online.sql", "002_amount_plans.sql", "003_email_reports.sql", "004_pot_transfers.sql", "005_bill_closures.sql"])
        await pool.query(await readFile(join(process.cwd(), "server/migrations", migration), "utf8"));
    }
    expect((await pool.query("SELECT revision,data,updated_at FROM budg_state")).rows).toEqual(written);
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
    await saveBudget(pool, resetEverything(state), state.revision, editor, { allowHistoryRewrite: true });
    const actions = (await pool.query("SELECT action FROM budg_audit ORDER BY id")).rows.map((r) => r.action);
    expect(actions).toEqual(["added", "updated", "added", "deleted", "deleted"]);
  });
  it("trace et arbitre les transferts internes puis leur annulation sans toucher au solde bancaire", async () => {
    const auth = await login(), viewerAuth = await login(viewer);
    const before = await saveBudget(pool, withPot(), 0, editor);
    const bank = accountBalance(before);
    const next = savePotTransfer(before, { id: "top-up", lineId: "vacances", amountCents: 20000, date: "2026-09-02", note: "Complément ponctuel" });
    expect((await request("/api/budget", "PUT", { state: next, expectedRevision: before.revision }, viewerAuth)).status).toBe(403);
    expect((await request("/api/budget", "PUT", { state: next, expectedRevision: before.revision, intent: "other" }, auth)).status).toBe(422);
    const responses = await Promise.all([1, 2].map(() => request("/api/budget", "PUT", { state: next, expectedRevision: before.revision }, auth)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = (await responses.find((response) => response.status === 200)!.json()).state;
    expect(accountBalance(saved)).toBe(bank);
    expect(potSummary(saved).availableCents).toBe(30000);
    expect(budgetSummary(saved.budget).missingCents).toBe(budgetSummary(before.budget).missingCents);
    const cancelled = removePotTransfer(saved, "top-up");
    const response = await request("/api/budget", "PUT", { state: cancelled, expectedRevision: saved.revision }, auth);
    expect(response.status).toBe(200);
    const after = (await response.json()).state;
    expect(accountBalance(after)).toBe(bank);
    expect(potSummary(after).availableCents).toBe(50000);
    const audit = (await pool.query("SELECT actor_email,entity_month,entity_id,action,before_data,after_data FROM budg_audit WHERE entity_type='potTransfer' ORDER BY id")).rows;
    expect(audit.map((entry) => entry.action)).toEqual(["added", "deleted"]);
    expect(audit.every((entry) => entry.actor_email === editor.email && entry.entity_month === "2026-09" && entry.entity_id === "top-up")).toBe(true);
    expect(audit[0].after_data).toEqual(next.budget.potTransfers[0]);
    expect(audit[1].before_data).toEqual(next.budget.potTransfers[0]);
    const backups = (await (await request("/api/backups", "GET", undefined, auth)).json()).backups;
    expect(backups[0].state.budget.potTransfers).toEqual(next.budget.potTransfers);
    expect((await request("/api/budget", "PUT", { state: { ...after, potSequence: after.potSequence - 1 }, expectedRevision: after.revision }, auth)).status).toBe(422);
    const retried = savePotTransfer(after, { id: "top-up-again", lineId: "vacances", amountCents: 100, date: "2026-09-03", note: "Nouvelle affectation" });
    const reused = { ...retried, budget: { ...retried.budget, potTransfers: retried.budget.potTransfers.map((entry) => ({ ...entry, order: after.potSequence })) } };
    expect((await request("/api/budget", "PUT", { state: reused, expectedRevision: after.revision }, auth)).status).toBe(422);
  });
  it("verrouille les transferts clôturés et accepte une restauration explicite auditée réservée à l’éditeur", async () => {
    const auth = await login(), viewerAuth = await login(viewer);
    let source = savePotTransfer(withPot(), { id: "top-up", lineId: "vacances", amountCents: 20000, date: "2026-09-02", note: "Original" });
    for (const member of budgetSummary(source.budget).balances) source = savePayment(source, {
      id: `current-${member.id}`, memberId: member.id, amountCents: member.remaining, date: "2026-09-03", note: "Contribution reçue",
    });
    const closed = await saveBudget(pool, closeMonth(source), 0, editor);
    const restored = { ...closed, budget: { ...closed.budget, potTransfers: closed.budget.potTransfers.map((transfer) => ({ ...transfer, note: "Note restaurée" })) } };
    const payload = { state: restored, expectedRevision: closed.revision };
    expect((await request("/api/budget", "PUT", payload, auth)).status).toBe(422);
    expect((await request("/api/budget", "PUT", { ...payload, intent: "restore" }, viewerAuth)).status).toBe(403);
    expect((await pool.query("SELECT revision FROM budg_state WHERE id=1")).rows[0].revision).toBe(String(closed.revision));
    expect((await request("/api/budget", "PUT", { ...payload, intent: "restore" }, auth)).status).toBe(200);
    const audit = (await pool.query("SELECT action,before_data,after_data FROM budg_audit WHERE entity_type='potTransfer' ORDER BY id")).rows;
    expect(audit.map((entry) => entry.action)).toEqual(["added", "updated"]);
    expect(audit[1].before_data.note).toBe("Original");
    expect(audit[1].after_data.note).toBe("Note restaurée");
    const frozen = (await pool.query("SELECT snapshot FROM budg_monthly_archives WHERE month='2026-09'")).rows[0].snapshot;
    expect(frozen.state.budget.potTransfers[0].note).toBe("Original");
  });
  it("restaure intégralement un export serveur avec les transferts et leurs traces", async () => {
    const source = await saveBudget(pool, savePotTransfer(withPot(), {
      id: "top-up", lineId: "vacances", amountCents: 20000, date: "2026-09-02", note: "À conserver dans la sauvegarde",
    }), 0, editor);
    const audit = (await pool.query("SELECT * FROM budg_audit ORDER BY id")).rows;
    const snapshot = parseServerSnapshot(JSON.parse(JSON.stringify({
      format: "BUDG_SERVER_BACKUP", version: 1, kind: "daily", month: "2026-09",
      createdAt: "2026-10-01T00:00:00Z", timeZone: "Europe/Paris", state: source, audit,
    })));
    expect(snapshot.audit.some((entry) => entry.entity_type === "potTransfer")).toBe(true);
    await pool.query("TRUNCATE budg_state,budg_audit,budg_backups,budg_monthly_archives,budg_email_reports RESTART IDENTITY");
    expect(await restoreDisasterSnapshot(pool, snapshot)).toEqual({ revision: source.revision, auditEvents: audit.length });
    const auth = await login();
    const restored = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(restored).toEqual(source);
    expect((await pool.query("SELECT count(*) FROM budg_audit WHERE entity_type='potTransfer'")).rows[0].count).toBe("1");
  });
  it.each([8000, 10000])("clôture une facture payée %s centimes une seule fois, avec crédit réel et sans email mensuel", async (spentCents) => {
    const auth = await login(), viewerAuth = await login(viewer);
    const before = await saveBudget(pool, withBills(spentCents), 0, editor);
    const next = closeBill(before, "bill");
    const payload = { state: next, expectedRevision: before.revision };
    expect((await request("/api/budget", "PUT", payload, viewerAuth)).status).toBe(403);
    const responses = await Promise.all([1, 2].map(() => request("/api/budget", "PUT", payload, auth)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = (await responses.find((response) => response.status === 200)!.json()).state;
    expect(saved.budget.status).toBe("ACTIVE");
    expect(saved.budget.billClosures).toHaveLength(1);
    expect(saved.budget.billClosures[0].amountCents).toBe(10000 - spentCents);
    expect(potSummary(saved).availableCents).toBe(10000 - spentCents);
    expect(accountBalance(saved)).toBe(accountBalance(before));
    const audit = (await pool.query("SELECT * FROM budg_audit ORDER BY id")).rows;
    const closures = audit.filter((entry) => entry.entity_type === "billClosure");
    expect(closures).toHaveLength(1);
    expect(closures[0].action).toBe("added");
    expect(closures[0].after_data).toEqual(saved.budget.billClosures[0]);
    expect((await pool.query("SELECT count(*) FROM budg_email_reports")).rows[0].count).toBe("0");
    const snapshot = parseServerSnapshot({
      format: "BUDG_SERVER_BACKUP", version: 1, kind: "daily", month: "2026-08",
      createdAt: "2026-09-01T00:00:00Z", timeZone: "Europe/Paris", state: saved, audit,
    });
    expect(snapshot.audit.find((entry) => entry.entity_type === "billClosure")?.after_data?.amountCents).toBe(10000 - spentCents);
    const changed = { ...saved, budget: { ...saved.budget, expenses: saved.budget.expenses.map((expense: { id: string }) => expense.id === "bill-paid" ? { ...expense, description: "Correction sans réouverture" } : expense) } };
    expect((await request("/api/budget", "PUT", { state: changed, expectedRevision: saved.revision }, auth)).status).toBe(422);
    for (const migration of ["001_online.sql", "002_amount_plans.sql", "003_email_reports.sql", "004_pot_transfers.sql", "005_bill_closures.sql"])
      await pool.query(await readFile(join(process.cwd(), "server/migrations", migration), "utf8"));
    expect((await pool.query("SELECT count(*) FROM budg_audit WHERE entity_type='billClosure'")).rows[0].count).toBe("1");
  });
  it("rouvre une facture après réapprovisionnement du pot sans effacer le crédit ayant financé un transfert antérieur", async () => {
    const auth = await login();
    let source = closeBill(withBills(8000, true), "bill");
    source = savePotTransfer(source, { id: "bill-to-reserve", lineId: "reserve", amountCents: 2000, date: "2026-08-31", note: "Réemploi du surplus" });
    source = await saveBudget(pool, source, 0, editor);
    const closureId = source.budget.billClosures.find((entry) => entry.lineId === "bill")!.id;
    const invalid = { ...source, potSequence: source.potSequence + 1, budget: { ...source.budget, billClosures: source.budget.billClosures.map((entry) => entry.id === closureId ? { ...entry, reopened: { date: "2026-08-31", order: source.potSequence + 1 } } : entry) } };
    expect((await request("/api/budget", "PUT", { state: invalid, expectedRevision: source.revision }, auth)).status).toBe(422);
    const funded = await saveBudget(pool, closeBill(source, "other-bill"), source.revision, editor);
    const reopened = reopenBill(funded, "bill");
    const response = await request("/api/budget", "PUT", { state: reopened, expectedRevision: funded.revision }, auth);
    expect(response.status).toBe(200);
    const saved = (await response.json()).state;
    expect(saved.budget.billClosures).toHaveLength(2);
    expect(saved.budget.billClosures.find((entry: { id: string }) => entry.id === closureId).reopened.order).toBeGreaterThan(saved.budget.potTransfers[0].order);
    expect(potSummary(saved).availableCents).toBe(0);
    expect(accountBalance(saved)).toBe(4000);
    const audit = (await pool.query("SELECT action,before_data,after_data FROM budg_audit WHERE entity_type='billClosure' AND entity_id=$1 ORDER BY id", [closureId])).rows;
    expect(audit.map((entry) => entry.action)).toEqual(["added", "updated"]);
    expect(audit[0].after_data.amountCents).toBe(2000);
    expect(audit[1].before_data.reopened).toBeUndefined();
    expect(audit[1].after_data.reopened).toEqual(saved.budget.billClosures.find((entry: { id: string }) => entry.id === closureId).reopened);
    const rewind = { ...saved, potSequence: saved.potSequence - 1 };
    expect((await request("/api/budget", "PUT", { state: rewind, expectedRevision: saved.revision }, auth)).status).toBe(422);
  });
  it("restaure un instantané V7 conservant les clôtures individuelles et leurs traces", async () => {
    const source = await saveBudget(pool, closeBill(withBills(), "bill"), 0, editor);
    const audit = (await pool.query("SELECT * FROM budg_audit ORDER BY id")).rows;
    const snapshot = parseServerSnapshot(JSON.parse(JSON.stringify({
      format: "BUDG_SERVER_BACKUP", version: 1, kind: "daily", month: "2026-08",
      createdAt: "2026-09-01T00:00:00Z", timeZone: "Europe/Paris", state: source, audit,
    })));
    await pool.query("TRUNCATE budg_state,budg_audit,budg_backups,budg_monthly_archives,budg_email_reports RESTART IDENTITY");
    expect(await restoreDisasterSnapshot(pool, snapshot)).toEqual({ revision: source.revision, auditEvents: audit.length });
    const auth = await login();
    const restored = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(restored).toEqual(source);
    expect(potSummary(restored).availableCents).toBe(2000);
    expect((await pool.query("SELECT count(*) FROM budg_audit WHERE entity_type='billClosure'")).rows[0].count).toBe("1");
  });
  it("lit un budget V6 sans clôturer automatiquement ses factures déjà marquées réglées", async () => {
    const legacy = JSON.parse(JSON.stringify(withBills()));
    legacy.version = 6;
    legacy.revision = 1;
    delete legacy.potSequence;
    for (const month of [legacy.budget, ...legacy.archivedBudgets]) {
      delete month.closedOrder;
      delete month.billClosures;
      for (const transfer of month.potTransfers) delete transfer.order;
    }
    for (const expense of legacy.potExpenses) delete expense.order;
    await pool.query("INSERT INTO budg_state(id,revision,data) VALUES(1,1,$1)", [JSON.stringify(legacy)]);
    const auth = await login();
    const loaded = (await (await request("/api/budget", "GET", undefined, auth)).json()).state;
    expect(loaded.version).toBe(7);
    expect(loaded.budget.billClosures).toEqual([]);
    expect(loaded.budget.lines.find((line: { id: string }) => line.id === "bill").settled).toBe(true);
    expect(potSummary(loaded).availableCents).toBe(0);
    expect((await pool.query("SELECT data->>'version' AS version FROM budg_state")).rows[0].version).toBe("6");
    expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
  });
  it("conserve la clôture et son rapport exact malgré une panne du service d’envoi", async () => {
    const auth = await login();
    let state = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    for (const member of state.members) state = savePayment(state, { id: member.id, memberId: member.id, amountCents: 5000, date: "2026-08-01", note: "Versement reçu" });
    const activeResponse = await request("/api/budget", "PUT", { state, expectedRevision: 0 }, auth);
    const active = (await activeResponse.json()).state;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const delivery = vi.spyOn(reportDelivery, "runReportEmails").mockRejectedValue(new Error("PRIVATE_MAIL_FAILURE"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await request("/api/budget", "PUT", { state: closeMonth(active), expectedRevision: active.revision }, auth);
      expect(response.status).toBe(200);
      const saved = (await response.json()).state;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(saved.budget.status).toBe("CLOSED");
      expect((await (await request("/api/budget", "GET", undefined, auth)).json()).state).toEqual(saved);
      const rows = (await pool.query("SELECT event,month,status,snapshot,source_revision,attempts FROM budg_email_reports")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ event: "closed", month: "2026-08", status: "pending", source_revision: "2", attempts: 0 });
      expect(rows[0].snapshot.state).toEqual(saved);
      expect(rows[0].snapshot.audit).toHaveLength(2);
      expect(delivery).toHaveBeenCalled();
      expect(log.mock.calls.flat().join(" ")).not.toContain("PRIVATE_MAIL_FAILURE");
      expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("2");
      expect((await pool.query("SELECT count(*) FROM budg_backups")).rows[0].count).toBe("1");
    } finally { delivery.mockRestore(); log.mockRestore(); }
  });
  it("annule une clôture dont le rapport n’a pas pu être conservé dans la transaction", async () => {
    const auth = await login();
    let state = saveLine(budget(), { id: "courses", name: "Courses", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    for (const member of state.members) state = savePayment(state, { id: member.id, memberId: member.id, amountCents: 5000, date: "2026-08-01", note: "Versement reçu" });
    const savedResponse = await request("/api/budget", "PUT", { state, expectedRevision: 0 }, auth);
    const saved = (await savedResponse.json()).state;
    await pool.query("CREATE FUNCTION fail_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private report failure'; END $$");
    await pool.query("CREATE TRIGGER fail_report BEFORE INSERT ON budg_email_reports FOR EACH ROW EXECUTE FUNCTION fail_report()");
    try {
      const response = await request("/api/budget", "PUT", { state: closeMonth(saved), expectedRevision: saved.revision }, auth);
      expect(response.status).toBe(503);
      expect((await (await request("/api/budget", "GET", undefined, auth)).json()).state).toEqual(saved);
      expect((await pool.query("SELECT count(*) FROM budg_email_reports")).rows[0].count).toBe("0");
      expect((await pool.query("SELECT count(*) FROM budg_backups")).rows[0].count).toBe("0");
      expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("2");
    } finally { await pool.query("DROP TRIGGER fail_report ON budg_email_reports"); await pool.query("DROP FUNCTION fail_report()"); }
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
    await saveBudget(pool, resetEverything(state), 4, editor, { ...options("2026-09-04T11:00:00Z"), allowHistoryRewrite: true });
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
