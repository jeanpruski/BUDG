import { HeroArt } from "./visuals";
import { EnvelopeCard } from "./EnvelopeCard";
import { activeBillClosure } from "./BillClosing";
import { HistoryJournal } from "./HistoryJournal";
import { useState } from "react";
import {
  ArrowDownLeft,
  Wallet,
  ShoppingBag,
  Sprout,
  House,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  AppState,
  allocationLabel,
  Budget,
  BudgetLine,
  Expense,
  Payment,
  PotExpense,
  PotTransfer,
  potSummary,
  accountBalance,
  budgetSummary,
  envelopeMonthFinished,
  euro,
  today,
} from "./domain";
import { Empty, Metric, displayDate } from "./ui";
export type Actions = {
  expense: (lineId?: string, expense?: Expense) => void;
  payment: (memberId?: string, payment?: Payment) => void;
  line: (line?: BudgetLine) => void;
  amount?: (line: BudgetLine) => void;
  removeLine: (id: string) => void;
  removeExpense: (id: string) => void;
  removePayment: (id: string) => void;
  settle: (id: string, value: boolean) => void;
  close: () => void;
  next: () => void;
  potExpense: (expense?: PotExpense) => void;
  removePotExpense: (id: string) => void;
  potTransfer?: (lineId?: string) => void;
  removePotTransfer?: (id: string) => void;
  finishEnvelopeMonth?: (lineId: string) => void;
  reopenEnvelopeMonth?: (lineId: string) => void;
  closeBill?: (lineId: string) => void;
  reopenBill?: (lineId: string) => void;
};
export { Dashboard } from "./Overview";

