import { useId, useState } from "react";
import {
  BudgetLine,
  amountForMonth,
  euro,
  monthLabel,
  monthSchema,
  nextMonth,
  parseMoney,
} from "./domain";
import { Form } from "./ui";
import "./envelope-amount.css";

type AmountScope = "MONTH" | "FROM_MONTH";

const inputAmount = (amountCents: number) =>
  (amountCents / 100).toFixed(2).replace(".", ",");

export function EnvelopeAmountForm({
  line,
  budgetMonth,
  busy,
  submit,
  remove,
  closedBill = false,
}: {
  line: BudgetLine;
  budgetMonth: string;
  busy: boolean;
  submit: (data: FormData) => void;
  remove: (month: string, scope: AmountScope) => void;
  closedBill?: boolean;
}) {
  const previewId = useId();
  const minimumMonth = closedBill ? nextMonth(budgetMonth) : budgetMonth;
  const [month, setMonth] = useState(minimumMonth);
  const [scope, setScope] = useState<AmountScope>("MONTH");
  const [amount, setAmount] = useState(() => inputAmount(amountForMonth(line, minimumMonth)));
  const plan = line.amountPlan ?? {
    baseCents: line.plannedCents,
    changes: [],
    exceptions: [],
  };
  const habitual = amountForMonth({
    ...line,
    amountPlan: { ...plan, exceptions: [] },
  }, budgetMonth);
  const previewMonths = [budgetMonth, nextMonth(budgetMonth), nextMonth(nextMonth(budgetMonth))];
  let previewLine: BudgetLine | null = null;
  try {
    const amountCents = parseMoney(amount, true);
    if (monthSchema.safeParse(month).success && month >= minimumMonth) {
      previewLine = {
        ...line,
        amountPlan: {
          ...plan,
          changes: scope === "FROM_MONTH"
            ? [...plan.changes.filter((change) => change.fromMonth !== month), { fromMonth: month, amountCents }]
            : plan.changes,
          exceptions: [
            ...plan.exceptions.filter((exception) => exception.month !== month),
            ...(scope === "MONTH" ? [{ month, amountCents }] : []),
          ],
        },
      };
    }
  } catch {
    // Invalid input stays editable; the submit handler reports its validation error.
  }
  const scheduled = [
    ...plan.changes.map((change) => ({ month: change.fromMonth, amountCents: change.amountCents, scope: "FROM_MONTH" as const })),
    ...plan.exceptions.map((exception) => ({ ...exception, scope: "MONTH" as const })),
  ].filter((entry) => entry.month >= minimumMonth)
    .sort((a, b) => a.month.localeCompare(b.month) || a.scope.localeCompare(b.scope));

  return (
    <div className="envelope-amount-form">
      <p>
        Montant habituel : <strong>{euro(habitual)}</strong> par mois.
        Vous pouvez prévoir un montant différent pour un seul mois ou changer le montant habituel.
      </p>
      {closedBill && <p className="hint">Cette facture est clôturée pour le mois en cours. Vous pouvez programmer ses montants pour les mois suivants.</p>}
      <Form busy={busy} submit={submit} button="Enregistrer le montant">
        <div className="form-grid envelope-amount-fields">
          <label className="field">
            Mois concerné
            <input
              type="month"
              name="amountMonth"
              min={minimumMonth}
              value={month}
              required
              onChange={(event) => {
                const selected = event.target.value;
                setMonth(selected);
                if (monthSchema.safeParse(selected).success) {
                  setAmount(inputAmount(amountForMonth(line, selected)));
                }
              }}
            />
          </label>
          <label className="field">
            Montant à financer (€)
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              value={amount}
              required
              maxLength={20}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby={previewId}
            />
          </label>
        </div>
        <label className="field">
          Appliquer ce montant
          <select name="amountScope" value={scope} onChange={(event) => setScope(event.target.value as AmountScope)}>
            <option value="MONTH">Seulement ce mois</option>
            <option value="FROM_MONTH">À partir de ce mois</option>
          </select>
        </label>
        <p className="hint">
          {scope === "MONTH"
            ? "Une exception ne se recopie pas au mois suivant : le montant habituel prévu reprend ensuite."
            : "Le montant habituel change dès ce mois. Les exceptions déjà prévues pour les autres mois sont conservées."}
        </p>
        <div className="envelope-amount-preview" id={previewId} aria-live="polite">
          <h3>Aperçu après enregistrement</h3>
          {previewLine ? (
            <dl>
              {previewMonths.map((previewMonth) => (
                <div key={previewMonth}>
                  <dt>{monthLabel(previewMonth)}</dt>
                  <dd>{euro(amountForMonth(previewLine, previewMonth))}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="hint">Renseignez un mois et un montant valides pour voir l’aperçu.</p>
          )}
        </div>
      </Form>
      {scheduled.length > 0 && (
        <section className="envelope-amount-scheduled" aria-label="Montants déjà programmés">
          <h3>Montants déjà programmés</h3>
          <ul>
            {scheduled.map((entry) => (
              <li key={`${entry.scope}-${entry.month}`}>
                <div>
                  <strong>{euro(entry.amountCents)}</strong>
                  <span>{entry.scope === "MONTH" ? "Seulement " : "À partir de "}{monthLabel(entry.month)}</span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => remove(entry.month, entry.scope)}
                  aria-label={entry.scope === "MONTH"
                    ? `Retirer l’exception de ${monthLabel(entry.month)}`
                    : `Retirer le montant habituel à partir de ${monthLabel(entry.month)}`}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
