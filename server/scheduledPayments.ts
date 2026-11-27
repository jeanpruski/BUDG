import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { applyDueScheduledPayments } from "../src/scheduledPayments";
import { validateState, type AppState } from "../src/domain";
import { calendarParts } from "./jobs";
import { ApiError, saveBudget, type PublicUser } from "./storage";

type ProcessingConfig = { timeZone: string };
export async function processScheduledPayments(config: ProcessingConfig, pool: Pool, options: { now?: Date } = {}) {
  const now = options.now ?? new Date(), date = calendarParts(now, config.timeZone).date;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = (await pool.query("SELECT data FROM budg_state WHERE id=1")).rows[0];
    if (!row) return { state: null as AppState | null, processed: 0, closed: 0 };
    const before = validateState(row.data);
    if (before.budget.status !== "ACTIVE") return { state: before as AppState | null, processed: 0, closed: 0 };
    const ids = before.budget.expenses.map((entry) => entry.id);
    const confirmed = ids.length ? (await pool.query(
      "SELECT DISTINCT entity_id FROM budg_audit WHERE entity_type='scheduledExpense' AND action='deleted' AND entity_id=ANY($1::text[])", [ids],
    )).rows.map((entry: { entity_id: string }) => entry.entity_id) : [];
    const next = applyDueScheduledPayments(before, date, confirmed);
    if (isDeepStrictEqual(before, next)) return { state: before as AppState | null, processed: 0, closed: 0 };
    const editor = (await pool.query("SELECT id,email FROM budg_users WHERE role='editor' AND enabled=true")).rows[0];
    if (!editor) return { state: before as AppState | null, processed: 0, closed: 0 };
    const actor: PublicUser = { id: editor.id, email: editor.email, displayName: "BUDG — automatique", role: "editor" };
    try {
      // The existing financial lock and revision check serialize polling, Cron and user writes.
      const state = await saveBudget(pool, next, before.revision, actor, { timeZone: config.timeZone, now });
      return { state: state as AppState | null,
        processed: before.scheduledExpenses.length - state.scheduledExpenses.length,
        closed: state.budget.billClosures.length - before.budget.billClosures.length };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) continue;
      throw error;
    }
  }
  throw new ApiError(409, "Le budget a changé pendant le traitement automatique. Une prochaine actualisation réessaiera.");
}
