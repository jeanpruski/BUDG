import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { AdvancePayment, AppState, advanceSummary, euro, monthLabel } from "./domain";
import { nextMonthForecast } from "./futureBudget";
import { displayDate } from "./ui";
import "./future-budget.css";
import "./scheduled-expenses.css";

export function FutureBudgetPanel({ state, readOnly = false, add, edit, use, remove, returnUse }: {
  state: AppState; readOnly?: boolean; add: () => void; edit: (payment: AdvancePayment) => void;
  use: (id: string) => void; remove: (id: string) => void; returnUse: (id: string) => void;
}) {
  const forecast = nextMonthForecast(state);
  const editable = !readOnly && state.budget.status === "ACTIVE";
  const history = state.advancePayments.filter((payment) => payment.month <= state.budget.id);
  function receipt(payment: ReturnType<typeof advanceSummary>["payments"][number], canEdit: boolean) {
    const name = state.members.find((member) => member.id === payment.memberId)!.name;
    return <li className="advance-receipt" key={payment.id}>
      <div className="advance-receipt-heading"><div><strong>{name}</strong><small>Reçu le {displayDate(payment.date)} · pour {monthLabel(payment.month)}</small></div><b>{euro(payment.amountCents)}</b></div>
      {payment.note && <p>{payment.note}</p>}
      <dl className="advance-receipt-totals"><div><dt>Utilisé avant le mois</dt><dd>{euro(payment.usedCents)}</dd></div><div><dt>{canEdit || payment.month > state.budget.id ? "Encore réservé" : "Affecté au mois prévu"}</dt><dd>{euro(payment.availableCents)}</dd></div></dl>
      {canEdit && <div className="advance-receipt-actions">
        {payment.availableCents > 0 && <button type="button" className="secondary" onClick={() => use(payment.id)}>Utiliser une partie</button>}
        <button type="button" className="text-button" aria-label={`Modifier l’avance de ${name} du ${displayDate(payment.date)}`} onClick={() => edit(payment)}><Pencil size={14} aria-hidden="true" />Modifier</button>
        <button type="button" className="text-button danger" disabled={payment.uses.length > 0} aria-label={`Supprimer l’avance de ${name} du ${displayDate(payment.date)}`} onClick={() => remove(payment.id)}><Trash2 size={14} aria-hidden="true" />Supprimer</button>
      </div>}
      {payment.uses.length > 0 && <ul className="advance-uses">{payment.uses.map((entry) => <li key={entry.id}>
        <span>{displayDate(entry.date)} · {entry.note || "Utilisation vers le pot commun"} · <strong>{euro(entry.amountCents)}</strong></span>
        {canEdit && <button type="button" className="text-button" onClick={() => returnUse(entry.id)} aria-label={`Rendre à l’avance les ${euro(entry.amountCents)} utilisés le ${displayDate(entry.date)}`}>Rendre à l’avance</button>}
      </li>)}</ul>}
    </li>;
  }
  return <section className="panel future-budget" aria-labelledby="future-budget-title">
    <header className="future-budget-heading"><div><span className="eyebrow"><CalendarDays size={14} aria-hidden="true" />{monthLabel(forecast.month)}</span><h2 id="future-budget-title">Prévision du mois prochain</h2></div>
      <span className={`badge ${forecast.preparedIncomes ? "green" : ""}`}>{forecast.preparedIncomes ? "Salaires préparés" : "Salaires habituels repris"}</span>
    </header>
    <p className="future-budget-note">{forecast.preparedIncomes ? "D’après les salaires préparés et les montants programmés pour ce mois." : "D’après vos salaires habituels. Vous pouvez préparer les montants exacts dans « Salaires du mois »."} Cette prévision ne modifie pas le mois en cours.</p>
    <div className="future-budget-members">{forecast.members.map((member) => <article key={member.id}>
      <h3>{member.name}</h3><span className="future-budget-contribution">Contribution prévue <strong>{euro(member.expectedCents)}</strong></span>
      <dl><div><dt>Salaire prévu</dt><dd>{euro(member.incomeCents)}</dd></div><div><dt>Avances déjà versées</dt><dd>{euro(member.advanceCents)}</dd></div>
        {member.usedCents > 0 && <div><dt>Dont utilisées ce mois</dt><dd>{euro(member.usedCents)}</dd></div>}
        <div><dt>Encore réservé pour ce mois</dt><dd>{euro(member.availableCents)}</dd></div><div className="future-budget-remaining"><dt>Complément à verser</dt><dd>{euro(member.remainingCents)}</dd></div></dl>
      <div className="future-budget-personal"><span>Reste personnel prévu</span><strong className={member.personalRemainderCents < 0 ? "text-red" : undefined}>{euro(member.personalRemainderCents)}</strong><small>Salaire − avances déjà versées − complément, avant les autres dépenses personnelles.</small></div>
    </article>)}</div>
    <div className="future-budget-totals"><div><span>Budget prévu</span><strong>{euro(forecast.plannedCents)}</strong></div><div><span>À payer ou consommer</span><strong>{euro(forecast.plannedPaymentsCents)}</strong></div><div><span>À garder en réserve</span><strong>{euro(forecast.plannedReservesCents)}</strong></div></div>
    <p className="future-budget-note">Les réserves accumulées restent à part : elles ne réduisent pas la nouvelle provision. Les paiements réels pourront différer de cette prévision.</p>
    <details className="future-budget-lines"><summary>Montants prévus par enveloppe</summary><dl>{forecast.lines.map((line) => <div key={line.id}><dt>{line.name}{line.kind === "RESERVE" && <small>Réserve</small>}</dt><dd>{euro(line.plannedCents)}</dd></div>)}</dl></details>
    {forecast.scheduledExpenses.length > 0 && <details className="future-scheduled-payments"><summary>Paiements déjà annoncés pour ce mois · {euro(forecast.scheduledExpenses.reduce((sum, entry) => sum + entry.amountCents, 0))}</summary><p className="future-budget-note">Ces paiements ne sont pas encore débités et restent à rapprocher des provisions prévues. Ils seront conservés à l’ouverture du mois.</p><ul>{forecast.scheduledExpenses.map((entry) => <li key={entry.id}><span>{displayDate(entry.date)} · {forecast.lines.find((line) => line.id === entry.lineId)?.name}</span><strong>{euro(entry.amountCents)}</strong></li>)}</ul></details>}
    <section className="future-budget-advances" aria-labelledby="future-budget-advances-title"><div className="future-budget-advance-heading"><div><h3 id="future-budget-advances-title">Versements anticipés</h3><p><strong>{euro(forecast.advances.availableCents)}</strong> réservés pour {monthLabel(forecast.month)}</p></div>
      {editable && <button type="button" className="secondary" onClick={add}><Plus size={15} aria-hidden="true" />Versement anticipé</button>}
    </div>
    <p className="future-budget-note">Enregistrez uniquement l’argent déjà reçu, à n’importe quelle date du mois. Il reste séparé du budget courant et du pot commun tant que vous ne choisissez pas de l’utiliser.</p>
    {forecast.advances.payments.length ? <ul className="advance-receipts">{forecast.advances.payments.map((payment) => receipt(payment, editable))}</ul> : <p className="future-budget-empty">Aucun versement anticipé pour ce mois.</p>}
    </section>
    {history.length > 0 && <details className="future-budget-history"><summary>Historique des avances précédentes</summary><ul className="advance-receipts">{history.map((payment) => receipt(advanceSummary(state, payment.month).payments.find((p) => p.id === payment.id)!, false))}</ul></details>}
  </section>;
}
