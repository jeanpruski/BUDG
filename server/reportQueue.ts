import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { monthSchema, validateState, type AppState } from "../src/domain";
import type { ServerSnapshot } from "./jobs";

export type ReportEvent = "monthly" | "closed";
export type ReportCaptureOptions = { now?: Date; timeZone?: string; messageIdDomain?: string };
export type ReportEmailConfig = { enabled: boolean };
export type ReportSender = (snapshot: ServerSnapshot, event: ReportEvent, messageId: string) => Promise<void>;
export type ReportFlushResult = {
  status: "disabled" | "already-running" | "completed";
  sent: string[];
  failed: string[];
  pending: number;
};
type DatabaseClient = Pick<PoolClient, "query">;
const financialLock = 1112884295;
const deliveryLock = 904198212;

/** The hourly job catches up a missed noon until the end of the same calendar month. */
export function scheduledReportMonth(now: Date, timeZone = "Europe/Paris"): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (name: string) => parts.find((part) => part.type === name)!.value;
  if (Number(get("day")) === 1 && Number(get("hour")) < 12) return null;
  const year = Number(get("year")), month = Number(get("month"));
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
}

export function reportMessageId(event: ReportEvent, month: string, domain = "budg.prjski.com"): string {
  monthSchema.parse(month);
  if (event !== "monthly" && event !== "closed") throw new Error("Événement de rapport invalide.");
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) || domain.includes(".."))
    throw new Error("Domaine de rapport invalide.");
  return `<budg-report-${event}-${month}@${domain.toLowerCase()}>`;
}

function snapshotFor(state: AppState, audit: ServerSnapshot["audit"], month: string, options: ReportCaptureOptions): ServerSnapshot {
  const now = options.now ?? new Date(), timeZone = options.timeZone ?? "Europe/Paris";
  new Intl.DateTimeFormat("fr-FR", { timeZone }).format(now);
  return {
    format: "BUDG_SERVER_BACKUP", version: 1, kind: "monthly", month,
    createdAt: now.toISOString(), timeZone, state, audit,
  };
}

async function enqueue(client: DatabaseClient, snapshot: ServerSnapshot, event: ReportEvent, options: ReportCaptureOptions): Promise<string | null> {
  const now = options.now ?? new Date();
  const row = (await client.query(
    `INSERT INTO budg_email_reports(id,event,month,snapshot,source_revision,message_id,next_attempt_at,created_at)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$7)
     ON CONFLICT(event,month) DO NOTHING RETURNING id`,
    [randomUUID(), event, snapshot.month, JSON.stringify(snapshot), snapshot.state.revision,
      reportMessageId(event, snapshot.month, options.messageIdDomain), now],
  )).rows[0];
  return row?.id ?? null;
}

/** Must run inside the same transaction as the budget and its audit. Never sends mail. */
export async function captureReportEmails(
  client: DatabaseClient,
  before: AppState | null,
  after: AppState,
  options: ReportCaptureOptions = {},
): Promise<string[]> {
  if (!before) return [];
  const old = new Map([before.budget, ...before.archivedBudgets].map((budget) => [budget.id, budget]));
  const closed = [after.budget, ...after.archivedBudgets].filter((budget) =>
    budget.status === "CLOSED" && old.get(budget.id)?.status === "ACTIVE",
  );
  if (!closed.length) return [];
  const checked = validateState(after);
  const audit = (await client.query("SELECT * FROM budg_audit ORDER BY id")).rows as ServerSnapshot["audit"];
  const queued: string[] = [];
  for (const budget of closed) {
    const id = await enqueue(client, snapshotFor(checked, audit, budget.id, options), "closed", options);
    if (id) queued.push(id);
  }
  return queued;
}

/** The caller owns BEGIN/COMMIT; the financial lock keeps state and audit consistent. */
export async function captureScheduledReport(
  client: DatabaseClient,
  options: ReportCaptureOptions & { now: Date; timeZone: string },
): Promise<string | null> {
  const month = scheduledReportMonth(options.now, options.timeZone);
  if (!month) return null;
  const existing = (await client.query(
    "SELECT id FROM budg_email_reports WHERE event='monthly' AND month=$1", [month],
  )).rows[0];
  if (existing) return null;
  await client.query("SELECT pg_advisory_xact_lock($1)", [financialLock]);
  const saved = (await client.query("SELECT data FROM budg_state WHERE id=1")).rows[0];
  if (!saved) return null;
  const state = validateState(saved.data);
  if (!state.configured || ![state.budget, ...state.archivedBudgets].some((budget) => budget.id === month)) return null;
  const audit = (await client.query("SELECT * FROM budg_audit ORDER BY id")).rows as ServerSnapshot["audit"];
  return enqueue(client, snapshotFor(state, audit, month, options), "monthly", options);
}

