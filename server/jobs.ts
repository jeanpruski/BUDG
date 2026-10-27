import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { dateSchema, monthSchema, validateState, type AppState } from "../src/domain";
import { captureMonthlyArchives } from "./storage";

type JobConfig = { backupDir: string; timeZone: string };
type JobMode = "scheduled" | "daily" | "monthly";
const jobLock = 904198211;
const integerId = z.union([
  z.number().int().positive().safe().transform(String),
  z.string().regex(/^[1-9]\d*$/),
]);
const timestamp = z.union([z.date(), z.string()]).transform((value, context) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Date de sauvegarde invalide." });
    return z.NEVER;
  }
  return date.toISOString();
});
const money = z.number().int().positive().max(1_000_000_000);
const baseOperation = z.object({ id: z.string().min(1), amountCents: money, date: dateSchema });
const operationSchemas = {
  expense: baseOperation.extend({ lineId: z.string().min(1), description: z.string().max(200) }),
  payment: baseOperation.extend({ memberId: z.string().min(1), note: z.string().max(200) }),
  potExpense: baseOperation.extend({ description: z.string().min(1).max(200) }),
};
const auditSchema = z.object({
  id: integerId,
  created_at: timestamp,
  actor_user_id: z.string().uuid(),
  actor_email: z.string().min(1),
  actor_display_name: z.string().min(1),
  entity_type: z.enum(["expense", "payment", "potExpense"]),
  entity_id: z.string().min(1),
  entity_month: monthSchema,
  action: z.enum(["added", "updated", "deleted"]),
  revision: integerId,
  before_data: z.record(z.unknown()).nullable(),
  after_data: z.record(z.unknown()).nullable(),
}).superRefine((entry, context) => {
  if (
    (entry.action === "added" && (entry.before_data !== null || entry.after_data === null)) ||
    (entry.action === "updated" && (entry.before_data === null || entry.after_data === null)) ||
    (entry.action === "deleted" && (entry.before_data === null || entry.after_data !== null))
  ) context.addIssue({ code: z.ZodIssueCode.custom, message: "Trace de paiement incohérente." });
  for (const operation of [entry.before_data, entry.after_data]) {
    if (operation === null) continue;
    const result = operationSchemas[entry.entity_type].safeParse(operation);
    if (!result.success || result.data.id !== entry.entity_id || result.data.date.slice(0, 7) !== entry.entity_month)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Opération du journal invalide." });
  }
});
const snapshotSchema = z.object({
  format: z.literal("BUDG_SERVER_BACKUP"),
  version: z.literal(1),
  kind: z.enum(["daily", "monthly"]),
  month: monthSchema,
  createdAt: timestamp,
  timeZone: z.string().min(1),
  state: z.unknown(),
  audit: z.array(auditSchema),
});
export type ServerSnapshot = Omit<z.infer<typeof snapshotSchema>, "state"> & { state: AppState };

export function calendarParts(now: Date, timeZone = "Europe/Paris") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value;
  const month = `${part("year")}-${part("month")}`;
  return { month, date: `${month}-${part("day")}`, day: Number(part("day")), hour: Number(part("hour")) };
}

export function previousMonth(month: string) {
  monthSchema.parse(month);
  const [year, number] = month.split("-").map(Number);
  return `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, "0")}`;
}

export function parseServerSnapshot(raw: unknown): ServerSnapshot {
  const parsed = snapshotSchema.parse(raw);
  const state = validateState(parsed.state);
  new Intl.DateTimeFormat("en-CA", { timeZone: parsed.timeZone }).format(new Date(parsed.createdAt));
  if (state.revision < 1 || ![state.budget, ...state.archivedBudgets].some((budget) => budget.id === parsed.month))
    throw new Error("Le mois de la sauvegarde est absent de son budget.");
  const ids = new Set<string>();
  for (const entry of parsed.audit) {
    if (ids.has(entry.id) || BigInt(entry.revision) > BigInt(state.revision))
      throw new Error("Journal de sauvegarde incohérent.");
    ids.add(entry.id);
  }
  return { ...parsed, state };
}

