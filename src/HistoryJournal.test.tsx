import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppState, Budget } from "./domain";
import { HistoryJournal, filterHistoryJournal, historyJournalEntries } from "./HistoryJournal";
import { initialState } from "./store";

function fixture(): AppState {
  const state = initialState("2026-11");
  const older = (month: string, label: string, name: string, amountCents: number): Budget => {
    const budget = structuredClone(initialState(month).budget);
    budget.label = label;
    budget.status = "CLOSED";
    budget.lines = budget.lines.filter((line) => line.id === "courses");
    budget.lines[0].name = name;
    budget.expenses = [{ id: "purchase", lineId: "courses", amountCents, date: `${month}-12`, description: "Légumes" }];
    budget.closedPotCents = 80000;
    return budget;
  };
  state.budget.lines = state.budget.lines.filter((line) => line.id === "courses");
  state.budget.lines[0].name = "Alimentation";
  state.budget.expenses = [{ id: "purchase", lineId: "courses", amountCents: 3500, date: "2026-11-03", description: "Marché du dimanche" }];
  state.budget.payments = [{ id: "transfer", memberId: "jean", amountCents: 100000, date: "2026-11-01", note: "Contribution reçue" }];
  state.budget.refunds = [{ memberId: "jean", amountCents: 20000, paidOn: "2026-11-02" }];
  state.archivedBudgets = [
    older("2026-08", "août 2026", "Anciennes courses", 200),
    older("2026-10", "octobre 2026", "Courses communes", 1300),
  ];
  state.potExpenses = [
    { id: "pot-missing-month", amountCents: 700, date: "2026-09-20", description: "Étagère" },
    { id: "pot-current", amountCents: 2500, date: "2026-11-01", description: "Lampe commune" },
  ];
  return state;
}

describe("journal global des dépenses", () => {
  it("réunit les dépenses de tous les mois et du pot, sans inclure contributions, remboursements ou surplus", () => {
    const entries = historyJournalEntries(fixture());
    expect(entries.map((entry) => entry.date)).toEqual([
      "2026-11-03", "2026-11-01", "2026-10-12", "2026-09-20", "2026-08-12",
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(8200);
    expect(entries.filter((entry) => entry.source === "pot")).toHaveLength(2);
    expect(entries.find((entry) => entry.id === "pot:pot-missing-month")).toMatchObject({
      month: "2026-09", monthLabel: "septembre 2026", envelopeLabel: "Pot commun",
    });
  });

  it("conserve le nom de chaque enveloppe dans son mois et des clés distinctes pour les identifiants réutilisés", () => {
    const entries = historyJournalEntries(fixture());
    const envelopeEntries = entries.filter((entry) => entry.source === "envelope");
    expect(envelopeEntries.map((entry) => entry.envelopeLabel)).toEqual([
      "Alimentation", "Courses communes", "Anciennes courses",
    ]);
    expect(new Set(envelopeEntries.map((entry) => entry.id)).size).toBe(3);
    expect(filterHistoryJournal(entries, { search: "courses communes" }).map((entry) => entry.month)).toEqual(["2026-10"]);
  });

  it("combine recherche sans accents, mois et enveloppe pour un total réellement filtré", () => {
    const entries = historyJournalEntries(fixture());
    const rows = filterHistoryJournal(entries, { search: "  LEGUMES  ", month: "2026-10", envelope: "envelope:courses" });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(1300);
    expect(filterHistoryJournal(entries, { search: "etagere", envelope: "pot" }).map((entry) => entry.amountCents)).toEqual([700]);
    expect(filterHistoryJournal(entries, { month: "2026-10", envelope: "pot" })).toEqual([]);
  });

  it("ne modifie ni les tableaux de l’état ni les lignes historiques pendant le tri et le filtrage", () => {
    const state = fixture();
    const before = structuredClone(state);
    const freeze = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(state);
    const entries = historyJournalEntries(state);
    filterHistoryJournal(entries, { month: "2026-09" });
    expect(state).toEqual(before);
    expect(state.archivedBudgets.map((budget) => budget.id)).toEqual(["2026-08", "2026-10"]);
  });

  it("affiche les filtres et les dépenses sans proposer de modification", () => {
    const html = renderToStaticMarkup(<HistoryJournal state={fixture()} />);
    expect(html).toContain("Journal des opérations");
    expect(html).toContain("Dépenses filtrées");
    expect(html).toContain("Rechercher dans le journal des opérations");
    expect(html).toContain("Filtrer le journal par mois");
    expect(html).toContain("Filtrer le journal par enveloppe");
    expect(html).toContain("septembre 2026");
    expect(html).toContain("Pot commun");
    expect(html).not.toMatch(/Modifier|Supprimer|Enregistrer|disabled|<button/);
  });

  it("limite la première page sans tronquer le total de toutes les dépenses filtrées", () => {
    const state = fixture();
    state.budget.expenses = Array.from({ length: 12 }, (_, index) => ({
      id: `expense-${index}`, lineId: "courses", amountCents: 100,
      date: `2026-11-${String(index + 1).padStart(2, "0")}`, description: `Ticket ${index + 1}`,
    }));
    state.archivedBudgets = [];
    state.potExpenses = [];
    const html = renderToStaticMarkup(<HistoryJournal state={state} />);
    expect(html.match(/class="history-journal-entry"/g)).toHaveLength(10);
    expect(html).toContain("Afficher la suite");
    expect(html).toContain("12 opérations");
    expect(html).toContain("12,00");
  });
});
