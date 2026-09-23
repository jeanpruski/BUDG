import { AllocationFields } from "./AllocationFields";
import { useState } from "react";
import {
  AppState,
  Member,
  BudgetLine,
  Expense,
  Payment,
  budgetSummary,
  euro,
  nextMonth,
  monthLabel,
  today,
} from "./domain";
import { membersForMonth } from "./store";
import { Field, Form } from "./ui";

export function HouseholdForm({
  state,
  busy,
  submit,
}: {
  state: AppState;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const [month, setMonth] = useState(
    state.budget.status === "CLOSED"
      ? nextMonth(state.budget.id)
      : state.budget.id,
  );
  const members = membersForMonth(state, month);
  return (
    <Form
      busy={busy}
      submit={submit}
      button={
        state.configured ? "Enregistrer les revenus" : "Créer notre budget"
      }
    >
      <label className="field">
        {state.configured ? "À partir de quel mois ?" : "Premier mois à gérer"}
        <input
          type="month"
          name="month"
          value={month}
          required
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {members.map((m) => (
        <div className="form-grid" key={`${m.id}-${month}-${m.incomeCents}`}>
          <Field
            label="Prénom"
            name={`name-${m.id}`}
            value={state.configured ? m.name : ""}
          />
          <Field
            label="Salaire mensuel net (€)"
            name={`income-${m.id}`}
            value={m.incomeCents / 100 || ""}
            placeholder="Ex. 2400"
          />
        </div>
      ))}
    </Form>
  );
}
export function LineForm({
  line,
  members,
  busy,
  submit,
}: {
  line?: BudgetLine;
  members: Member[];
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const [group, setGroup] = useState(line?.expenseGroup ?? "DAILY_LIFE");
  const [kind, setKind] = useState(line?.kind ?? "VARIABLE");
  return (
    <Form busy={busy} submit={submit}>
      <Field
        label="Nom de l’enveloppe"
        name="name"
        value={line?.name}
        placeholder="Ex. Courses"
      />
      <label className="field">
        Groupe
        <select
          name="group"
          value={group}
          onChange={(e) =>
            setGroup(e.target.value as BudgetLine["expenseGroup"])
          }
        >
          <option value="HOUSING">Appartement</option>
          <option value="DAILY_LIFE">Vie quotidienne</option>
        </select>
      </label>
      <Field
        label="Montant à financer chaque mois (€)"
        name="amount"
        value={line ? line.plannedCents / 100 : ""}
        placeholder="Ex. 500"
      />
      <AllocationFields
        key={line?.id ?? group}
        members={members}
        line={line}
        defaultType={group === "HOUSING" ? "PRO_RATA" : "FIFTY_FIFTY"}
      />
      <label className="field">
        Fonctionnement
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as BudgetLine["kind"])}
        >
          <option value="FIXED">
            Facture — à régler et confirmer chaque mois
          </option>
          <option value="VARIABLE">
            Dépenses courantes — surplus conservé dans le pot commun
          </option>
          <option value="RESERVE">
            Réserve — solde conservé pour les prochains mois
          </option>
        </select>
      </label>
      <p className="hint">
        {kind === "RESERVE"
          ? "Pour les vacances, taxes annuelles ou projets : l’argent non dépensé reste réservé et suit votre contribution personnelle."
          : kind === "FIXED"
            ? "Pour le prêt, l’électricité ou l’assurance : saisissez le débit réel puis confirmez que la facture est réglée."
            : "Pour les courses ou sorties : chaque achat diminue l’enveloppe. Le solde rejoint le pot commun à la clôture."}
      </p>
      {kind === "FIXED" && (
        <Field
          label="Jour habituel du prélèvement (facultatif)"
          name="dueDay"
          type="number"
          min={1}
          max={31}
          value={line?.dueDay}
          required={false}
        />
      )}
    </Form>
  );
}
function transactionDate(month: string) {
  return today().slice(0, 7) === month ? today() : `${month}-01`;
}
export function ExpenseForm({
  state,
  lineId,
  expense,
  busy,
  submit,
}: {
  state: AppState;
  lineId?: string;
  expense?: Expense;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const [selected, setSelected] = useState(
    expense?.lineId ?? lineId ?? state.budget.lines[0]?.id ?? "",
  );
  const line = budgetSummary(state.budget).lines.find((l) => l.id === selected);
  return (
    <Form busy={busy} submit={submit}>
      <p className="hint">
        Saisissez uniquement une sortie réellement effectuée sur le compte
        commun.
      </p>
      <label className="field">
        Enveloppe
        <select
          name="lineId"
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {state.budget.lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {line && (
        <p className="form-context">
          Disponible financé : <b>{euro(line.available)}</b> · Budget restant :{" "}
          {euro(line.remaining)}
        </p>
      )}
      <div key={selected}>
        <Field
          label="Montant payé (€)"
          name="amount"
          value={
            expense
              ? expense.amountCents / 100
              : line?.kind === "FIXED"
                ? Math.max(0, line.remaining) / 100 || ""
                : ""
          }
          placeholder="Ex. 64,90"
        />
      </div>
      <Field
        label="Date de la dépense"
        name="date"
        type="date"
        value={expense?.date ?? transactionDate(state.budget.id)}
        min={`${state.budget.id}-01`}
        max={monthEnd(state.budget.id)}
      />
      <Field
        label="Description (facultative)"
        name="description"
        value={expense?.description}
        placeholder="Ex. Courses du samedi"
        required={false}
      />
      {line?.kind === "FIXED" && (
        <label className="checkbox" key={`settled-${selected}`}>
          <input
            type="checkbox"
            name="settled"
            defaultChecked={expense ? line.settled : true}
          />
          Cette facture est entièrement réglée pour le mois.
        </label>
      )}
    </Form>
  );
}
function monthEnd(month: string) {
  const [year, m] = month.split("-").map(Number);
  return `${month}-${new Date(year, m, 0).getDate()}`;
}
export function PaymentForm({
  state,
  memberId,
  payment,
  busy,
  submit,
}: {
  state: AppState;
  memberId?: string;
  payment?: Payment;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const [selected, setSelected] = useState(
    payment?.memberId ?? memberId ?? state.members[0].id,
  );
  const balance = budgetSummary(state.budget).balances.find(
    (m) => m.id === selected,
  )!;
  return (
    <Form busy={busy} submit={submit}>
      <p className="hint">
        Enregistrez un virement déjà reçu. Un virement prévu ne finance pas
        encore les enveloppes.
      </p>
      <label className="field">
        Qui a versé ?
        <select
          name="memberId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {state.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="form-context">
        Déjà versé : {euro(balance.paid)} · Encore attendu :{" "}
        <b>{euro(balance.remaining)}</b>
      </p>
      <div key={selected}>
        <Field
          label="Montant reçu (€)"
          name="amount"
          value={
            payment ? payment.amountCents / 100 : balance.remaining / 100 || ""
          }
        />
      </div>
      <Field
        label="Date de réception"
        name="date"
        type="date"
        value={payment?.date ?? transactionDate(state.budget.id)}
        min={`${state.budget.id}-01`}
        max={monthEnd(state.budget.id)}
      />
      <Field
        label="Note (facultative)"
        name="note"
        value={payment?.note}
        required={false}
        placeholder="Ex. Virement du mois"
      />
    </Form>
  );
}

export function MonthlyIncomeForm({
  state,
  busy,
  submit,
}: {
  state: AppState;
  busy: boolean;
  submit: (data: FormData) => void;
}) {
  const month = nextMonth(state.budget.id);
  const planned = membersForMonth(state, month);
  const previous = state.budget.members;
  const hasScheduledChange = planned.some(
    (m, i) => m.incomeCents !== previous[i].incomeCents,
  );
  const [mode, setMode] = useState(hasScheduledChange ? "scheduled" : "same");
  const members = mode === "same" ? previous : planned;
  return (
    <Form
      busy={busy}
      submit={submit}
      button={`Confirmer et ouvrir ${monthLabel(month)}`}
    >
      <p>
        Avant de calculer vos contributions, confirmez vos salaires mensuels
        nets pour {monthLabel(month)}.
      </p>
      <label className="field">
        Vos salaires ce mois-ci
        <select
          name="incomeMode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="same">Identiques au mois précédent</option>
          {hasScheduledChange && (
            <option value="scheduled">
              Utiliser les salaires déjà programmés
            </option>
          )}
          <option value="edit">Saisir les salaires de ce mois</option>
        </select>
      </label>
      {hasScheduledChange && (
        <p className="hint">
          Un changement est déjà programmé pour ce mois. Choisir les salaires
          précédents remplacera ce changement.
        </p>
      )}
      {members.map((m) =>
        mode === "edit" ? (
          <Field
            key={`${mode}-${m.id}`}
            label={`Salaire net de ${m.name} (€)`}
            name={`income-${m.id}`}
            value={m.incomeCents / 100}
          />
        ) : (
          <div className="panel" key={m.id}>
            <strong>{m.name}</strong> · {euro(m.incomeCents)}
            <input
              type="hidden"
              name={`income-${m.id}`}
              value={m.incomeCents / 100}
            />
          </div>
        ),
      )}
      <p className="hint">
        Les enveloppes « Selon vos salaires » seront recalculées. Les
        répartitions à 50/50 ou personnalisées sont conservées. Le mois clôturé
        reste inchangé.
      </p>
    </Form>
  );
}
