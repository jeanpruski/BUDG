import { AppState, advanceSummary, amountForMonth, nextMonth, sharesFor } from "./domain";
import { membersForMonth } from "./store";

/** Plans stay separate from actual receipts and never change the current month. */
export function nextMonthForecast(state: AppState) {
  const month = nextMonth(state.budget.id);
  const people = membersForMonth(state, month);
  const advances = advanceSummary(state, month);
  const lines = state.budget.lines.map((line) => {
    const plannedCents = amountForMonth(line, month);
    return { ...line, plannedCents,
      shares: sharesFor(plannedCents, line.allocationType, people, line.customPercentages) };
  });
  const members = people.map((member) => {
    const expectedCents = lines.reduce((sum, line) => sum + line.shares.find((share) => share.memberId === member.id)!.amountCents, 0);
    const payments = advances.payments.filter((payment) => payment.memberId === member.id);
    const advanceCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const usedCents = payments.reduce((sum, payment) => sum + payment.usedCents, 0);
    const availableCents = advanceCents - usedCents;
    const remainingCents = Math.max(0, expectedCents - availableCents);
    return { ...member, expectedCents, advanceCents, usedCents, availableCents, remainingCents,
      personalRemainderCents: member.incomeCents - advanceCents - remainingCents };
  });
  return { month, members, lines, advances,
    scheduledExpenses: state.scheduledExpenses.filter((entry) => entry.month === month),
    preparedIncomes: state.incomeHistory.some((income) => income.effectiveFrom === month),
    plannedCents: lines.reduce((sum, line) => sum + line.plannedCents, 0),
    plannedPaymentsCents: lines.filter((line) => line.kind !== "RESERVE").reduce((sum, line) => sum + line.plannedCents, 0),
    plannedReservesCents: lines.filter((line) => line.kind === "RESERVE").reduce((sum, line) => sum + line.plannedCents, 0),
    remainingCents: members.reduce((sum, member) => sum + member.remainingCents, 0),
  };
}
