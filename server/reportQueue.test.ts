import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppState } from "../src/domain";
import { closeMonth, configureHousehold, initialState, saveExpense, saveLine, savePayment, startNextMonth } from "../src/store";
import { parseServerSnapshot } from "./jobs";
import { captureReportEmails, captureScheduledReport, flushReportEmails, reportMessageId, scheduledReportMonth } from "./reportQueue";

describe("calendrier et identifiants des emails", () => {
  it.each([
    ["2026-01-01T10:59:59Z", null],
    ["2026-01-01T11:00:00Z", "2025-12"],
    ["2026-07-01T09:59:59Z", null],
    ["2026-07-01T10:00:00Z", "2026-06"],
    ["2026-11-01T10:59:59Z", null],
    ["2026-11-01T11:00:00Z", "2026-10"],
    ["2026-11-02T00:00:00Z", "2026-10"],
    ["2026-11-30T22:59:59Z", "2026-10"],
    ["2026-12-01T00:00:00Z", null],
  ])("n’envoie pas avant midi Paris et rattrape ensuite : %s", (date, expected) => {
    expect(scheduledReportMonth(new Date(date), "Europe/Paris")).toBe(expected);
  });
  it("utilise un identifiant stable par événement et mois, sans injection d’en-tête", () => {
    expect(reportMessageId("monthly", "2026-08")).toBe("<budg-report-monthly-2026-08@budg.prjski.com>");
    expect(reportMessageId("closed", "2026-08")).not.toBe(reportMessageId("monthly", "2026-08"));
    expect(reportMessageId("monthly", "2026-08", "BUDG.EXAMPLE.COM")).toBe("<budg-report-monthly-2026-08@budg.example.com>");
    for (const domain of ["bad\r\nBcc:x", "<example.com>", "foo..bar", "@example.com", ""]) {
      expect(() => reportMessageId("monthly", "2026-08", domain)).toThrow();
    }
    expect(() => reportMessageId("monthly", "2026-13")).toThrow();
  });
  it("ne contacte même pas la base quand les envois sont désactivés", async () => {
    const connect = vi.fn();
    const send = vi.fn();
    expect(await flushReportEmails({ enabled: false }, { connect } as unknown as Pool, send)).toEqual({
      status: "disabled", sent: [], failed: [], pending: 0,
    });
    expect(connect).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("ne relit ni l’état ni le journal quand le rapport mensuel a déjà été capturé", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "already-captured" }] });
    expect(await captureScheduledReport({ query } as unknown as PoolClient, {
      now: new Date("2026-09-15T06:00:00Z"), timeZone: "Europe/Paris",
    })).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("FROM budg_email_reports");
    expect(query.mock.calls[0][1]).toEqual(["2026-08"]);
  });
});