export function Members({
  budget,
  actions,
  readOnly = false,
}: {
  budget: Budget;
  actions: Actions;
  readOnly?: boolean;
}) {
  const s = budgetSummary(budget);
  return (
    <div className="members-grid">
      {s.balances.map((m, i) => (
        <section className="panel member-card" key={m.id}>
          <div className="section-head">
            <div className="person-name">
              <span className={`avatar avatar-${i}`}>{m.name.slice(0, 1)}</span>
              <h3>{m.name}</h3>
            </div>
            <span className={`badge ${m.remaining ? "amber" : "green"}`}>
              {!m.remaining && <CheckCircle2 size={11} aria-hidden="true" />}
              {m.remaining ? "Versement attendu" : "À jour"}
            </span>
          </div>
          <progress
            className="member-progress"
            aria-label={`Contribution financée de ${m.name}`}
            value={Math.min(m.paid, m.expected)}
            max={m.expected || 1}
          />
          <dl>
            <div>
              <dt>Part prévue</dt>
              <dd>{euro(m.expected)}</dd>
            </div>
            <div>
              <dt>Déjà versé</dt>
              <dd className="text-green">{euro(m.paid)}</dd>
            </div>
            <div>
              <dt>Encore à verser</dt>
              <dd className={m.remaining ? "text-amber" : ""}>
                {euro(m.remaining)}
              </dd>
            </div>
          </dl>
          <div className="personal-remainder">
            <span>Reste sur son compte personnel</span>
            <strong>{euro(m.incomeCents - m.expected)}</strong>
            <small>
              Salaire {euro(m.incomeCents)} − contribution prévue{" "}
              {euro(m.expected)}
            </small>
          </div>
          {!readOnly && budget.status === "ACTIVE" && (
            <button
              className="secondary full"
              onClick={() => actions.payment(m.id)}
            >
              <Plus size={16} /> Enregistrer un versement
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
export function Envelopes({
  budget,
  actions,
  readOnly = false,
  compact = false,
  potAvailableCents = 0,
}: {
  budget: Budget;
  actions: Actions;
  readOnly?: boolean;
  compact?: boolean;
  potAvailableCents?: number;
}) {
  const summary = budgetSummary(budget),
    closed = budget.status === "CLOSED";
  return (
    <>
      {(["DAILY_LIFE", "HOUSING"] as const).map((group) => (
        <section className="envelope-group" key={group}>
          <div className="group-title">
            <h3>
              <span
                className={`group-icon ${group === "HOUSING" ? "housing" : "daily"}`}
              >
                {group === "HOUSING" ? (
                  <House size={16} />
                ) : (
                  <ShoppingBag size={16} />
                )}
              </span>
              {group === "HOUSING" ? "Appartement" : "Vie quotidienne"}
            </h3>
            <span>Répartition par enveloppe</span>
          </div>
          <div className="envelopes">
            {summary.lines
              .filter((l) => l.expenseGroup === group)
              .sort((a, b) => Number(!!a.billClosure || envelopeMonthFinished(a)) - Number(!!b.billClosure || envelopeMonthFinished(b)))
              .map((line) => <EnvelopeCard key={`${budget.id}:${line.id}`} budget={budget} line={line}
                actions={actions} readOnly={readOnly} compact={compact} potAvailableCents={potAvailableCents} />)}
          </div>
        </section>
      ))}
    </>
  );
}
export function Transactions({
  budget,
  actions,
  readOnly = false,
  mode,
}: {
  budget: Budget;
  actions: Actions;
  readOnly?: boolean;
  mode: "expenses" | "payments";
}) {
  const [search, setSearch] = useState("");
  const [line, setLine] = useState("");
  const expenses = mode === "expenses",
    closed = budget.status === "CLOSED";
  const rows = (expenses ? budget.expenses : budget.payments)
    .filter((e) => {
      const description = "description" in e ? e.description : e.note;
      return (
        (!line || ("lineId" in e ? e.lineId === line : e.memberId === line)) &&
        description.toLocaleLowerCase().includes(search.toLocaleLowerCase())
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>{expenses ? "Dépenses du compte commun" : "Versements reçus"}</h2>
          <p>
            {rows.length} opération(s) ·{" "}
            {euro(rows.reduce((s, e) => s + e.amountCents, 0))}
          </p>
        </div>
        {!readOnly && !closed && (
          <button
            className="primary"
            onClick={() => (expenses ? actions.expense() : actions.payment())}
          >
            <Plus size={17} />
            {expenses ? "Ajouter une dépense" : "Ajouter un versement"}
          </button>
        )}
      </div>
      <div className="filters">
        <input
          aria-label="Rechercher une opération"
          type="search"
          placeholder="Rechercher une description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={expenses ? "Filtrer par enveloppe" : "Filtrer par membre"}
          value={line}
          onChange={(e) => setLine(e.target.value)}
        >
          <option value="">
            {expenses ? "Toutes les enveloppes" : "Tous les membres"}
          </option>
          {(expenses ? budget.lines : budget.members).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      {!rows.length && (
        <Empty>
          Aucune opération. Les montants prévus dans les enveloppes ne sont pas
          des dépenses.
        </Empty>
      )}
      <div className="transactions">
        {rows.map((e) => (
          <div className="transaction" key={e.id}>
            <span className={`transaction-icon ${expenses ? "" : "green"}`}>
              {expenses ? (
                <ArrowUpRight size={19} />
              ) : (
                <ArrowDownLeft size={19} />
              )}
            </span>
            <div>
              <strong>
                {"description" in e
                  ? e.description ||
                    budget.lines.find((l) => l.id === e.lineId)?.name
                  : budget.members.find((m) => m.id === e.memberId)?.name}
              </strong>
              <small>
                {displayDate(e.date)} ·{" "}
                {"lineId" in e
                  ? budget.lines.find((l) => l.id === e.lineId)?.name
                  : e.note || "Vers le compte commun"}
              </small>
            </div>
            <b className={expenses ? "" : "text-green"}>
              {expenses ? "−" : "+"}
              {euro(e.amountCents)}
            </b>
            {!readOnly && !closed && (
              <div className="actions">
                <button
                  className="icon-button"
                  aria-label={`Modifier l’opération du ${displayDate(e.date)}`}
                  onClick={() =>
                    "lineId" in e
                      ? actions.expense(e.lineId, e)
                      : actions.payment(e.memberId, e)
                  }
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Supprimer l’opération du ${displayDate(e.date)}`}
                  onClick={() =>
                    expenses
                      ? actions.removeExpense(e.id)
                      : actions.removePayment(e.id)
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
export function CommonPot({
  state,
  actions,
  readOnly = false,
}: {
  state: AppState;
  actions: Actions;
  readOnly?: boolean;
}) {
  const pot = potSummary(state);
  const currentSummary = budgetSummary(state.budget);
  const entries = [
    ...pot.credits
      .filter((b) => b.closedPotCents > 0)
      .map((b) => ({
        id: "close-" + b.id,
        month: b.id,
        date: b.label,
        description: "Surplus · " + b.label,
        amount: b.closedPotCents,
        order: b.closedOrder,
        expense: undefined as PotExpense | undefined,
        transfer: undefined as PotTransfer | undefined,
      })),
    ...state.potExpenses.map((e) => ({
      id: e.id,
      month: e.date.slice(0, 7),
      date: displayDate(e.date),
      description: e.description,
      amount: -e.amountCents,
      order: e.order,
      expense: e,
      transfer: undefined as PotTransfer | undefined,
    })),
    ...[state.budget, ...state.archivedBudgets].flatMap((budget) => budget.potTransfers.map((transfer) => ({
      id: `transfer-${budget.id}-${transfer.id}`,
      month: budget.id,
      date: displayDate(transfer.date),
      description: `Vers ${budget.lines.find((line) => line.id === transfer.lineId)?.name ?? "une enveloppe"}${transfer.note ? ` · ${transfer.note}` : ""}`,
      amount: -transfer.amountCents,
      order: transfer.order,
      expense: undefined as PotExpense | undefined,
      transfer,
    }))),
    ...pot.billCredits.flatMap((credit) => [
      {
        id: `bill-${credit.month}-${credit.id}`, month: credit.month, date: displayDate(credit.date),
        description: `Surplus de facture · ${credit.lineName}`, amount: credit.amountCents, order: credit.order,
        expense: undefined as PotExpense | undefined, transfer: undefined as PotTransfer | undefined,
      },
      ...(credit.reopened ? [{
        id: `bill-reopen-${credit.month}-${credit.id}`, month: credit.month, date: displayDate(credit.reopened.date),
        description: `Réouverture de facture · ${credit.lineName}`, amount: -credit.amountCents, order: credit.reopened.order,
        expense: undefined as PotExpense | undefined, transfer: undefined as PotTransfer | undefined,
      }] : []),
    ]),
  ].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.month.localeCompare(a.month) || b.id.localeCompare(a.id));
  return (
    <>
      <div className="notice pot-banner">
        <div>
          <span className="eyebrow">
            <Sparkles size={13} />
            POUR VOS ENVIES COMMUNES
          </span>
          <h2>Votre surplus reste à vous deux</h2>
          <p>
            Chacun conserve le reste de son salaire après sa contribution
            mensuelle. À la clôture, ce que vous n’avez pas dépensé rejoint le
            pot commun et reste sur le compte commun. Les réserves affectées,
            comme les vacances, restent séparées.
          </p>
        </div>
        <HeroArt variant="pot" />
      </div>
      <div className="metrics">
        <Metric
          icon={Sprout}
          label="Pot commun disponible"
          value={euro(pot.availableCents)}
          detail="Inclus dans le solde du compte commun"
          tone="green"
        />
        <Metric
          icon={ArrowDownLeft}
          label="Surplus cumulés"
          value={euro(pot.receivedCents)}
          detail="Ajoutés lors des clôtures"
        />
        <Metric
          icon={ShoppingBag}
          label="Achats du pot"
          value={euro(pot.spentCents)}
          detail="Achats déjà effectués"
        />
        <Metric
          icon={Wallet}
          label="Affecté aux enveloppes"
          value={euro(pot.transferredCents + pot.billReopenedCents)}
          detail="Transferts internes depuis le pot"
        />
      </div>
      <section className="panel common-pot-movements">
        <div className="section-head">
          <div>
            <h2>Mouvements du pot commun</h2>
            <p>
              Les opérations sont identifiées « Pot commun ». Une affectation du
              surplus ne crée aucun virement bancaire.
            </p>
          </div>
          {!readOnly && <div className="pot-movement-actions">
          {state.budget.status === "ACTIVE" && actions.potTransfer && <button
            className="secondary"
            disabled={pot.availableCents <= 0 || !state.budget.lines.length}
            onClick={() => actions.potTransfer?.()}
          >
            <ArrowDownLeft size={17} /> Alimenter une enveloppe
          </button>}
          <button
            className="primary"
            disabled={pot.availableCents <= 0}
            onClick={() => actions.potExpense()}
          >
            <Plus size={17} />
            Utiliser le pot commun
          </button></div>}
        </div>
        {!entries.length && (
          <Empty>
            Votre premier surplus apparaîtra ici à la clôture du mois.
          </Empty>
        )}
        <div className="transactions">
          {entries.map((entry) => (
            <div className="transaction" key={entry.id}>
              <span
                className={
                  "transaction-icon " + (entry.amount >= 0 ? "green" : "")
                }
              >
                {entry.amount >= 0 ? (
                  <ArrowDownLeft size={19} />
                ) : (
                  <ArrowUpRight size={19} />
                )}
              </span>
              <div>
                <strong>{entry.description}</strong>
                <small>
                  {entry.date} · <span className="badge green">{entry.transfer ? "Transfert interne" : "Pot commun"}</span>
                </small>
              </div>
              <b className={entry.amount >= 0 ? "text-green" : ""}>
                {entry.amount >= 0 ? "+" : "−"}
                {euro(Math.abs(entry.amount))}
              </b>
              {!readOnly && entry.expense && (
                <div className="actions">
                  <button
                    className="icon-button"
                    aria-label={"Modifier " + entry.description}
                    onClick={() => actions.potExpense(entry.expense)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={"Supprimer " + entry.description}
                    onClick={() => actions.removePotExpense(entry.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
              {!readOnly && entry.transfer && entry.month === state.budget.id && state.budget.status === "ACTIVE" && !activeBillClosure(state.budget, entry.transfer.lineId) && actions.removePotTransfer && (
                <button className="secondary" onClick={() => actions.removePotTransfer?.(entry.transfer!.id)}
                  disabled={(currentSummary.lines.find((line) => line.id === entry.transfer!.lineId)?.available ?? 0) < entry.transfer.amountCents}
                  aria-label={`Annuler le transfert vers ${entry.description.slice(5)}`}>
                  Annuler le transfert
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <p className="hint">
        Le pot ne réduit pas automatiquement vos contributions du mois suivant.
        Une dépense saisie ici ne doit pas être saisie une deuxième fois dans
        une enveloppe.
      </p>
    </>
  );
}
export function History({ state }: { state: AppState }) {
  return (
    <>
      <HistoryJournal state={state} />
      <h2>Bilans mensuels</h2>
      {[state.budget, ...state.archivedBudgets]
        .sort((a, b) => b.id.localeCompare(a.id))
        .map((b) => {
          const s = budgetSummary(b);
          const potExpenses = state.potExpenses.filter(
            (e) => e.date.slice(0, 7) === b.id,
          );
          const potSpent = potExpenses.reduce((n, e) => n + e.amountCents, 0);
          return (
            <details className="panel history-month" key={b.id}>
              <summary>
                <span>{b.label}</span>
                <span
                  className={`badge ${b.status === "CLOSED" ? "green" : ""}`}
                >
                  {b.status === "CLOSED" ? "Clôturé" : "En cours"}
                </span>
                <b>{euro(s.spentCents + potSpent)} dépensés</b>
              </summary>
              <div className="metrics">
                <Metric label="Prévu" value={euro(s.plannedCents)} />
                <Metric
                  label="Versé"
                  value={euro(
                    b.payments.reduce((n, p) => n + p.amountCents, 0),
                  )}
                />
                <Metric
                  label="Dépensé"
                  value={euro(s.spentCents + potSpent)}
                  detail={`${euro(potSpent)} via le pot commun`}
                />
                <Metric label="Réservé" value={euro(s.reservedCents)} />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Enveloppe</th>
                      <th>Prévu</th>
                      <th>Dépensé</th>
                      <th>Règle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td>{euro(l.plannedCents)}</td>
                        <td>{euro(l.spent)}</td>
                        <td>{allocationLabel(l)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Contributions et reste personnel</h3>
              {s.balances.map((m) => (
                <p key={m.id}>
                  {m.name} · salaire {euro(m.incomeCents)} · versé{" "}
                  {euro(m.paid)} · part des dépenses {euro(m.cost)}
                  {` · reste personnel prévu ${euro(m.incomeCents - m.expected)}`}
                </p>
              ))}
              {b.status === "CLOSED" && (
                <p className="notice">
                  <span className="badge green">Pot commun</span> Surplus
                  conservé : <b>{euro(b.closedPotCents)}</b>
                </p>
              )}
              {b.refunds.map((r) => (
                <p key={r.memberId}>
                  Ancien remboursement effectué à{" "}
                  {b.members.find((m) => m.id === r.memberId)?.name} :{" "}
                  {euro(r.amountCents)} le {displayDate(r.paidOn!)}.
                </p>
              ))}
              {potExpenses.length > 0 && (
                <>
                  <h3>Dépenses du pot commun</h3>
                  {potExpenses.map((e) => (
                    <p key={e.id}>
                      {displayDate(e.date)} · {e.description} ·{" "}
                      {euro(e.amountCents)}{" "}
                      <span className="badge green">Pot commun</span>
                    </p>
                  ))}
                </>
              )}
              {b.billClosures.length > 0 && (
                <>
                  <h3>Clôtures de factures</h3>
                  {b.billClosures.map((closure) => <p key={closure.id}>
                    {displayDate(closure.date)} · {b.lines.find((line) => line.id === closure.lineId)?.name} · {euro(closure.amountCents)} versés au pot
                    {closure.reopened ? ` · Rouverte le ${displayDate(closure.reopened.date)}` : ""}
                  </p>)}
                </>
              )}
              {b.potTransfers.length > 0 && (
                <>
                  <h3>Transferts depuis le pot commun</h3>
                  {b.potTransfers.map((transfer) => <p key={transfer.id}>
                    {displayDate(transfer.date)} · Vers {b.lines.find((line) => line.id === transfer.lineId)?.name}
                    {transfer.note ? ` · ${transfer.note}` : ""} · {euro(transfer.amountCents)} · Transfert interne
                  </p>)}
                </>
              )}
              <h3>Dépenses des enveloppes</h3>
              {b.expenses.length ? (
                [...b.expenses]
                  .sort((a, c) => a.date.localeCompare(c.date))
                  .map((e) => (
                    <p key={e.id}>
                      {displayDate(e.date)} ·{" "}
                      {e.description ||
                        b.lines.find((l) => l.id === e.lineId)?.name}{" "}
                      · {euro(e.amountCents)}
                    </p>
                  ))
              ) : (
                <Empty>Aucune dépense enregistrée.</Empty>
              )}
            </details>
          );
        })}
    </>
  );
}
