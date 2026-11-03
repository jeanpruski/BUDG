import { AppState, euro, monthLabel, nextMonth } from "./domain";
import { membersForMonth } from "./store";
import "./monthly-income.css";

export function MonthlyIncomePanel({
  state,
  readOnly = false,
  edit,
  prepare,
}: {
  state: AppState;
  readOnly?: boolean;
  edit: () => void;
  prepare: () => void;
}) {
  const closed = state.budget.status === "CLOSED";
  const followingMonth = nextMonth(state.budget.id);
  const hasPreparedIncomes = state.incomeHistory.some(
    (income) => income.effectiveFrom === followingMonth,
  );
  const preparedMembers = membersForMonth(state, followingMonth);
  return (
    <section className="panel monthly-income-panel" aria-labelledby="monthly-income-title">
      <div className="monthly-income-heading">
        <h2 id="monthly-income-title">Salaires du mois</h2>
        <span>{monthLabel(state.budget.id)}</span>
      </div>
      <dl className="monthly-income-amounts">
        {state.budget.members.map((member) => (
          <div key={member.id}>
            <dt>{member.name} <span>· net mensuel</span></dt>
            <dd>{euro(member.incomeCents)}</dd>
          </div>
        ))}
      </dl>
      <p className="monthly-income-explanation">
        {closed
          ? "Ce mois est clôturé : ses salaires sont conservés."
          : "Ces salaires servent à répartir les enveloppes au prorata. Vous pouvez les ajuster au montant réellement reçu."}
      </p>
      {hasPreparedIncomes && (
        <div className="monthly-income-prepared">
          <strong>Salaires préparés pour {monthLabel(followingMonth)}</strong>
          <p>
            {preparedMembers.map((member, index) => (
              <span key={member.id}>
                {index > 0 && " · "}{member.name} : {euro(member.incomeCents)}
              </span>
            ))}
          </p>
          <small>Ils seront à confirmer à l’ouverture du mois suivant.</small>
        </div>
      )}
      {!readOnly && (
        <div className="monthly-income-actions">
          {!closed && (
            <button className="secondary" onClick={edit}>Modifier les salaires</button>
          )}
          <button className="secondary" onClick={prepare}>
            Préparer les salaires pour {monthLabel(followingMonth)}
          </button>
        </div>
      )}
    </section>
  );
}
