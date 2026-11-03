import { useState } from "react";
import { AppState, monthLabel, nextMonth, today } from "./domain";
import { trackingStartBlockReason } from "./budgetStart";
import { Form } from "./ui";

export function TrackingStartPanel({ state, open, readOnly = false }: {
  state: AppState;
  open: () => void;
  readOnly?: boolean;
}) {
  const month = today().slice(0, 7);
  if (readOnly || state.budget.id >= month || trackingStartBlockReason(state)) return null;
  return (
    <section className="panel closing-panel tracking-start-panel">
      <div>
        <h2>Votre premier mois de suivi</h2>
        <p>{monthLabel(state.budget.id)} a seulement servi à préparer vos enveloppes ? Gardez vos réglages et commencez le suivi ce mois-ci, sans comptabiliser la préparation.</p>
      </div>
      <button className="secondary" onClick={open}>Démarrer le suivi en {monthLabel(month)}</button>
    </section>
  );
}

export function TrackingStartForm({ state, busy, submit }: {
  state: AppState;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <Form busy={busy} submit={submit} button={`Démarrer le suivi en ${monthLabel(month)}`}>
      <p>Votre préparation de {state.budget.label} sera conservée dans une sauvegarde. Elle ne figurera pas comme un mois de dépenses dans vos bilans.</p>
      <label className="field">
        Premier mois à suivre
        <input type="month" name="startMonth" min={nextMonth(state.budget.id)} max={today().slice(0, 7)} value={month} required onChange={(event) => setMonth(event.target.value)} />
      </label>
      <p className="hint">Vos enveloppes et leurs répartitions sont conservées. Les salaires et les montants programmés pour {monthLabel(month)} seront appliqués. Aucun versement, dépense, surplus ou réserve n’est créé pour les mois de préparation.</p>
      <label className="checkbox">
        <input type="checkbox" required />
        Les mois de préparation ne contiennent aucune opération réelle à conserver.
      </label>
    </Form>
  );
}
