import { useId, useState } from "react";
import { AppState, budgetSummary, euro, parseMoney, potSummary, today } from "./domain";
import { Form } from "./ui";
import "./pot-transfers.css";

export function PotTransferForm({ state, lineId, busy, submit }: {
  state: AppState;
  lineId?: string;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const previewId = useId();
  const [selected, setSelected] = useState(lineId ?? state.budget.lines[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const pot = potSummary(state);
  const line = budgetSummary(state.budget).lines.find((entry) => entry.id === selected);
  const month = state.budget.id;
  const endOfMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const maxDate = [today(), `${month}-${endOfMonth}`].sort()[0];
  let cents = 0;
  let error = "";
  if (amount.trim()) {
    try {
      cents = parseMoney(amount);
      if (cents > pot.availableCents) error = "Ce montant dépasse le pot commun disponible.";
    } catch { error = "Saisissez un montant positif avec deux décimales maximum."; }
  }
  const ready = !!line && !error && cents > 0 && state.budget.status === "ACTIVE";
  return (
    <div className="pot-transfer-form">
      <p>Disponible dans le pot commun : <strong>{euro(pot.availableCents)}</strong>.</p>
      <Form busy={busy} canSubmit={ready} submit={submit} button="Transférer vers l’enveloppe">
        <label className="field">
          Enveloppe à alimenter
          <select name="lineId" value={selected} required onChange={(event) => setSelected(event.target.value)}>
            {state.budget.lines.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            Montant à transférer (€)
            <input name="amount" type="text" inputMode="decimal" value={amount} required maxLength={20}
              onChange={(event) => setAmount(event.target.value)} aria-invalid={!!error} aria-describedby={previewId} />
          </label>
          <label className="field">
            Date du transfert
            <input name="date" type="date" defaultValue={maxDate} min={`${month}-01`} max={maxDate} required />
          </label>
        </div>
        <label className="field">
          Note (facultatif)
          <input name="note" type="text" maxLength={200} placeholder="Ex. Renfort ponctuel pour les vacances" />
        </label>
        <div className="pot-transfer-preview" id={previewId} aria-live="polite">
          {error ? <p className="text-red" role="alert">{error}</p> : line && (
            <>
              <dl>
                <div><dt>Pot après transfert</dt><dd>{euro(pot.availableCents - cents)}</dd></div>
                <div><dt>Disponible dans l’enveloppe</dt><dd>{euro(line.available + cents)}</dd></div>
                <div><dt>Provision du mois conservée</dt><dd>{euro(line.plannedCents)}</dd></div>
              </dl>
              <p>L’argent reste sur le compte commun. Ce renfort s’ajoute à la provision du mois.</p>
            </>
          )}
        </div>
      </Form>
    </div>
  );
}
