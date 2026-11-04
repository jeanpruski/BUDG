import { useId, useMemo, useState } from "react";
import { AppState, euro, monthLabel } from "./domain";
import { displayDate } from "./ui";
import "./history-journal.css";

export type HistoryJournalEntry = {
  id: string;
  date: string;
  month: string;
  monthLabel: string;
  envelopeKey: string;
  envelopeLabel: string;
  description: string;
  amountCents: number;
  source: "envelope" | "pot";
};

/** Expenses only: contributions and surplus transfers are not money spent. */
export function historyJournalEntries(state: AppState): HistoryJournalEntry[] {
  const budgets = [state.budget, ...state.archivedBudgets];
  const monthLabels = new Map(budgets.map((budget) => [budget.id, budget.label]));
  const entries: HistoryJournalEntry[] = [];
  for (const budget of budgets) {
    const names = new Map(budget.lines.map((line) => [line.id, line.name]));
    for (const expense of budget.expenses) {
      entries.push({
        id: `${budget.id}:envelope:${expense.id}`,
        date: expense.date,
        month: budget.id,
        monthLabel: budget.label,
        envelopeKey: `envelope:${expense.lineId}`,
        envelopeLabel: names.get(expense.lineId) || "Ancienne enveloppe",
        description: expense.description || "Paiement enregistré",
        amountCents: expense.amountCents,
        source: "envelope",
      });
    }
  }
  for (const expense of state.potExpenses) {
    const month = expense.date.slice(0, 7);
    entries.push({
      id: `pot:${expense.id}`,
      date: expense.date,
      month,
      monthLabel: monthLabels.get(month) || monthLabel(month),
      envelopeKey: "pot",
      envelopeLabel: "Pot commun",
      description: expense.description,
      amountCents: expense.amountCents,
      source: "pot",
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

const normalize = (value: string) => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();

export function filterHistoryJournal(
  entries: HistoryJournalEntry[],
  filters: { search?: string; month?: string; envelope?: string } = {},
) {
  const query = normalize(filters.search || "");
  return entries.filter((entry) =>
    (!filters.month || entry.month === filters.month) &&
    (!filters.envelope || entry.envelopeKey === filters.envelope) &&
    (!query || normalize(`${entry.description} ${entry.envelopeLabel}`).includes(query)),
  );
}

const PAGE_SIZE = 10;

export function HistoryJournal({ state }: { state: AppState }) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [envelope, setEnvelope] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const entries = useMemo(() => historyJournalEntries(state), [state]);
  const months = useMemo(() => {
    const options = new Map([state.budget, ...state.archivedBudgets]
      .map((budget) => [budget.id, budget.label]));
    for (const entry of entries) options.set(entry.month, entry.monthLabel);
    return [...options].sort(([a], [b]) => b.localeCompare(a));
  }, [state, entries]);
  const envelopes = useMemo(() => {
    const options = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (!options.has(entry.envelopeKey)) options.set(entry.envelopeKey, new Set());
      options.get(entry.envelopeKey)!.add(entry.envelopeLabel);
    }
    return [...options].map(([key, names]) => ({ key, label: [...names].join(" / ") }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [entries]);
  const rows = filterHistoryJournal(entries, { search, month, envelope });
  const totalCents = rows.reduce((sum, entry) => sum + entry.amountCents, 0);
  const visibleRows = rows.slice(0, visibleCount);
  return (
    <section className="panel history-journal" aria-labelledby={titleId}>
      <div className="history-journal-header">
        <div>
          <h2 id={titleId}>Journal des dépenses</h2>
          <p>Retrouvez les dépenses des enveloppes et du pot commun.</p>
        </div>
        <p className="history-journal-total" aria-live="polite" aria-atomic="true">
          <span>{rows.length} {rows.length === 1 ? "dépense" : "dépenses"} · Total filtré</span>
          <strong>{euro(totalCents)}</strong>
        </p>
      </div>
      <div className="history-journal-filters">
        <label className="history-journal-field">
          Rechercher
          <input type="search" aria-label="Rechercher dans le journal des dépenses"
            placeholder="Libellé ou enveloppe…" value={search}
            onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }} />
        </label>
        <label className="history-journal-field">
          Mois
          <select aria-label="Filtrer le journal par mois" value={month}
            onChange={(event) => { setMonth(event.target.value); setVisibleCount(PAGE_SIZE); }}>
            <option value="">Tous les mois</option>
            {months.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="history-journal-field">
          Enveloppe
          <select aria-label="Filtrer le journal par enveloppe" value={envelope}
            onChange={(event) => { setEnvelope(event.target.value); setVisibleCount(PAGE_SIZE); }}>
            <option value="">Toutes les dépenses</option>
            {envelopes.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      {visibleRows.length ? (
        <ol className="history-journal-list">
          {visibleRows.map((entry) => (
            <li className="history-journal-entry" key={entry.id}>
              <div className="history-journal-copy">
                <strong>{entry.description}</strong>
                <div className="history-journal-meta">
                  <time dateTime={entry.date}>{displayDate(entry.date)}</time>
                  <span className={entry.source === "pot" ? "history-journal-pot" : ""}>
                    {entry.envelopeLabel}
                  </span>
                </div>
              </div>
              <strong className="history-journal-amount">−{euro(entry.amountCents)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="history-journal-empty" role="status">
          {entries.length ? "Aucune dépense ne correspond à ces filtres." : "Aucune dépense enregistrée."}
        </p>
      )}
      {rows.length > PAGE_SIZE && (
        <div className="history-journal-footer">
          <span>{visibleRows.length} sur {rows.length} dépenses affichées</span>
          {visibleRows.length < rows.length && (
            <button type="button" className="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Afficher la suite
            </button>
          )}
        </div>
      )}
    </section>
  );
}
