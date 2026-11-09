import { accountBalance, AppState, budgetSummary } from "./domain";
import { monthlyReserveProvisions } from "./reserveProvisions";

type Category = {
  key: "housing" | "daily" | "pot";
  label: string;
  cents: number;
};

/** Summarize recorded spending without treating plans or reserves as payments. */
export function monthOverview(state: AppState) {
  const summary = budgetSummary(state.budget);
  const spentByGroup = { HOUSING: 0, DAILY_LIFE: 0 };
  for (const line of summary.lines) {
    spentByGroup[line.expenseGroup] += line.spent;
  }
  const potSpentCents = state.potExpenses.reduce(
    (total, expense) =>
      expense.date.slice(0, 7) === state.budget.id
        ? total + expense.amountCents
        : total,
    0,
  );
  const categories: Category[] = [
    { key: "housing", label: "Appartement", cents: spentByGroup.HOUSING },
    { key: "daily", label: "Vie quotidienne", cents: spentByGroup.DAILY_LIFE },
    { key: "pot", label: "Achats du pot commun", cents: potSpentCents },
  ];
  const reserveProvisions = monthlyReserveProvisions(summary);
  // For this chart, use personal carry-over before this month's provision.
  // Pot funding never creates a monthly provision; spent money stays in spending.
  const retainedReserveCents = reserveProvisions.lines.reduce((total, provision) => {
    const line = summary.lines.find((entry) => entry.id === provision.id)!;
    return total + Math.min(provision.fundedCents,
      Math.max(0, line.opening - line.openingPotCents + provision.fundedCents - line.spent));
  }, 0);
  return {
    spentCents: categories.reduce((total, category) => total + category.cents, 0),
    accountBalanceCents: accountBalance(state),
    missingCents: summary.missingCents,
    reserveProvisions,
    retainedReserveCents,
    categories,
  };
}
