import { CalendarClock, Pencil, Trash2 } from "lucide-react";
import { Budget, ScheduledExpense, euro, monthLabel, today } from "./domain";
import type { Actions } from "./screens";
import { displayDate } from "./ui";
import "./scheduled-expenses.css";

export function ScheduledExpenses({ budget, payments, actions, readOnly = false }: {
  budget: Budget; payments: ScheduledExpense[]; actions: Actions; readOnly?: boolean;
}) {
  if (!payments.length) return null;
  const editable = !readOnly && budget.status === "ACTIVE";
  return <section className="scheduled-payments" aria-label="Paiements prévus">
    <h3><CalendarClock size={16} aria-hidden="true" />Paiements prévus <span>{payments.length}</span></h3>
    <p>Ces sommes seront débitées automatiquement dans BUDG à la date prévue. Une facture sera clôturée après son dernier paiement prévu, une fois son financement complet.</p>
    <ul>{[...payments].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((payment) => <li key={payment.id}>
      <div className="scheduled-payment-heading"><div><strong>{payment.description || "Paiement à venir"}</strong><time dateTime={payment.date}>{displayDate(payment.date)}</time></div><b>{euro(payment.amountCents)}</b></div>
      <span className={`badge ${payment.date <= today() ? "amber" : "blue"}`}>{payment.date <= today() ? "À traiter" : "Prévu"}</span>
      {payment.month !== budget.id && <small>Pour {monthLabel(payment.month)}</small>}
      {editable && <div className="scheduled-payment-actions">
        {payment.month === budget.id && actions.scheduledExpense && <button type="button" className="secondary" onClick={() => actions.scheduledExpense?.(payment, true)} aria-label={`Confirmer le débit ${payment.description || "prévu"} du ${displayDate(payment.date)}`}>Confirmer le débit</button>}
        {actions.scheduledExpense && <button type="button" className="icon-button" aria-label={`Modifier le paiement prévu du ${displayDate(payment.date)}`} onClick={() => actions.scheduledExpense?.(payment)}><Pencil size={15} aria-hidden="true" /></button>}
        {actions.removeScheduledExpense && <button type="button" className="icon-button danger" aria-label={`Annuler le paiement prévu du ${displayDate(payment.date)}`} onClick={() => actions.removeScheduledExpense?.(payment.id)}><Trash2 size={15} aria-hidden="true" /></button>}
      </div>}
    </li>)}</ul>
  </section>;
}