function checkedSnapshot(raw: unknown, month: string, revision: string | number, event: ReportEvent): ServerSnapshot {
  if (!raw || typeof raw !== "object") throw new Error("Rapport en attente invalide.");
  const value = raw as ServerSnapshot;
  if (value.format !== "BUDG_SERVER_BACKUP" || value.version !== 1 || value.kind !== "monthly" || value.month !== month || !Array.isArray(value.audit))
    throw new Error("Sauvegarde du rapport invalide.");
  monthSchema.parse(month);
  const state = validateState(value.state);
  const target = [state.budget, ...state.archivedBudgets].find((budget) => budget.id === month);
  if (!target || (event === "closed" && target.status !== "CLOSED") || BigInt(state.revision) !== BigInt(revision))
    throw new Error("Le mois du rapport ne correspond pas à sa sauvegarde.");
  new Intl.DateTimeFormat("fr-FR", { timeZone: value.timeZone }).format(new Date(value.createdAt));
  return { ...value, state };
}

async function pendingCount(client: DatabaseClient): Promise<number> {
  return Number((await client.query("SELECT count(*) AS pending FROM budg_email_reports WHERE status='pending'")).rows[0].pending);
}

/** Session lock spans delivery, without holding the financial transaction or blocking budget edits.
 * A crash after provider acceptance and before the sent update can retry the same Message-ID;
 * SMTP cannot guarantee exactly-once delivery in that window.
 */
export async function flushReportEmails(
  config: ReportEmailConfig,
  pool: Pool,
  send: ReportSender,
  options: { now?: Date; limit?: number } = {},
): Promise<ReportFlushResult> {
  if (!config.enabled) return { status: "disabled", sent: [], failed: [], pending: 0 };
  const limit = options.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limite d’envoi des rapports invalide.");
  const client = await pool.connect();
  let locked = false;
  const result: ReportFlushResult = { status: "completed", sent: [], failed: [], pending: 0 };
  try {
    locked = (await client.query(
      "SELECT pg_try_advisory_lock(hashtext(current_database() || ':' || current_schema()), $1) AS locked", [deliveryLock],
    )).rows[0].locked;
    if (!locked) return { ...result, status: "already-running", pending: await pendingCount(client) };
    for (let count = 0; count < limit; count++) {
      const now = options.now ?? new Date();
      const row = (await client.query(
        `SELECT id,event,month,snapshot,source_revision,message_id,attempts FROM budg_email_reports
         WHERE status='pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at,created_at,id LIMIT 1`, [now],
      )).rows[0];
      if (!row) break;
      const attempt = Number(row.attempts) + 1;
      // Persist an in-flight retry delay before external I/O, including process crashes.
      await client.query(
        "UPDATE budg_email_reports SET attempts=$2,last_attempt_at=$3,next_attempt_at=$4 WHERE id=$1 AND status='pending'",
        [row.id, attempt, now, new Date(now.getTime() + 15 * 60_000)],
      );
      const key = `${row.event}:${row.month}`;
      try {
        if (row.event !== "monthly" && row.event !== "closed") throw new Error("Événement de rapport invalide.");
        const snapshot = checkedSnapshot(row.snapshot, row.month, row.source_revision, row.event);
        if (row.message_id !== reportMessageId(row.event, row.month, row.message_id.split("@")[1]?.replace(/>$/, "")))
          throw new Error("Identifiant du rapport invalide.");
        await send(snapshot, row.event, row.message_id);
        await client.query(
          "UPDATE budg_email_reports SET status='sent',sent_at=$2,last_error=NULL WHERE id=$1 AND status='pending'",
          [row.id, options.now ?? new Date()],
        );
        result.sent.push(key);
      } catch {
        const delay = Math.min(6 * 60, 15 * 2 ** Math.min(attempt - 1, 5));
        await client.query(
          "UPDATE budg_email_reports SET last_error=$2,next_attempt_at=$3 WHERE id=$1 AND status='pending'",
          [row.id, "Envoi du rapport impossible ; nouvelle tentative programmée.", new Date(now.getTime() + delay * 60_000)],
        );
        result.failed.push(key);
      }
    }
    result.pending = await pendingCount(client);
    return result;
  } finally {
    if (locked) await client.query(
      "SELECT pg_advisory_unlock(hashtext(current_database() || ':' || current_schema()), $1)", [deliveryLock],
    ).catch(() => undefined);
    client.release();
  }
}
