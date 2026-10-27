import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { validateState, type AppState } from "../src/domain";

export type PublicUser = { id: string; email: string; displayName: string; role: "editor" | "viewer" };
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type AuditEntity = { type: "expense" | "payment" | "potExpense"; month: string; id: string; value: unknown };
export type MonthlyCaptureOptions = { timeZone?: string; now?: Date };
function financialEntities(state: AppState | null): Map<string, AuditEntity> {
  const result = new Map<string, AuditEntity>();
  if (!state) return result;
  const add = (entity: AuditEntity) => result.set(JSON.stringify([entity.type, entity.month, entity.id]), entity);
  for (const month of [state.budget, ...state.archivedBudgets]) {
    for (const value of month.expenses) add({ type: "expense", month: month.id, id: value.id, value });
    for (const value of month.payments) add({ type: "payment", month: month.id, id: value.id, value });
  }
  for (const value of state.potExpenses)
    add({ type: "potExpense", month: value.date.slice(0, 7), id: value.id, value });
  return result;
}
export async function writeAudit(client: Pick<PoolClient, "query">, before: AppState | null, after: AppState, actor: PublicUser) {
  const previous = financialEntities(before), next = financialEntities(after);
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(key), fresh = next.get(key), entity = (fresh || old)!;
    if (JSON.stringify(old?.value) === JSON.stringify(fresh?.value)) continue;
    await client.query(
      `INSERT INTO budg_audit
       (actor_user_id,actor_email,actor_display_name,entity_type,entity_id,entity_month,action,revision,before_data,after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [actor.id, actor.email, actor.displayName, entity.type, entity.id, entity.month,
        old ? (fresh ? "updated" : "deleted") : "added", after.revision,
        old ? JSON.stringify(old.value) : null, fresh ? JSON.stringify(fresh.value) : null],
    );
  }
}

/** Capture a month and its audit inside the financial transaction, independently of disk backups. */
export async function captureMonthlyArchives(
  client: Pick<PoolClient, "query">,
  before: AppState | null,
  after: AppState,
  options: MonthlyCaptureOptions = {},
): Promise<string[]> {
  const timeZone = options.timeZone || "Europe/Paris", now = options.now || new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const calendarMonth = `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
  const oldMonths = new Map(before ? [before.budget, ...before.archivedBudgets].map((month) => [month.id, month]) : []);
  const candidates = [after.budget, ...after.archivedBudgets].filter((month) => {
    const old = oldMonths.get(month.id);
    if (month.status === "CLOSED") return old?.status !== "CLOSED";
    if (month.id >= calendarMonth) return false;
    // New-month activity must not replace an older month's provisional evidence.
    const oldPot = before?.potExpenses.filter((expense) => expense.date.slice(0, 7) === month.id) || [];
    const nextPot = after.potExpenses.filter((expense) => expense.date.slice(0, 7) === month.id);
    return JSON.stringify(old) !== JSON.stringify(month) || JSON.stringify(oldPot) !== JSON.stringify(nextPot);
  });
  if (!candidates.length) return [];
  const audit = (await client.query("SELECT * FROM budg_audit ORDER BY id")).rows;
  const queued: string[] = [];
  for (const month of candidates) {
    const snapshot = {
      format: "BUDG_SERVER_BACKUP", version: 1, kind: "monthly", month: month.id,
      createdAt: now.toISOString(), timeZone, state: after, audit,
    };
    const result = await client.query(
      `INSERT INTO budg_monthly_archives(month,snapshot,source_revision,finalized)
       VALUES ($1,$2::jsonb,$3,$4)
       ON CONFLICT(month) DO UPDATE SET snapshot=EXCLUDED.snapshot,source_revision=EXCLUDED.source_revision,finalized=EXCLUDED.finalized
       WHERE NOT budg_monthly_archives.finalized AND budg_monthly_archives.source_revision < EXCLUDED.source_revision
       RETURNING month`, [month.id, JSON.stringify(snapshot), after.revision, month.status === "CLOSED"],
    );
    if (result.rows[0]) queued.push(month.id);
  }
  return queued;
}

export async function saveBudget(pool: Pool, raw: unknown, expectedRevision: number, actor: PublicUser, options: MonthlyCaptureOptions = {}): Promise<AppState> {
  if (actor.role !== "editor") throw new ApiError(403, "Ce compte dispose d’un accès en lecture seule.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)
    throw new ApiError(422, "Révision de sauvegarde invalide.");
  let next: AppState;
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    next = validateState({ ...raw, revision: expectedRevision + 1 });
  } catch {
    throw new ApiError(422, "Le budget est invalide. Aucune donnée n’a été remplacée.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Also serializes the first write, when no state row exists yet.
    await client.query("SELECT pg_advisory_xact_lock($1)", [1112884295]);
    const current = await client.query("SELECT revision,data FROM budg_state WHERE id=1 FOR UPDATE");
    const row = current.rows[0];
    if (Number(row?.revision || 0) !== expectedRevision)
      throw new ApiError(409, "Le budget a changé sur un autre appareil. Rechargez-le avant de continuer.");
    const before = row ? validateState(row.data) : null;
    if (before) await client.query(
      "INSERT INTO budg_backups(id,revision,data) VALUES ($1,$2,$3::jsonb)",
      [randomUUID(), before.revision, JSON.stringify(before)],
    );
    await client.query(
      `INSERT INTO budg_state(id,revision,data) VALUES (1,$1,$2::jsonb)
       ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now()`,
      [next.revision, JSON.stringify(next)],
    );
    await writeAudit(client, before, next, actor);
    await captureMonthlyArchives(client, before, next, options);
    await client.query(
      `DELETE FROM budg_backups WHERE id IN
       (SELECT id FROM budg_backups ORDER BY revision DESC,created_at DESC,id DESC OFFSET 20)`,
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
