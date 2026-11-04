import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvelopeFunding } from "./EnvelopeFunding";
import { PotTransferForm } from "./PotTransferForm";
import { Actions, CommonPot, Envelopes } from "./screens";
import { HistoryJournal, filterHistoryJournal, historyJournalEntries } from "./HistoryJournal";
import { budgetSummary, euro } from "./domain";
import { closeMonth, configureHousehold, initialState, removeLine, saveExpense, saveLine, savePayment, savePotTransfer, startNextMonth } from "./store";

function fixture() {
  let state = configureHousehold(initialState("2026-10"), ["Camille", "Alex"], [300000, 200000], "2026-10");
  state = { ...state, budget: { ...state.budget, lines: [] } };
  for (const [id, kind] of [["vacances", "RESERVE"], ["courses", "VARIABLE"]] as const) {
    state = saveLine(state, { id, name: id === "vacances" ? "Vacances" : "Courses", plannedCents: 60000, expenseGroup: "DAILY_LIFE", kind });
  }
  for (const member of budgetSummary(state.budget).balances) {
    state = savePayment(state, { id: member.id, memberId: member.id, amountCents: member.remaining, date: "2026-10-01", note: "Contribution" });
  }
  state = saveExpense(state, { id: "old-expense", lineId: "vacances", amountCents: 50000, date: "2026-10-02", description: "Séjour payé" }, false);
  state = removeLine(startNextMonth(closeMonth(state)), "courses");
  return savePotTransfer(state, { id: "topup", lineId: "vacances", amountCents: 20000, date: "2026-11-01", note: "Renfort ponctuel" });
}
const actions: Actions = {
  expense: vi.fn(), payment: vi.fn(), line: vi.fn(), removeLine: vi.fn(), removeExpense: vi.fn(),
  removePayment: vi.fn(), settle: vi.fn(), close: vi.fn(), next: vi.fn(), potExpense: vi.fn(),
  removePotExpense: vi.fn(), potTransfer: vi.fn(), removePotTransfer: vi.fn(),
};

describe("interface des réserves et transferts internes", () => {
  it("distingue la provision, le report et le renfort déjà reçus sans afficher une provision comme disponible", () => {
    const state = fixture();
    const line = budgetSummary(state.budget).lines[0];
    const html = renderToStaticMarkup(<EnvelopeFunding line={line} />);
    expect(html).toContain(`Provision du mois</dt><dd>${euro(60000)}`);
    expect(html).toContain(`Réserve reportée</dt><dd>${euro(10000)}`);
    expect(html).toContain(`Depuis le pot ce mois</dt><dd>${euro(20000)}`);
    const form = renderToStaticMarkup(<PotTransferForm state={state} lineId="vacances" busy={false} submit={vi.fn()} />);
    expect(form).toContain(`Disponible dans l’enveloppe</dt><dd>${euro(30000)}`);
    expect(form).toContain(`Provision du mois conservée</dt><dd>${euro(60000)}`);
  });

  it("laisse les transferts consultables par le lecteur sans proposer de création ou d’annulation", () => {
    const state = fixture();
    const html = renderToStaticMarkup(<>
      <Envelopes budget={state.budget} actions={actions} readOnly potAvailableCents={40000} />
      <CommonPot state={state} actions={actions} readOnly />
    </>);
    expect(html).toContain("Renfort ponctuel");
    expect(html).toContain("Transfert interne");
    expect(html).not.toMatch(/Alimenter|Annuler le transfert|Depuis le pot commun<\/button>/);
  });

  it("permet de retrouver un transfert dans le journal sans le compter comme une dépense", () => {
    const state = fixture();
    const entries = historyJournalEntries(state);
    expect(filterHistoryJournal(entries, { kind: "expenses" })).toHaveLength(1);
    expect(filterHistoryJournal(entries, { kind: "transfers", envelope: "envelope:vacances", search: "transfert" })).toMatchObject([{ amountCents: 20000, source: "transfer" }]);
    const html = renderToStaticMarkup(<HistoryJournal state={state} />);
    expect(html).toContain(`Transferts internes : ${euro(20000)}`);
    expect(html).toContain(`↔${euro(20000)}`);
    expect(html).toContain(`Dépenses filtrées</span><strong>${euro(50000)}`);
  });
});
