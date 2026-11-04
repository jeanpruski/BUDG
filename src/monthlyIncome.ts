import { AppState, amountForMonth, budgetSummary, nextMonth, sharesFor } from "./domain";

export function monthlyIncomePreview(state: AppState, incomes: number[], current: boolean) {
  const members = state.members.map((member, index) => ({
    ...member,
    incomeCents: incomes[index],
  }));
  const expected = Object.fromEntries(members.map((member) => [member.id, 0]));
  const month = current ? state.budget.id : nextMonth(state.budget.id);
  const closedLines = new Set(current ? state.budget.billClosures.filter((closure) => !closure.reopened).map((closure) => closure.lineId) : []);
  const previewShares = (line: AppState["budget"]["lines"][number]) => closedLines.has(line.id)
    ? line.shares
    : sharesFor(amountForMonth(line, month), line.allocationType, members, line.customPercentages);
  for (const line of state.budget.lines) {
    for (const share of previewShares(line)) {
      expected[share.memberId] += share.amountCents;
    }
  }
  const summary = current ? budgetSummary({
    ...state.budget,
    members,
    lines: state.budget.lines.map((line) => ({
      ...line,
      shares: previewShares(line),
    })),
  }) : null;
  return members.map((member) => {
    const balance = summary?.balances.find((balance) => balance.id === member.id);
    const paid = balance?.paid ?? 0;
    return {
      ...member,
      expected: expected[member.id],
      paid,
      remaining: balance?.remaining ?? expected[member.id],
      overpaid: Math.max(0, paid - expected[member.id]),
    };
  });
}