async function readSnapshot(path: string): Promise<ServerSnapshot | null> {
  try {
    return parseServerSnapshot(JSON.parse(await fs.readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Publish a complete, synced file; a failed write never truncates the previous backup. */
export async function writeBackupFile(path: string, raw: ServerSnapshot, immutable: boolean) {
  const snapshot = parseServerSnapshot(raw);
  const directory = resolve(path, "..");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.budg-${randomUUID()}.tmp`);
  try {
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    if (immutable) {
      try { await fs.link(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readSnapshot(path);
        if (!existing || existing.kind !== "monthly" || existing.month !== snapshot.month)
          throw new Error("Une archive incompatible existe déjà ; elle n’a pas été remplacée.");
        return false;
      }
    } else await fs.rename(temporary, path);
    // Persist the directory entry as well as the file contents on supported filesystems.
    const parent = await fs.open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    return true;
  } finally { await fs.rm(temporary, { force: true }); }
}

export type JobResult = {
  status: "completed" | "outside-midnight" | "already-running" | "no-budget" | "already-saved";
  daily?: string;
  monthly?: string;
  published?: string[];
  warnings?: string[];
};

function snapshotMonth(snapshot: ServerSnapshot) {
  return [snapshot.state.budget, ...snapshot.state.archivedBudgets].find((budget) => budget.id === snapshot.month)!;
}

async function pendingCount(client: Pick<PoolClient, "query">) {
  return Number((await client.query("SELECT count(*) AS pending FROM budg_monthly_archives WHERE published_revision < source_revision")).rows[0].pending);
}

/** Call only while holding the session job lock; each row stays locked until its file is durable. */
async function flushMonthlyLocked(config: JobConfig, client: PoolClient) {
  const published: string[] = [];
  for (;;) {
    await client.query("BEGIN");
    try {
      const row = (await client.query(`SELECT month,snapshot,source_revision,finalized FROM budg_monthly_archives
        WHERE published_revision < source_revision ORDER BY month FOR UPDATE LIMIT 1`)).rows[0];
      if (!row) { await client.query("COMMIT"); break; }
      const snapshot = parseServerSnapshot(row.snapshot);
      if (snapshot.kind !== "monthly" || snapshot.month !== row.month ||
          BigInt(snapshot.state.revision) !== BigInt(row.source_revision) ||
          (snapshotMonth(snapshot).status === "CLOSED") !== row.finalized)
        throw new Error("La copie mensuelle en attente est incohérente ; le fichier précédent est conservé.");
      const path = join(config.backupDir, "monthly", `${snapshot.month}.json`);
      const existing = await readSnapshot(path);
      if (existing && (existing.kind !== "monthly" || existing.month !== snapshot.month))
        throw new Error("Une archive mensuelle incompatible existe ; elle n’a pas été remplacée.");
      if (existing && snapshotMonth(existing).status === "CLOSED") {
        // Legacy final files remain valid. Never replace an already closed financial month.
        if (!isDeepStrictEqual(snapshotMonth(existing), snapshotMonth(snapshot)))
          throw new Error("Une archive clôturée différente existe déjà ; elle reste conservée et la publication attend une vérification.");
      } else if (existing && existing.state.revision >= snapshot.state.revision) {
        // A previous publisher may have completed its rename before its DB commit failed.
        if (existing.state.revision > snapshot.state.revision)
          throw new Error("Le fichier mensuel porte une révision plus récente que la copie en attente ; les deux copies sont conservées pour vérification.");
        if (!isDeepStrictEqual(existing.state, snapshot.state) || !isDeepStrictEqual(existing.audit, snapshot.audit))
          throw new Error("Deux copies mensuelles différentes portent la même révision ; aucune n’a été remplacée.");
      } else await writeBackupFile(path, snapshot, false);
      await client.query("UPDATE budg_monthly_archives SET published_revision=source_revision WHERE month=$1", [snapshot.month]);
      await client.query("COMMIT");
      published.push(path);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  return { status: "completed" as const, published, pending: await pendingCount(client) };
}

/** Retryable file publication, separate from the already committed financial save. */
export async function flushMonthlyArchives(config: JobConfig, pool: Pool) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext(current_database() || ':' || current_schema()), $1) AS locked", [jobLock])).rows[0].locked;
    if (!locked) return { status: "already-running" as const, published: [] as string[], pending: await pendingCount(client) };
    return await flushMonthlyLocked(config, client);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext(current_database() || ':' || current_schema()), $1)", [jobLock]).catch(() => undefined);
    client.release();
  }
}

/** Read-only with respect to the live budget: financial month closure stays manual. */
export async function runJobs(
  config: JobConfig,
  pool: Pool,
  options: { now?: Date; mode?: JobMode } = {},
): Promise<JobResult> {
  const now = options.now ?? new Date();
  const mode = options.mode ?? "scheduled";
  const calendar = calendarParts(now, config.timeZone);
  const client = await pool.connect();
  let locked = false;
  let transaction = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext(current_database() || ':' || current_schema()), $1) AS locked", [jobLock])).rows[0].locked;
    if (!locked) return { status: "already-running" };
    if (mode === "scheduled" && calendar.hour !== 0) {
      const flushed = await flushMonthlyLocked(config, client);
      return { status: flushed.published.length ? "completed" : "outside-midnight", published: flushed.published };
    }
    await client.query("BEGIN");
    transaction = true;
    // Capture under the same lock as financial saves so state and audit describe one revision.
    await client.query("SELECT pg_advisory_xact_lock($1)", [1112884295]);
    const saved = (await client.query("SELECT data FROM budg_state WHERE id = 1")).rows[0];
    if (!saved) {
      await client.query("COMMIT"); transaction = false;
      const flushed = await flushMonthlyLocked(config, client);
      return { status: "no-budget", published: flushed.published };
    }
    const state = validateState(saved.data);
    const monthlyNeeded = mode === "monthly" || (mode === "scheduled" && calendar.day === 1);
    if (monthlyNeeded) await captureMonthlyArchives(client, null, state, { timeZone: config.timeZone, now });
    const audit = (await client.query("SELECT * FROM budg_audit ORDER BY id")).rows;
    await client.query("COMMIT"); transaction = false;
    const base = { format: "BUDG_SERVER_BACKUP" as const, version: 1 as const, createdAt: now.toISOString(), timeZone: config.timeZone, state, audit };
    const dailyPath = join(config.backupDir, "current-month.json");
    const result: JobResult = { status: "completed", published: [] };
    try {
      result.published = (await flushMonthlyLocked(config, client)).published;
    } catch (error) {
      if (mode === "monthly") throw error;
      result.warnings = ["La publication mensuelle reste en attente en base. La sauvegarde quotidienne est effectuée séparément ; le Cron réessaiera la copie mensuelle à l’heure suivante."];
    }
    if (monthlyNeeded) {
      const month = previousMonth(calendar.month);
      const monthlyPath = join(config.backupDir, "monthly", `${month}.json`);
      const sourceHasMonth = [state.budget, ...state.archivedBudgets].some((budget) => budget.id === month);
      let existing: ServerSnapshot | null = null;
      try { existing = await readSnapshot(monthlyPath); }
      catch (error) {
        // A blocked monthly directory must not stop the independent daily backup.
        if (!sourceHasMonth || !result.warnings?.length) throw error;
      }
      if (existing) {
        if (existing.kind !== "monthly" || existing.month !== month)
          throw new Error("Archive mensuelle incompatible ; aucune sauvegarde n’a été remplacée.");
        result.monthly = monthlyPath;
      } else if (!sourceHasMonth) {
        const warning = `Le mois ${month} est absent du budget : aucune archive mensuelle n’a été inventée.`;
        const previousDaily = await readSnapshot(dailyPath);
        if (previousDaily && calendarParts(new Date(previousDaily.createdAt), config.timeZone).month < calendar.month)
          throw new Error(`${warning} La sauvegarde quotidienne précédente est conservée. Vérifiez le budget avant de relancer.`);
        result.warnings = [...(result.warnings || []), warning];
      } else if (!result.warnings?.length) {
        result.warnings = ["Le fichier mensuel est indisponible ; sa version enregistrée en base doit être vérifiée. Le quotidien reste indépendant."];
      }
    }
    if (mode === "monthly") return result;
    const previousDaily = await readSnapshot(dailyPath);
    if (mode === "scheduled" && previousDaily && calendarParts(new Date(previousDaily.createdAt), config.timeZone).date === calendar.date)
      return { ...result, status: "already-saved", daily: dailyPath };
    await writeBackupFile(dailyPath, { ...base, kind: "daily", month: state.budget.id }, false);
    return { ...result, daily: dailyPath };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext(current_database() || ':' || current_schema()), $1)", [jobLock]).catch(() => undefined);
    client.release();
  }
}

/** Disaster recovery only: refuse any populated database and restore state + original traces together. */
export async function restoreDisasterSnapshot(pool: Pool, raw: unknown) {
  const snapshot = parseServerSnapshot(raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("LOCK TABLE budg_state, budg_audit, budg_monthly_archives IN EXCLUSIVE MODE");
    const occupied = (await client.query("SELECT EXISTS(SELECT 1 FROM budg_state) OR EXISTS(SELECT 1 FROM budg_audit) OR EXISTS(SELECT 1 FROM budg_monthly_archives) AS occupied")).rows[0].occupied;
    if (occupied) throw new Error("La restauration après sinistre exige un budget, un journal et des archives mensuelles entièrement vides.");
    await client.query("INSERT INTO budg_state(id, revision, data) VALUES (1, $1, $2)", [snapshot.state.revision, JSON.stringify(snapshot.state)]);
    for (const entry of snapshot.audit) {
      await client.query(`INSERT INTO budg_audit
        (id, created_at, actor_user_id, actor_email, actor_display_name, entity_type, entity_id, entity_month, action, revision, before_data, after_data)
        OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [entry.id, entry.created_at, entry.actor_user_id, entry.actor_email, entry.actor_display_name, entry.entity_type, entry.entity_id, entry.entity_month, entry.action, entry.revision, entry.before_data && JSON.stringify(entry.before_data), entry.after_data && JSON.stringify(entry.after_data)]);
    }
    await client.query("SELECT setval(pg_get_serial_sequence('budg_audit', 'id'), COALESCE((SELECT MAX(id) FROM budg_audit), 1), EXISTS(SELECT 1 FROM budg_audit))");
    await captureMonthlyArchives(client, null, snapshot.state, { timeZone: snapshot.timeZone });
    await client.query("COMMIT");
    return { revision: snapshot.state.revision, auditEvents: snapshot.audit.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
