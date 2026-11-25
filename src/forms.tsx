import { AllocationFields } from "./AllocationFields";
import { useState } from "react";
import {
  AppState,
  AdvancePayment,
  Member,
  BudgetLine,
  Expense,
  Payment,
  budgetSummary,
  euro,
  nextMonth,
  monthLabel,
  parseMoney,
  today,
} from "./domain";
import { nextMonthForecast } from "./futureBudget";
import { monthlyIncomePreview } from "./monthlyIncome";
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
        label={line ? "Montant à financer ce mois (€)" : "Montant habituel par mois (€)"}
        name="amount"
        value={line ? line.plannedCents / 100 : ""}
        placeholder="Ex. 500"
      />
      {line && (
        <label className="field">
          Appliquer ce montant
          <select name="amountScope" defaultValue="MONTH">
            <option value="MONTH">Seulement ce mois</option>
            <option value="FROM_MONTH">À partir de ce mois</option>
          </select>
          <small>Pour prévoir des montants futurs, utilisez « Montants par mois » sur l’enveloppe.</small>
        </label>
      )}
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
export function transactionDate(month: string) {
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
  const isClosed = (id: string) => state.budget.billClosures.some((closure) => closure.lineId === id && !closure.reopened);
  const [selected, setSelected] = useState(
    expense?.lineId ?? (lineId && !isClosed(lineId) ? lineId : state.budget.lines.find((entry) => !isClosed(entry.id))?.id) ?? "",
  );
  const line = budgetSummary(state.budget).lines.find((l) => l.id === selected);
  return (
    <Form busy={busy} canSubmit={!!line && !isClosed(line.id)} submit={submit}>
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
            <option key={l.id} value={l.id} disabled={isClosed(l.id)}>
              {l.name}{isClosed(l.id) ? " · facture clôturée" : ""}
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
  state, memberId, payment, advance, defaultMonth, busy, submit,
}: {
  state: AppState; memberId?: string; payment?: Payment; advance?: AdvancePayment;
  defaultMonth?: string; busy: boolean; submit: (data: FormData) => void;
}) {
  const [selected, setSelected] = useState(payment?.memberId ?? advance?.memberId ?? memberId ?? state.members[0].id);
  const [month, setMonth] = useState(advance?.month ?? defaultMonth ?? state.budget.id);
  const following = nextMonth(state.budget.id), anticipated = month === following;
  const forecast = nextMonthForecast(state);
  const balance = budgetSummary(state.budget).balances.find((member) => member.id === selected)!;
  const future = forecast.members.find((member) => member.id === selected)!;
  const remaining = anticipated ? future.remainingCents : balance.remaining;
  const fixedMonth = !!payment || !!advance;
  return <Form busy={busy} submit={submit}>
    <p className="hint">{anticipated
      ? `Enregistrez un virement déjà reçu pour ${monthLabel(following)}, quelle que soit la date du mois. Il reste réservé et ne finance pas les enveloppes du mois courant.`
      : "Enregistrez un virement déjà reçu. Un virement prévu ne finance pas encore les enveloppes."}</p>
    <label className="field">À quel mois affecter ce versement ?
      <select name="month" value={month} disabled={fixedMonth} onChange={(event) => setMonth(event.target.value)}>
        <option value={state.budget.id}>Ce mois-ci · {monthLabel(state.budget.id)}</option>
        <option value={following}>Mois prochain · {monthLabel(following)}</option>
      </select>
    </label>
    {fixedMonth && <input type="hidden" name="month" value={month} />}
    <label className="field">Qui a versé ?
      <select name="memberId" value={selected} onChange={(event) => setSelected(event.target.value)}>
        {state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
    </label>
    <p className="form-context">{anticipated ? "Déjà réservé" : "Déjà versé"} : {euro(anticipated ? future.availableCents : balance.paid)} · Encore attendu : <b>{euro(remaining)}</b></p>
    {advance && state.advanceUses.some((use) => use.advanceId === advance.id) && <p className="hint">Une partie de cette avance a déjà été utilisée. Le montant total reçu doit rester au moins égal à la somme utilisée.</p>}
    <div key={`${selected}:${month}`}><Field label="Montant reçu (€)" name="amount" value={payment ? payment.amountCents / 100 : advance ? advance.amountCents / 100 : remaining / 100 || ""} /></div>
    <Field label="Date de réception" name="date" type="date" value={payment?.date ?? advance?.date ?? transactionDate(state.budget.id)} min={`${state.budget.id}-01`} max={transactionDate(state.budget.id)} />
    <Field label="Note (facultative)" name="note" value={payment?.note ?? advance?.note} required={false} placeholder={anticipated ? "Ex. Salaire reçu en avance" : "Ex. Virement du mois"} />
  </Form>;
}

export function MonthlyIncomeForm({
  state,
  busy,
  submit,
  mode = "open",
}: {
  state: AppState;
  busy: boolean;
  submit: (data: FormData) => void;
  mode?: "current" | "schedule" | "open";
}) {
  const current = mode === "current";
  const month = current ? state.budget.id : nextMonth(state.budget.id);
  const members = current ? state.budget.members : membersForMonth(state, month);
  const [values, setValues] = useState(() => members.map((member) => String(member.incomeCents / 100)));
  let preview: ReturnType<typeof monthlyIncomePreview> = [];
  let previewError = "";
  try {
    const incomes = state.members.map((member) => parseMoney(values[members.findIndex((m) => m.id === member.id)], true));
    if (!incomes.some((income) => income > 0)) throw new Error("Renseignez au moins un salaire positif.");
    preview = monthlyIncomePreview(state, incomes, current);
  } catch (error) {
    previewError = error instanceof Error ? error.message : "Vérifiez les salaires saisis.";
  }
  const hasScheduled = !current && state.incomeHistory.some((income) => income.effectiveFrom === month);
  return (
    <Form
      busy={busy}
      submit={submit}
      button={current ? "Enregistrer et recalculer" : mode === "schedule" ? "Enregistrer pour le mois prochain" : `Confirmer et ouvrir ${monthLabel(month)}`}
    >
      <p>
        {current
          ? `Saisissez les salaires nets réellement reçus pour ${monthLabel(month)}, centimes compris.`
          : `Renseignez les salaires nets prévus pour ${monthLabel(month)}. Vous pourrez les corriger une fois les montants exacts connus.`}
      </p>
      {hasScheduled && (
        <p className="hint">
          Les salaires préparés pour ce mois sont préremplis ci-dessous.
        </p>
      )}
      <div className="form-grid">
        {members.map((member, index) => (
          <label className="field" key={member.id}>
            Salaire net de {member.name} (€)
            <input
              name={`income-${member.id}`}
              inputMode="decimal"
              type="text"
              maxLength={20}
              required
              value={values[index]}
              onChange={(event) => setValues(values.map((value, i) => i === index ? event.target.value : value))}
            />
          </label>
        ))}
      </div>
      <div className="form-context income-preview" aria-live="polite" aria-atomic="true">
        <h3>{current ? "Vos contributions recalculées" : "Contributions prévues le mois prochain"}</h3>
        {previewError ? <p>{previewError}</p> : preview.map((member) => (
          <div className="income-preview-member" key={member.id}>
            <strong>{member.name}</strong>
            <dl>
              <div><dt>Contribution prévue</dt><dd>{euro(member.expected)}</dd></div>
              <div><dt>{current ? "Déjà versé" : "Déjà réservé en avance"}</dt><dd>{euro(member.paid)}</dd></div>
              <div><dt>{current ? "Reste à verser" : "Complément à verser"}</dt><dd>{euro(member.remaining)}</dd></div>
            </dl>
            {member.overpaid > 0 && <p className="hint">Les versements déjà enregistrés dépassent cette contribution de {euro(member.overpaid)}. Ils restent pris en compte.</p>}
            {current && member.remaining > Math.max(0, member.expected - member.paid) && <p className="hint">Le reste à verser inclut les dépenses qui dépassent le budget prévu.</p>}
          </div>
        ))}
        {!current && <p className="hint">Estimation à partir des montants des enveloppes prévus pour {monthLabel(month)}.</p>}
      </div>
      <p className="hint">
        Les enveloppes « Selon vos salaires » sont recalculées. Les répartitions à 50/50 ou personnalisées sont conservées.
        {current ? " Vos versements, dépenses et réserves reportées sont conservés." : " Le mois en cours et les mois clôturés sont conservés."}
        {mode === "schedule" && " Cette préparation ne clôture ni n’ouvre de mois."}
      </p>
      <p className="hint">
        Ces salaires serviront aussi de base aux mois suivants, jusqu’à votre prochaine saisie.
      </p>
    </Form>
  );
}
