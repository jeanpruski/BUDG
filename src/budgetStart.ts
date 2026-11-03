import { AppState, amountForMonth, monthLabel, monthSchema, sharesFor, today, validateState } from "./domain";
import { membersForMonth } from "./store";

export function trackingStartBlockReason(state: AppState): string | null {
  if (!state.configured) return "Préparez d’abord votre foyer et vos enveloppes.";
  if (state.budget.status !== "ACTIVE" || state.archivedBudgets.length)
    return "Le suivi a déjà commencé. Les mois suivis doivent être clôturés normalement.";
  if (state.budget.payments.length || state.budget.expenses.length || state.budget.refunds.length || state.potExpenses.length)
    return "Des opérations ont été enregistrées. Elles doivent être conservées dans leur mois d’origine.";
  if (state.budget.closedPotCents || state.budget.lines.some((line) => line.openingShares.some((share) => share.amountCents > 0)))
    return "Un solde ou une réserve existe déjà. Il doit être conservé dans le suivi.";
  return null;
}

/** Move the first, unused budget to its real starting month; never fabricate a closed financial month. */
export function startTrackingAtMonth(state: AppState, month: string): AppState {
  const checked = validateState(state);
  const reason = trackingStartBlockReason(checked);
  if (reason) throw new Error(reason);
  monthSchema.parse(month);
  if (month <= checked.budget.id || month > today().slice(0, 7))
    throw new Error("Choisissez un mois après votre préparation, jusqu’au mois actuel inclus.");
  const members = membersForMonth(checked, month);
  return validateState({
    ...checked,
    budget: {
      ...checked.budget,
      id: month,
      label: monthLabel(month),
      members,
      lines: checked.budget.lines.map((line) => {
        const plannedCents = amountForMonth(line, month);
        return {
          ...line,
          plannedCents,
          shares: sharesFor(plannedCents, line.allocationType, members, line.customPercentages),
          settled: false,
        };
      }),
    },
  });
}
