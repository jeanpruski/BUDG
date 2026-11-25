import { AppState, advanceSummary, euro, monthLabel } from "./domain";
import { transactionDate } from "./forms";
import { Field, Form } from "./ui";

export function AdvanceUseForm({ state, advanceId, busy, submit }: {
  state: AppState; advanceId: string; busy: boolean; submit: (data: FormData) => void;
}) {
  const payment = advanceSummary(state).payments.find((entry) => entry.id === advanceId);
  if (!payment) return <p>Cette avance n’est plus disponible. Fermez cette fenêtre et rechargez le budget.</p>;
  const person = state.members.find((member) => member.id === payment.memberId)!;
  const closedLines = new Set(state.budget.billClosures.filter((closure) => !closure.reopened).map((closure) => closure.lineId));
  return <Form busy={busy} submit={submit} button="Utiliser cette somme" canSubmit={payment.availableCents > 0}>
    <p>Cette avance de {person.name} réserve encore <strong>{euro(payment.availableCents)}</strong> pour {monthLabel(payment.month)}.</p>
    <p className="hint">Le montant choisi sera disponible ce mois. L’avance réservée diminuera et le complément de {person.name} pour le mois prochain sera recalculé. Cette réaffectation n’est ni une dépense ni un nouveau versement.</p>
    <Field label="Montant à utiliser (€)" name="amount" />
    <label className="field">Où mettre cette somme ?<select name="lineId"><option value="">Pot commun</option>{state.budget.lines.filter((line) => !closedLines.has(line.id)).map((line) => <option value={line.id} key={line.id}>{line.name}</option>)}</select></label>
    <Field label="Date de l’utilisation" name="date" type="date" value={transactionDate(state.budget.id)} min={payment.date} max={transactionDate(state.budget.id)} />
    <Field label="Motif (facultatif)" name="note" required={false} placeholder="Ex. Imprévu ce mois" />
  </Form>;
}
