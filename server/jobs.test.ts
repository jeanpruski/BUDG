import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMonth, configureHousehold, initialState, resetEverything, saveExpense, saveLine, savePayment, startNextMonth } from "../src/store";
import { captureMonthlyArchives, saveBudget, type PublicUser } from "./storage";
import { calendarParts, flushMonthlyArchives, parseServerSnapshot, previousMonth, restoreDisasterSnapshot, runJobs, writeBackupFile, type ServerSnapshot } from "./jobs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

function state(month = "2026-09", revision = 1) {
  return { ...initialState(month), revision };
}
function snapshot(month = "2026-09", revision = 1): ServerSnapshot {
  return {
    format: "BUDG_SERVER_BACKUP", version: 1, kind: "daily", month,
    createdAt: "2026-09-30T22:00:00.000Z", timeZone: "Europe/Paris", state: state(month, revision), audit: [],
  };
}
const audit = (id = "1", entityId = "payment-1") => ({
  id, created_at: "2026-09-29T10:00:00.000Z", actor_user_id: "11111111-1111-4111-8111-111111111111",
  actor_email: "jean@example.com", actor_display_name: "Jean", entity_type: "payment" as const,
  entity_id: entityId, entity_month: "2026-09", action: "added" as const, revision: "1", before_data: null,
  after_data: { id: entityId, memberId: "jean", amountCents: 10000, date: "2026-09-29", note: "Virement" },
});
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), "budg-jobs-")); });
afterEach(async () => {
  vi.mocked(fs.rename).mockClear();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("horaires des sauvegardes", () => {
  it("calcule le mois précédent aux changements d’année", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
  it.each([
    ["2025-12-31T23:00:00Z", "2026-01-01"],
    ["2026-06-30T22:00:00Z", "2026-07-01"],
    ["2026-03-28T23:00:00Z", "2026-03-29"],
    ["2026-03-29T22:00:00Z", "2026-03-30"],
    ["2026-10-24T22:00:00Z", "2026-10-25"],
    ["2026-10-25T23:00:00Z", "2026-10-26"],
  ])("reconnaît minuit Paris pour %s", (date, expected) => {
    expect(calendarParts(new Date(date))).toMatchObject({ date: expected, hour: 0 });
  });
});

describe("fichiers privés et atomiques", () => {
  it("remplace le quotidien et conserve une seule copie", async () => {
    const path = join(directory, "current-month.json");
    await writeBackupFile(path, snapshot(), false);
    await writeBackupFile(path, snapshot("2026-09", 2), false);
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8"))).state.revision).toBe(2);
    expect(await fs.readdir(directory)).toEqual(["current-month.json"]);
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
  });
  it("ne remplace jamais une archive mensuelle existante", async () => {
    const path = join(directory, "monthly", "2026-09.json");
    const old = { ...snapshot(), kind: "monthly" as const };
    expect(await writeBackupFile(path, old, true)).toBe(true);
    const bytes = await fs.readFile(path, "utf8");
    expect(await writeBackupFile(path, { ...old, state: state("2026-09", 2) }, true)).toBe(false);
    expect(await fs.readFile(path, "utf8")).toBe(bytes);
    expect(await fs.readdir(join(directory, "monthly"))).toEqual(["2026-09.json"]);
  });
  it("conserve l’ancienne sauvegarde si la publication échoue", async () => {
    const path = join(directory, "current-month.json");
    await writeBackupFile(path, snapshot(), false);
    const old = await fs.readFile(path, "utf8");
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("Erreur disque simulée"));
    await expect(writeBackupFile(path, snapshot("2026-09", 2), false)).rejects.toThrow("Erreur disque");
    expect(await fs.readFile(path, "utf8")).toBe(old);
    expect(await fs.readdir(directory)).toEqual(["current-month.json"]);
  });
  it("refuse un fichier dont le budget ou le journal est incohérent", () => {
    expect(() => parseServerSnapshot({ ...snapshot(), month: "2026-08" })).toThrow(/absent/);
    expect(() => parseServerSnapshot({ ...snapshot(), audit: [audit(), audit()] })).toThrow(/incohérent/);
    expect(() => parseServerSnapshot({ ...snapshot(), audit: [{ ...audit(), revision: "2" }] })).toThrow(/incohérent/);
    expect(() => parseServerSnapshot({ ...snapshot(), audit: [{ ...audit(), before_data: audit().after_data }] })).toThrow();
  });
});

const testUrl = process.env.TEST_DATABASE_URL;
describe.runIf(Boolean(testUrl))("tâches sur PostgreSQL", () => {
  const schema = `jobs_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  const config = () => ({ backupDir: directory, timeZone: "Europe/Paris" });
  const midnight = new Date("2026-09-30T22:00:00Z");
  beforeAll(async () => {
    admin = new Pool({ connectionString: testUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: testUrl, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE budg_state (id smallint PRIMARY KEY, revision bigint NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE budg_audit (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), actor_user_id uuid NOT NULL, actor_email text NOT NULL, actor_display_name text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, entity_month text NOT NULL, action text NOT NULL, revision bigint NOT NULL, before_data jsonb, after_data jsonb);
      CREATE TABLE budg_backups (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL, data jsonb NOT NULL);
      CREATE TABLE budg_monthly_archives (month text PRIMARY KEY,snapshot jsonb NOT NULL,source_revision bigint NOT NULL,finalized boolean NOT NULL DEFAULT false,published_revision bigint NOT NULL DEFAULT 0,CHECK(published_revision <= source_revision));`);
  });
  beforeEach(async () => { await pool.query("TRUNCATE budg_state, budg_audit, budg_backups, budg_monthly_archives RESTART IDENTITY"); });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  async function save(value = state()) {
    await pool.query("INSERT INTO budg_state(id,revision,data) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET revision=$1,data=$2", [value.revision, JSON.stringify(value)]);
  }
  it("archive le mois précédent avant le quotidien sans changer le budget actif", async () => {
    await save();
    const before = (await pool.query("SELECT * FROM budg_state")).rows;
    const result = await runJobs(config(), pool, { now: midnight });
    expect(result.status).toBe("completed");
    const monthly = parseServerSnapshot(JSON.parse(await fs.readFile(result.monthly!, "utf8")));
    const daily = parseServerSnapshot(JSON.parse(await fs.readFile(result.daily!, "utf8")));
    expect(monthly.month).toBe("2026-09");
    expect(monthly.kind).toBe("monthly");
    expect(daily.kind).toBe("daily");
    expect(daily.state.budget.status).toBe("ACTIVE");
    expect((await pool.query("SELECT * FROM budg_state")).rows).toEqual(before);
    expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
  });
  it("actualise une archive provisoire sans multiplier le quotidien du même jour", async () => {
    await save();
    const first = await runJobs(config(), pool, { now: midnight });
    const monthly = await fs.readFile(first.monthly!, "utf8");
    await save(state("2026-09", 2));
    expect((await runJobs(config(), pool, { now: midnight })).status).toBe("already-saved");
    await runJobs(config(), pool, { now: midnight, mode: "daily" });
    expect(await fs.readFile(first.monthly!, "utf8")).not.toBe(monthly);
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(first.monthly!, "utf8"))).state.revision).toBe(2);
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(first.daily!, "utf8"))).state.revision).toBe(2);
  });
  it("crée l’archive avant toute tentative de remplacer le quotidien", async () => {
    await save();
    const daily = join(directory, "current-month.json");
    await writeBackupFile(daily, { ...snapshot(), createdAt: "2026-09-29T22:00:00Z" }, false);
    const previous = await fs.readFile(daily, "utf8");
    const actualRename = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementationOnce(actualRename.rename).mockRejectedValueOnce(new Error("Disque indisponible"));
    await expect(runJobs(config(), pool, { now: midnight })).rejects.toThrow("Disque");
    expect(await fs.readFile(daily, "utf8")).toBe(previous);
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(join(directory, "monthly", "2026-09.json"), "utf8"))).kind).toBe("monthly");
  });
  it("ne remplace pas le dernier quotidien si le mois à archiver a disparu", async () => {
    const daily = join(directory, "current-month.json");
    await writeBackupFile(daily, { ...snapshot(), createdAt: "2026-09-29T22:00:00Z" }, false);
    const previous = await fs.readFile(daily, "utf8");
    await save(state("2026-10"));
    await expect(runJobs(config(), pool, { now: midnight })).rejects.toThrow(/précédente est conservée/);
    expect(await fs.readFile(daily, "utf8")).toBe(previous);
    await expect(fs.stat(join(directory, "monthly", "2026-09.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("ne crée rien avant la première saisie et accepte une première installation le 1er", async () => {
    expect(await runJobs(config(), pool, { now: midnight })).toMatchObject({ status: "no-budget" });
    expect(await fs.readdir(directory)).toEqual([]);
    await save(state("2026-10"));
    const result = await runJobs(config(), pool, { now: midnight });
    expect(result.warnings).toHaveLength(1);
    expect(result.daily).toBeTruthy();
    expect(result.monthly).toBeUndefined();
  });
  it("empêche deux exécutions concurrentes de multiplier les sauvegardes", async () => {
    await save();
    const results = await Promise.all([runJobs(config(), pool, { now: midnight }), runJobs(config(), pool, { now: midnight })]);
    expect(results.filter((result) => result.status === "completed")).toHaveLength(1);
    expect(["already-running", "already-saved"]).toContain(results.find((result) => result.status !== "completed")!.status);
    expect((await fs.readdir(directory)).sort()).toEqual(["current-month.json", "monthly"]);
    expect(await fs.readdir(join(directory, "monthly"))).toEqual(["2026-09.json"]);
  });
  it("restaure le budget et le journal ensemble, puis refuse un second import destructeur", async () => {
    const source = { ...snapshot(), audit: [audit("7")] };
    expect(await restoreDisasterSnapshot(pool, source)).toEqual({ revision: 1, auditEvents: 1 });
    expect((await pool.query("SELECT data FROM budg_state")).rows[0].data).toEqual(source.state);
    expect((await pool.query("SELECT * FROM budg_audit")).rows[0]).toMatchObject({ id: "7", entity_id: "payment-1", actor_email: "jean@example.com" });
    expect((await pool.query("SELECT nextval(pg_get_serial_sequence('budg_audit','id')) AS id")).rows[0].id).toBe("8");
    await expect(restoreDisasterSnapshot(pool, source)).rejects.toThrow(/entièrement vides/);
    expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("1");
  });
  it("annule aussi l’insertion du budget si la restauration du journal échoue", async () => {
    await pool.query("ALTER TABLE budg_audit ADD CONSTRAINT reject_test CHECK(entity_id <> 'reject')");
    try {
      await expect(restoreDisasterSnapshot(pool, { ...snapshot(), audit: [audit("1", "reject")] })).rejects.toThrow();
      expect((await pool.query("SELECT count(*) FROM budg_state")).rows[0].count).toBe("0");
      expect((await pool.query("SELECT count(*) FROM budg_audit")).rows[0].count).toBe("0");
    } finally { await pool.query("ALTER TABLE budg_audit DROP CONSTRAINT reject_test"); }
  });

  const editor: PublicUser = { id: "11111111-1111-4111-8111-111111111111", email: "jean@example.com", displayName: "Jean", role: "editor" };
  function preparedSeptember() {
    let value = configureHousehold(initialState("2026-09"), ["Jean", "Miruna"], [300000, 200000], "2026-09");
    value = saveLine(value, { id: "vacances", name: "Vacances", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "RESERVE" });
    value = savePayment(value, { id: "jean-pay", memberId: "jean", amountCents: 5000, date: "2026-09-01", note: "Virement" });
    return savePayment(value, { id: "miruna-pay", memberId: "miruna", amountCents: 5000, date: "2026-09-01", note: "Virement" });
  }
  async function beginMonth() {
    const value = await saveBudget(pool, preparedSeptember(), 0, editor, { now: new Date("2026-09-30T10:00:00Z") });
    await runJobs(config(), pool, { now: midnight });
    return value;
  }
  function lateExpense(value: ReturnType<typeof preparedSeptember>) {
    return saveExpense(value, { id: "late-expense", lineId: "vacances", amountCents: 1200, date: "2026-09-29", description: "Acompte saisi le 2" }, false);
  }
  it("conserve les corrections du 2 puis l’état exact de clôture du 3, même après le nouveau mois", async () => {
    const first = await beginMonth();
    const path = join(directory, "monthly", "2026-09.json");
    const dailyPath = join(directory, "current-month.json");
    const firstDaily = await fs.readFile(dailyPath, "utf8");
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8"))).state.revision).toBe(1);
    const corrected = await saveBudget(pool, lateExpense(first), first.revision, editor, { now: new Date("2026-10-02T10:00:00Z") });
    expect(await flushMonthlyArchives(config(), pool)).toMatchObject({ published: [path], pending: 0 });
    const provisional = parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8")));
    expect(provisional.state.budget.expenses[0].amountCents).toBe(1200);
    expect(provisional.state.budget.status).toBe("ACTIVE");
    expect(provisional.audit.at(-1)).toMatchObject({ action: "added", entity_id: "late-expense" });
    const closed = await saveBudget(pool, closeMonth(corrected), corrected.revision, editor, { now: new Date("2026-10-03T10:00:00Z") });
    const next = await saveBudget(pool, startNextMonth(closed), closed.revision, editor, { now: new Date("2026-10-03T10:00:01Z") });
    await flushMonthlyArchives(config(), pool);
    const finalBytes = await fs.readFile(path, "utf8");
    const final = parseServerSnapshot(JSON.parse(finalBytes));
    expect(final.state).toEqual(closed);
    expect(final.state.budget.status).toBe("CLOSED");
    expect(final.state.revision).toBe(3);
    expect(final.createdAt).toBe("2026-10-03T10:00:00.000Z");
    const newMonth = saveLine(next, { id: "courses", name: "Courses", plannedCents: 25000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    await saveBudget(pool, newMonth, next.revision, editor, { now: new Date("2026-10-04T10:00:00Z") });
    expect(await flushMonthlyArchives(config(), pool)).toMatchObject({ published: [], pending: 0 });
    expect(await fs.readFile(path, "utf8")).toBe(finalBytes);
    expect(await fs.readFile(dailyPath, "utf8")).toBe(firstDaily);
    expect((await pool.query("SELECT source_revision,published_revision,finalized FROM budg_monthly_archives WHERE month='2026-09'")).rows[0])
      .toEqual({ source_revision: "3", published_revision: "3", finalized: true });
  });
  it("reprend hors minuit une clôture en attente, même si le budget vivant a été réinitialisé", async () => {
    const first = await beginMonth();
    const path = join(directory, "monthly", "2026-09.json");
    const original = await fs.readFile(path, "utf8");
    const closed = await saveBudget(pool, closeMonth(first), first.revision, editor, { now: new Date("2026-10-03T10:00:00Z") });
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("Publication impossible"));
    await expect(flushMonthlyArchives(config(), pool)).rejects.toThrow("Publication impossible");
    expect(await fs.readFile(path, "utf8")).toBe(original);
    const pending = (await pool.query("SELECT source_revision,published_revision FROM budg_monthly_archives WHERE month='2026-09'")).rows[0];
    expect(pending).toEqual({ source_revision: "2", published_revision: "1" });
    expect((await pool.query("SELECT revision FROM budg_state WHERE id=1")).rows[0].revision).toBe("2");
    await saveBudget(pool, resetEverything(closed), closed.revision, editor, { now: new Date("2026-10-03T10:00:01Z") });
    const result = await runJobs(config(), pool, { now: new Date("2026-10-03T12:00:00Z") });
    expect(result.status).toBe("completed");
    expect(result.daily).toBeUndefined();
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8"))).state).toEqual(closed);
  });
  it("ne remplace pas un fichier plus récent par une publication arrivée en retard", async () => {
    const first = await beginMonth();
    const path = join(directory, "monthly", "2026-09.json");
    const old = parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8")));
    await saveBudget(pool, lateExpense(first), first.revision, editor, { now: new Date("2026-10-02T10:00:00Z") });
    await flushMonthlyArchives(config(), pool);
    const current = await fs.readFile(path, "utf8");
    await pool.query("UPDATE budg_monthly_archives SET snapshot=$1::jsonb,source_revision=1,published_revision=0,finalized=false WHERE month='2026-09'", [JSON.stringify(old)]);
    await expect(flushMonthlyArchives(config(), pool)).rejects.toThrow(/révision plus récente/);
    expect(await fs.readFile(path, "utf8")).toBe(current);
    expect((await pool.query("SELECT source_revision,published_revision FROM budg_monthly_archives WHERE month='2026-09'")).rows[0])
      .toEqual({ source_revision: "1", published_revision: "0" });
  });
  it("ne remplace jamais une clôture en attente par un fichier actif à plus forte révision", async () => {
    const first = await beginMonth();
    const closed = await saveBudget(pool, closeMonth(first), first.revision, editor, { now: new Date("2026-10-03T10:00:00Z") });
    const path = join(directory, "monthly", "2026-09.json");
    const unexpected = { ...snapshot(), kind: "monthly" as const, state: { ...first, revision: 99 } };
    await writeBackupFile(path, unexpected, false);
    const bytes = await fs.readFile(path, "utf8");
    await expect(flushMonthlyArchives(config(), pool)).rejects.toThrow(/révision plus récente/);
    expect(await fs.readFile(path, "utf8")).toBe(bytes);
    const row = (await pool.query("SELECT * FROM budg_monthly_archives WHERE month='2026-09'")).rows[0];
    expect(row.finalized).toBe(true);
    expect(row.source_revision).toBe(String(closed.revision));
    expect(parseServerSnapshot(row.snapshot).state).toEqual(closed);
    expect(row.published_revision).toBe("1");
  });
  it("continue de lire une ancienne archive mensuelle sans métadonnées en base", async () => {
    const closed = { ...closeMonth(preparedSeptember()), revision: 4 };
    const legacy = { ...snapshot(), kind: "monthly" as const, state: closed };
    const path = join(directory, "monthly", "2026-09.json");
    await writeBackupFile(path, legacy, true);
    const old = await fs.readFile(path, "utf8");
    await save(closed);
    await runJobs(config(), pool, { now: midnight });
    expect(await fs.readFile(path, "utf8")).toBe(old);
    expect(parseServerSnapshot(JSON.parse(old)).state).toEqual(closed);
    expect((await pool.query("SELECT finalized,published_revision FROM budg_monthly_archives WHERE month='2026-09'")).rows[0])
      .toEqual({ finalized: true, published_revision: "4" });
  });
  it("rattrape une publication sans créer de quotidien hors minuit", async () => {
    const value = state();
    const client = await pool.connect();
    try { await captureMonthlyArchives(client, null, value, { now: midnight }); }
    finally { client.release(); }
    const result = await runJobs(config(), pool, { now: new Date("2026-10-01T10:00:00Z") });
    expect(result).toMatchObject({ status: "completed", published: [join(directory, "monthly", "2026-09.json")] });
    await expect(fs.stat(join(directory, "current-month.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await runJobs(config(), pool, { now: new Date("2026-10-01T11:00:00Z") })).status).toBe("outside-midnight");
  });
  it("continue le quotidien à minuit si le dossier mensuel est bloqué, puis reprend le mensuel à l’heure suivante", async () => {
    const dailyPath = join(directory, "current-month.json");
    await writeBackupFile(dailyPath, { ...snapshot(), createdAt: "2026-09-29T22:00:00Z" }, false);
    await fs.writeFile(join(directory, "monthly"), "Emplacement bloqué");
    await save(state("2026-09", 2));
    const before = (await pool.query("SELECT * FROM budg_state")).rows;
    const result = await runJobs(config(), pool, { now: midnight });
    expect(result.status).toBe("completed");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/publication mensuelle reste en attente/);
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(dailyPath, "utf8"))).state.revision).toBe(2);
    expect((await pool.query("SELECT source_revision,published_revision FROM budg_monthly_archives WHERE month='2026-09'")).rows[0])
      .toEqual({ source_revision: "2", published_revision: "0" });
    expect((await pool.query("SELECT * FROM budg_state")).rows).toEqual(before);
    const dailyBytes = await fs.readFile(dailyPath, "utf8");
    await fs.rm(join(directory, "monthly"));
    const retry = await runJobs(config(), pool, { now: new Date("2026-10-01T10:00:00Z") });
    expect(retry.status).toBe("completed");
    expect(parseServerSnapshot(JSON.parse(await fs.readFile(join(directory, "monthly", "2026-09.json"), "utf8"))).state.revision).toBe(2);
    expect(await fs.readFile(dailyPath, "utf8")).toBe(dailyBytes);
    expect((await pool.query("SELECT published_revision FROM budg_monthly_archives WHERE month='2026-09'")).rows[0].published_revision).toBe("2");
  });
  it("refuse une restauration de sinistre si une archive en attente doit encore être conservée", async () => {
    const client = await pool.connect();
    try { await captureMonthlyArchives(client, null, state(), { now: midnight }); }
    finally { client.release(); }
    await expect(restoreDisasterSnapshot(pool, snapshot())).rejects.toThrow(/entièrement vides/);
    expect((await pool.query("SELECT count(*) FROM budg_monthly_archives")).rows[0].count).toBe("1");
  });
});
