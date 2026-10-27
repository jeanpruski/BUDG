import { accountBalance, AppState, budgetSummary } from "./domain";

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
  return {
    spentCents: categories.reduce((total, category) => total + category.cents, 0),
    accountBalanceCents: accountBalance(state),
    missingCents: summary.missingCents,
    categories,
  };
}
