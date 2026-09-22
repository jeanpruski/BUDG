import { FundingRing, HeroArt } from "./visuals";
import { useState } from "react";
import {
  ArrowDownLeft,
  Wallet,
  ShoppingBag,
  Sprout,
  House,
  ReceiptText,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  AppState,
  Budget,
  BudgetLine,
  Expense,
  Payment,
  PotExpense,
  potSummary,
  accountBalance,
  budgetSummary,
  euro,
  today,
} from "./domain";
import { Empty, Metric, displayDate } from "./ui";
export type Actions = {
  expense: (lineId?: string, expense?: Expense) => void;
  payment: (memberId?: string, payment?: Payment) => void;
  line: (line?: BudgetLine) => void;
  removeLine: (id: string) => void;
  removeExpense: (id: string) => void;
  removePayment: (id: string) => void;
  settle: (id: string, value: boolean) => void;
  close: () => void;
  next: () => void;
  potExpense: (expense?: PotExpense) => void;
  removePotExpense: (id: string) => void;
};
export function Dashboard({
  state,
  actions,
  openBudget,
}: {
  state: AppState;
  actions: Actions;
  openBudget: () => void;
}) {
  const b = state.budget,
    summary = budgetSummary(b);
  const pot = potSummary(state);
  const potSpentThisMonth = state.potExpenses
    .filter((e) => e.date.slice(0, 7) === b.id)
    .reduce((n, e) => n + e.amountCents, 0);
  return (
    <>
      <div className="intro-card">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="hero-status-dot" />
            VOTRE QUOTIDIEN, EN PLUS SEREIN
          </span>
          <h2>
            Chacun sa part.
            <br />
            <em>De beaux projets à deux.</em>
          </h2>
          <p>
            Un budget clair aujourd’hui.
            <br />
            Un peu plus de liberté pour demain.
          </p>
          <div className="hero-rule">
            <span>
              <House size={13} />
              Appartement au prorata
            </span>
            <span>
              <ShoppingBag size={13} />
              Quotidien à 50/50
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <HeroArt />
          <div className="hero-funding">
            <FundingRing
              percent={
                summary.plannedCents
                  ? (Object.values(summary.paid).reduce((n, x) => n + x, 0) /
                      summary.plannedCents) *
                    100
                  : 0
              }
            />
            <span>
              <b>
                {summary.plannedCents
                  ? "Votre budget se construit"
                  : "À vous de commencer"}
              </b>
              <small>
                {summary.plannedCents
                  ? "Versements reçus / budget prévu"
                  : "Préparez vos premières enveloppes"}
              </small>
            </span>
          </div>
        </div>
      </div>
      <div className="metrics">
        <Metric
          icon={Wallet}
          label="Sur le compte commun"
          value={euro(accountBalance(state))}
          detail="Solde calculé à partir des opérations saisies"
          tone="green"
        />
        <Metric
          icon={ArrowDownLeft}
          label="Encore à verser ce mois"
          value={euro(summary.missingCents)}
          detail={
            summary.missingCents
              ? "Contributions ou dépassements à financer"
              : "Les contributions du mois sont à jour"
          }
          tone={summary.missingCents ? "amber" : ""}
        />
        <Metric
          icon={ShoppingBag}
          label="Dépensé ce mois"
          value={euro(summary.spentCents + potSpentThisMonth)}
          detail={`${euro(summary.spentCents)} dans les enveloppes · ${euro(potSpentThisMonth)} dans le pot`}
        />
        <Metric
          icon={Sprout}
          label="Pot commun"
          value={euro(pot.availableCents)}
          detail="Surplus conservé, inclus dans le solde du compte"
        />
      </div>
      <div className="section-head">
        <div>
          <h2>Vos contributions</h2>
          <p>
            Un versement correspond à un virement réellement reçu sur le compte
            commun.
          </p>
        </div>
      </div>
      <Members budget={b} actions={actions} />
      {!b.lines.some((l) => l.plannedCents > 0) && (
        <div className="notice">
          <p>
            Commencez par renseigner les montants de vos enveloppes. Les
            factures et achats ne sont jamais créés automatiquement.
          </p>
          <button className="primary" onClick={openBudget}>
            Préparer le budget
          </button>
        </div>
      )}
      <div className="section-head">
        <div>
          <h2>Les enveloppes du mois</h2>
          <p>
            « Financé » = part des versements reçus affectée à cette enveloppe,
            plus sa réserve reportée.
          </p>
        </div>
        <button className="secondary" onClick={openBudget}>
          Gérer les enveloppes
        </button>
      </div>
      <Envelopes budget={b} actions={actions} compact />
      <div className="panel closing-panel">
        <div>
          <h2>{b.status === "CLOSED" ? "Mois clôturé" : "Terminer le mois"}</h2>
          <p>
            {b.status === "CLOSED"
              ? "Le surplus reste dans votre pot commun. Vous pouvez préparer le mois suivant."
              : `${summary.unpaidBills.length} facture(s) à confirmer · ${euro(summary.reservedCents)} à conserver dans les réserves`}
          </p>
        </div>
        <button
          className="primary"
          onClick={b.status === "CLOSED" ? actions.next : actions.close}
        >
          {b.status === "CLOSED"
            ? "Préparer le mois suivant"
            : "Vérifier et clôturer"}
        </button>
      </div>
    </>
  );
}
export function Members({
  budget,
  actions,
}: {
  budget: Budget;
  actions: Actions;
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
          {budget.status === "ACTIVE" && (
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
  compact = false,
}: {
  budget: Budget;
  actions: Actions;
  compact?: boolean;
}) {
  const summary = budgetSummary(budget),
    closed = budget.status === "CLOSED";
  return (
    <>
      {(["HOUSING", "DAILY_LIFE"] as const).map((group) => (
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
            <span>
              {group === "HOUSING" ? "Au prorata des salaires" : "50/50"}
            </span>
          </div>
          <div className="envelopes">
            {summary.lines
              .filter((l) => l.expenseGroup === group)
              .map((l) => {
                const late =
                  l.kind === "FIXED" &&
                  !l.settled &&
                  l.dueDay &&
                  `${budget.id}-${String(Math.min(l.dueDay, new Date(Number(budget.id.slice(0, 4)), Number(budget.id.slice(5)), 0).getDate())).padStart(2, "0")}` <
                    today();
                return (
                  <article
                    className={`panel envelope envelope-${l.kind.toLowerCase()}`}
                    key={l.id}
                  >
                    <div className="section-head">
                      <div className="envelope-title">
                        <span className="envelope-symbol">
                          {l.kind === "RESERVE" ? (
                            <Sprout size={19} />
                          ) : l.kind === "FIXED" ? (
                            <ReceiptText size={19} />
                          ) : (
                            <ShoppingBag size={19} />
                          )}
                        </span>
                        <h3>{l.name}</h3>
                      </div>
                      <span
                        className={`badge ${l.kind === "RESERVE" ? "blue" : l.settled ? "green" : late ? "amber" : ""}`}
                      >
                        {l.kind === "RESERVE"
                          ? "Réserve"
                          : l.kind === "VARIABLE"
                            ? "À consommer"
                            : l.settled
                              ? "Facture réglée"
                              : late
                                ? "Échéance dépassée"
                                : "Facture à régler"}
                      </span>
                    </div>
                    <div className="envelope-amount">
                      <strong className={l.available < 0 ? "text-red" : ""}>
                        {euro(l.available)}
                      </strong>
                      <span>
                        {closed
                          ? "solde de l’enveloppe à la clôture"
                          : "financés, encore disponibles"}
                      </span>
                    </div>
                    <progress
                      aria-label={`Dépenses ${l.name}`}
                      value={Math.min(l.spent, l.capacity || 1)}
                      max={l.capacity || 1}
                    />
                    <dl className="line-numbers">
                      <div>
                        <dt>Prévu ce mois</dt>
                        <dd>{euro(l.plannedCents)}</dd>
                      </div>
                      {l.opening > 0 && (
                        <div>
                          <dt>Réserve reportée</dt>
                          <dd>{euro(l.opening)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Financé</dt>
                        <dd>{euro(l.funded)}</dd>
                      </div>
                      <div>
                        <dt>Dépensé</dt>
                        <dd>{euro(l.spent)}</dd>
                      </div>
                      <div>
                        <dt>
                          {l.remaining < 0 ? "Dépassement" : "Budget restant"}
                        </dt>
                        <dd className={l.remaining < 0 ? "text-red" : ""}>
                          {euro(Math.abs(l.remaining))}
                        </dd>
                      </div>
                    </dl>
                    {l.funded < l.capacity && (
                      <p className="hint text-amber">
                        Il manque {euro(l.capacity - l.funded)} pour financer
                        cette enveloppe.
                      </p>
                    )}
                    {l.kind === "RESERVE" && (
                      <p className="hint">
                        Le solde est conservé le mois suivant et exclu des
                        surplus du pot commun.
                      </p>
                    )}
                    {l.dueDay && l.kind === "FIXED" && (
                      <p className="hint">
                        Échéance habituelle : le {l.dueDay} du mois.
                      </p>
                    )}
                    {!compact && (
                      <p className="hint">
                        {budget.members
                          .map(
                            (m) =>
                              `${m.name} : ${euro(l.shares.find((s) => s.memberId === m.id)?.amountCents ?? 0)}`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                    {!closed && (
                      <div className="actions">
                        <button
                          className="secondary"
                          onClick={() => actions.expense(l.id)}
                        >
                          <Plus size={15} />
                          {l.kind === "FIXED"
                            ? "Saisir un paiement"
                            : "Ajouter une dépense"}
                        </button>
                        {!compact && (
                          <>
                            <button
                              className="icon-button"
                              aria-label={`Modifier ${l.name}`}
                              onClick={() => actions.line(l)}
                            >
                              <Pencil size={17} />
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label={`Supprimer ${l.name}`}
                              onClick={() => actions.removeLine(l.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {!compact && !closed && l.kind === "FIXED" && (
                      <button
                        className="text-button"
                        onClick={() => actions.settle(l.id, !l.settled)}
                      >
                        {l.settled
                          ? "Marquer comme restant à régler"
                          : "Confirmer : plus rien à payer ce mois"}
                      </button>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}
export function Transactions({
  budget,
  actions,
  mode,
}: {
  budget: Budget;
  actions: Actions;
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
        {!closed && (
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
            {!closed && (
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
}: {
  state: AppState;
  actions: Actions;
}) {
  const pot = potSummary(state);
  const entries = [
    ...pot.credits
      .filter((b) => b.closedPotCents > 0)
      .map((b) => ({
        id: "close-" + b.id,
        month: b.id,
        date: b.label,
        description: "Surplus · " + b.label,
        amount: b.closedPotCents,
        expense: undefined as PotExpense | undefined,
      })),
    ...state.potExpenses.map((e) => ({
      id: e.id,
      month: e.date.slice(0, 7),
      date: displayDate(e.date),
      description: e.description,
      amount: -e.amountCents,
      expense: e,
    })),
  ].sort((a, b) => b.month.localeCompare(a.month) || b.id.localeCompare(a.id));
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
          label="Utilisé dans le pot"
          value={euro(pot.spentCents)}
          detail="Achats déjà effectués"
        />
        <Metric
          icon={Wallet}
          label={
            budgetSummary(state.budget).missingCents
              ? "Réserves prévues"
              : "Réserves affectées"
          }
          value={euro(budgetSummary(state.budget).reservedCents)}
          detail={
            budgetSummary(state.budget).missingCents
              ? "Report et provisions une fois financées"
              : "Conservées séparément du pot commun"
          }
        />
      </div>
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Mouvements du pot commun</h2>
            <p>
              Les opérations sont identifiées « Pot commun ». Une affectation du
              surplus ne crée aucun virement bancaire.
            </p>
          </div>
          <button
            className="primary"
            disabled={pot.availableCents <= 0}
            onClick={() => actions.potExpense()}
          >
            <Plus size={17} />
            Utiliser le pot commun
          </button>
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
                  {entry.date} · <span className="badge green">Pot commun</span>
                </small>
              </div>
              <b className={entry.amount >= 0 ? "text-green" : ""}>
                {entry.amount >= 0 ? "+" : "−"}
                {euro(Math.abs(entry.amount))}
              </b>
              {entry.expense && (
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
                        <td>
                          {l.allocationType === "PRO_RATA"
                            ? "Prorata"
                            : "50/50"}
                        </td>
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
