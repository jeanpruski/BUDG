import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Budget, BudgetLine, euro } from "./domain";
import type { Actions } from "./screens";
import { displayDate } from "./ui";
import "./envelope-expenses.css";

export function EnvelopeExpenses({ budget, line, actions, readOnly = false }: {
  budget: Budget;
  line: BudgetLine;
  actions: Actions;
  readOnly?: boolean;
}) {
  const expenses = budget.expenses
    .filter((expense) => expense.lineId === line.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const editable = !readOnly && budget.status === "ACTIVE";

  return (
    <details className="envelope-expenses">
      <summary aria-label={`Voir les dépenses · ${line.name} (${expenses.length})`}>
        <span>Voir les dépenses</span>
        <span className="envelope-expense-count">{expenses.length}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      {expenses.length ? (
        <ul className="envelope-expense-list" aria-label={`Dépenses de ${line.name}`} tabIndex={0}>
          {expenses.map((expense) => {
            const description = expense.description || line.name;
            const label = `${description} du ${displayDate(expense.date)}`;
            return (
              <li className="envelope-expense" key={expense.id}>
                <div className="envelope-expense-description">
                  <span>{description}</span>
                  <time dateTime={expense.date}>{displayDate(expense.date)}</time>
                </div>
                <strong>{euro(expense.amountCents)}</strong>
                {editable && (
                  <div className="envelope-expense-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Modifier la dépense ${label}`}
                      onClick={() => actions.expense(line.id, expense)}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Supprimer la dépense ${label}`}
                      onClick={() => actions.removeExpense(expense.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="envelope-expenses-empty">Aucune dépense enregistrée dans cette enveloppe.</p>
      )}
    </details>
  );
}
