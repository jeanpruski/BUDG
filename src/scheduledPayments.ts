import { AppState, budgetSummary, dateSchema, envelopeFullyFunded, keepsReserve, today } from "./domain";
import { closeBill, confirmScheduledExpense, finishEnvelopeMonth } from "./store";

/** Only the open budget is posted; opening and closing months stay explicit. */
export function applyDueScheduledPayments(state: AppState, asOfDate = today(), confirmedExpenseIds: readonly string[] = []): AppState {
  dateSchema.parse(asOfDate);
  if (state.budget.status !== "ACTIVE") return state;
  let next = state;
  const due = state.scheduledExpenses.filter((entry) => entry.month === state.budget.id && entry.date <= asOfDate)
    .sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const dueLines = new Set(due.map((entry) => entry.lineId));
  for (const entry of due) next = confirmScheduledExpense(next, entry.id, {
    id: entry.id, lineId: entry.lineId, amountCents: entry.amountCents, date: entry.date, description: entry.description,
  }, true);
  const confirmed = new Set(confirmedExpenseIds);
  const eligibleLines = new Set([...dueLines, ...next.budget.expenses.filter((entry) => confirmed.has(entry.id)).map((entry) => entry.lineId)]);
  const month = state.budget.id;
  const lastDay = new Date(Number(month.slice(0,4)), Number(month.slice(5)), 0).getDate();
  const closingDate = [asOfDate, `${month}-${lastDay}`].sort()[0];
  for (const lineId of eligibleLines) {
    const line = budgetSummary(next.budget).lines.find((entry) => entry.id === lineId);
    if (!line || line.billClosure || next.scheduledExpenses.some((entry) => entry.month === month && entry.lineId === lineId) || !envelopeFullyFunded(line)) continue;
    if (keepsReserve(line)) {
      // Respect a manually reopened monthly reserve; only a new scheduled debit ends it again.
      if (dueLines.has(lineId)) next = finishEnvelopeMonth(next, lineId);
    } else if (line.kind === "FIXED" && line.settled) {
      // A reopened bill has settled=false. An unfunded debit can close after a later contribution.
      next = closeBill(next, lineId, closingDate);
    }
  }
  return next;
}
