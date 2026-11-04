import { ChevronDown, Undo2 } from "lucide-react";
import { Budget, BudgetLine, budgetSummary, euro } from "./domain";
import type { Actions } from "./screens";
import { displayDate } from "./ui";
import "./pot-transfers.css";

export function EnvelopePotTransfers({ budget, line, actions, readOnly = false }: {
  budget: Budget;
  line: BudgetLine;
  actions: Actions;
  readOnly?: boolean;
}) {
  const transfers = budget.potTransfers.filter((entry) => entry.lineId === line.id)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (!transfers.length) return null;
  const available = budgetSummary(budget).lines.find((entry) => entry.id === line.id)?.available ?? 0;
  return (
    <details className="envelope-expenses envelope-pot-transfers">
      <summary aria-label={`Transferts du pot · ${line.name} (${transfers.length})`}>
        <span>Transferts du pot</span><span className="envelope-expense-count">{transfers.length}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <ul className="envelope-expense-list" aria-label={`Transferts du pot vers ${line.name}`} tabIndex={0}>
        {transfers.map((transfer) => (
          <li className="envelope-expense" key={transfer.id}>
            <div className="envelope-expense-description">
              <span>{transfer.note || "Depuis le pot commun"}</span>
              <time dateTime={transfer.date}>{displayDate(transfer.date)} · Transfert interne</time>
            </div>
            <strong>+{euro(transfer.amountCents)}</strong>
            {!readOnly && budget.status === "ACTIVE" && !budget.billClosures.some((entry) => entry.lineId === line.id && !entry.reopened) && actions.removePotTransfer && (
              <div className="envelope-expense-actions">
                <button type="button" className="icon-button" disabled={available < transfer.amountCents}
                  title={available < transfer.amountCents ? "Le montant n’est plus entièrement disponible dans cette enveloppe." : "Rendre ce montant au pot commun"}
                  aria-label={`Annuler le transfert du pot de ${euro(transfer.amountCents)} du ${displayDate(transfer.date)} vers ${line.name}`}
                  onClick={() => actions.removePotTransfer?.(transfer.id)}>
                  <Undo2 size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
