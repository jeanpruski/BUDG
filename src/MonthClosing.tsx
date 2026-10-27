import { Budget, budgetSummary, euro } from "./domain";
import type { Actions } from "./screens";

export function MonthClosing({
  budget,
  actions,
  readOnly = false,
}: {
  budget: Budget;
  actions: Actions;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  const summary = budgetSummary(budget);
  const closed = budget.status === "CLOSED";
  return (
    <div className="panel closing-panel">
      <div>
        <h2>{closed ? "Mois clôturé" : "Terminer le mois"}</h2>
        <p>
          {closed
            ? "Le surplus reste dans votre pot commun. Vous pouvez préparer le mois suivant."
            : `${summary.unpaidBills.length} facture(s) à confirmer · ${euro(summary.reservedCents)} à conserver dans les réserves`}
        </p>
      </div>
      <button className="primary" onClick={closed ? actions.next : actions.close}>
        {closed ? "Préparer le mois suivant" : "Vérifier et clôturer"}
      </button>
    </div>
  );
}