function prepared(month = "2026-08", revision = 1): AppState {
  let state = configureHousehold(initialState(month), ["Camille", "Alex"], [300000, 200000], month);
  state = { ...state, revision, budget: { ...state.budget, lines: [] } };
  state = saveLine(state, { id: "courses", name: "Courses", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
  state = savePayment(state, { id: "camille-payment", memberId: "jean", amountCents: 5000, date: `${month}-01`, note: "Versement reçu" });
  state = savePayment(state, { id: "alex-payment", memberId: "miruna", amountCents: 5000, date: `${month}-01`, note: "Versement reçu" });
  return saveExpense(state, { id: "groceries", lineId: "courses", amountCents: 1000, date: `${month}-02`, description: "Achat payé" }, false);
}

const testUrl = process.env.TEST_DATABASE_URL;
describe.runIf(Boolean(testUrl))("file durable des rapports sur PostgreSQL", () => {
  const schema = `email_reports_${randomUUID().replaceAll("-", "")}`;
  const noon = new Date("2026-09-01T10:00:00Z");
  let admin: Pool, pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: testUrl });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: testUrl, options: `-c search_path=${schema}`, max: 6 });
    for (const migration of ["001_online.sql", "002_amount_plans.sql", "003_email_reports.sql", "004_pot_transfers.sql", "005_bill_closures.sql"])
      await pool.query(await readFile(join(process.cwd(), "server/migrations", migration), "utf8"));
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE budg_email_reports,budg_state,budg_audit,budg_monthly_archives RESTART IDENTITY");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  async function transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async function save(state: AppState) {
    await pool.query("INSERT INTO budg_state(id,revision,data) VALUES(1,$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET revision=$1,data=$2::jsonb", [state.revision, JSON.stringify(state)]);
  }
  async function queueClosed() {
    const before = prepared(), after = { ...closeMonth(before), revision: 2 };
    await save(after);
    await transaction((client) => captureReportEmails(client, before, after, { now: noon }));
    return { before, after };
  }

  it("garde exactement la clôture et ne réémet ni déplacement d’archive ni correction ultérieure", async () => {
    const { before, after } = await queueClosed();
    const first = (await pool.query("SELECT * FROM budg_email_reports")).rows[0];
    expect(first.event).toBe("closed");
    expect(first.source_revision).toBe("2");
    expect(parseServerSnapshot(first.snapshot).state).toEqual(after);
    const next = { ...startNextMonth(after), revision: 3 };
    expect(await transaction((client) => captureReportEmails(client, after, next, { now: new Date("2026-09-02T10:00:00Z") }))).toEqual([]);
    expect(await transaction((client) => captureReportEmails(client, before, { ...after, revision: 4 }, { now: new Date("2026-09-03T10:00:00Z") }))).toEqual([]);
    expect((await pool.query("SELECT snapshot FROM budg_email_reports")).rows[0].snapshot).toEqual(first.snapshot);
  });

  it("n’enfile pas un historique importé initialement et annule la file si la transaction est annulée", async () => {
    const before = prepared(), after = { ...closeMonth(before), revision: 2 };
    expect(await transaction((client) => captureReportEmails(client, null, after, { now: noon }))).toEqual([]);
    await expect(transaction(async (client) => {
      expect(await captureReportEmails(client, before, after, { now: noon })).toHaveLength(1);
      throw new Error("Budget rollback");
    })).rejects.toThrow("Budget rollback");
    expect((await pool.query("SELECT count(*) AS total FROM budg_email_reports")).rows[0].total).toBe("0");
  });

  it("capture le mois archivé à midi sans modifier le budget et conserve deux événements distincts", async () => {
    const { after } = await queueClosed();
    const next = { ...startNextMonth(after), revision: 3 };
    await save(next);
    const beforeData = (await pool.query("SELECT revision,data FROM budg_state")).rows[0];
    expect(await transaction((client) => captureScheduledReport(client, { now: new Date("2026-09-01T09:59:59Z"), timeZone: "Europe/Paris" }))).toBeNull();
    expect(await transaction((client) => captureScheduledReport(client, { now: noon, timeZone: "Europe/Paris" }))).toBeTypeOf("string");
    expect(await transaction((client) => captureScheduledReport(client, { now: new Date("2026-09-20T04:00:00Z"), timeZone: "Europe/Paris" }))).toBeNull();
    const rows = (await pool.query("SELECT event,snapshot FROM budg_email_reports ORDER BY event")).rows;
    expect(rows.map((row) => row.event)).toEqual(["closed", "monthly"]);
    expect(rows[1].snapshot.month).toBe("2026-08");
    expect(parseServerSnapshot(rows[1].snapshot).state).toEqual(next);
    expect(rows[0].snapshot.state.revision).toBe(2);
    expect(rows[1].snapshot.state.revision).toBe(3);
    expect((await pool.query("SELECT revision,data FROM budg_state")).rows[0]).toEqual(beforeData);
  });

  it("n’invente pas le mois de préparation absent, même si une ancienne archive privée existe", async () => {
    const now = new Date("2026-11-01T11:00:00Z");
    await save({ ...initialState("2026-11"), configured: true, revision: 1 });
    const old = { format: "BUDG_SERVER_BACKUP", version: 1, kind: "monthly", month: "2026-10", createdAt: now.toISOString(), timeZone: "Europe/Paris", state: { ...initialState("2026-10"), revision: 1 }, audit: [] };
    await pool.query("INSERT INTO budg_monthly_archives(month,snapshot,source_revision) VALUES($1,$2,1)", ["2026-10", JSON.stringify(old)]);
    expect(await transaction((client) => captureScheduledReport(client, { now, timeZone: "Europe/Paris" }))).toBeNull();
    expect((await pool.query("SELECT count(*) AS total FROM budg_email_reports")).rows[0].total).toBe("0");
  });

  it("rattrape midi manqué avec un instantané figé puis réessaie sans fuite d’erreur ni faux succès", async () => {
    await save(prepared());
    const catchup = new Date("2026-09-02T10:00:00Z");
    await transaction((client) => captureScheduledReport(client, { now: catchup, timeZone: "Europe/Paris" }));
    const send = vi.fn().mockRejectedValueOnce(new Error("PRIVATE_SMTP_PASSWORD and email body")).mockResolvedValue(undefined);
    expect(await flushReportEmails({ enabled: true }, pool, send, { now: catchup })).toMatchObject({ failed: ["monthly:2026-08"], sent: [], pending: 1 });
    let row = (await pool.query("SELECT * FROM budg_email_reports")).rows[0];
    expect(row.status).toBe("pending");
    expect(row.sent_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).not.toContain("PRIVATE");
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(catchup.getTime());
    const snapshot = row.snapshot;
    const messageId = row.message_id;
    expect(await flushReportEmails({ enabled: true }, pool, send, { now: catchup })).toMatchObject({ sent: [], failed: [], pending: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    await save({ ...prepared(), revision: 8 });
    expect(await flushReportEmails({ enabled: true }, pool, send, { now: new Date("2026-09-02T11:00:00Z") })).toMatchObject({ sent: ["monthly:2026-08"], failed: [], pending: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]).toBe(messageId);
    expect(send.mock.calls[1][2]).toBe(messageId);
    expect(send.mock.calls[1][0]).toEqual(parseServerSnapshot(snapshot));
    row = (await pool.query("SELECT * FROM budg_email_reports")).rows[0];
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.attempts).toBe(2);
    expect(row.last_error).toBeNull();
    expect(await flushReportEmails({ enabled: true }, pool, send, { now: new Date("2026-09-03T11:00:00Z") })).toMatchObject({ sent: [], pending: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("une seule exécution peut envoyer pendant que la livraison externe est en cours", async () => {
    await queueClosed();
    let releaseSend!: () => void, notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseSend = resolve; });
    const send = vi.fn(async () => { notifyStarted(); await release; });
    const first = flushReportEmails({ enabled: true }, pool, send, { now: noon });
    await started;
    try {
      expect(await flushReportEmails({ enabled: true }, pool, send, { now: noon })).toMatchObject({ status: "already-running", pending: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      // Financial updates remain available while delivery holds only its own lock.
      await transaction(async (client) => {
        await client.query("SET LOCAL lock_timeout='1000ms'");
        await client.query("SELECT pg_advisory_xact_lock($1)", [1112884295]);
      });
    } finally { releaseSend(); }
    expect(await first).toMatchObject({ status: "completed", sent: ["closed:2026-08"], pending: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retient un instantané incohérent sans appeler le transport", async () => {
    await queueClosed();
    await pool.query("UPDATE budg_email_reports SET snapshot=jsonb_set(snapshot,'{state,budget,status}','\"ACTIVE\"'::jsonb)");
    const send = vi.fn();
    expect(await flushReportEmails({ enabled: true }, pool, send, { now: noon })).toMatchObject({ sent: [], failed: ["closed:2026-08"], pending: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("la migration est répétable sans perdre les statuts et instantanés existants", async () => {
    await queueClosed();
    const before = (await pool.query("SELECT * FROM budg_email_reports")).rows;
    await pool.query(await readFile(join(process.cwd(), "server/migrations/003_email_reports.sql"), "utf8"));
    expect((await pool.query("SELECT * FROM budg_email_reports")).rows).toEqual(before);
  });
});
