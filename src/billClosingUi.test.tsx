import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BillCloseForm, BillClosing, BillReopenForm } from "./BillClosing";
import { ExpenseForm } from "./forms";
import { EnvelopeExpenses } from "./EnvelopeExpenses";
import { EnvelopeAmountForm } from "./EnvelopeAmountForm";
import { HistoryJournal, filterHistoryJournal, historyJournalEntries } from "./HistoryJournal";
import { budgetSummary, euro, potSummary } from "./domain";
import { Actions } from "./screens";
import { closeBill, configureHousehold, initialState, reopenBill, saveExpense, saveLine, savePayment } from "./store";

const actions: Actions = {
  expense: vi.fn(), payment: vi.fn(), line: vi.fn(), removeLine: vi.fn(), removeExpense: vi.fn(), removePayment: vi.fn(),
  settle: vi.fn(), close: vi.fn(), next: vi.fn(), potExpense: vi.fn(), removePotExpense: vi.fn(), closeBill: vi.fn(), reopenBill: vi.fn(),
};
function fixture(paid = 10000) {
  let state = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  state = { ...state, budget: { ...state.budget, lines: [] } };
  state = saveLine(state, { id: "electricite", name: "Électricité", kind: "FIXED", expenseGroup: "HOUSING", allocationType: "FIFTY_FIFTY", plannedCents: 10000 });
  state = saveLine(state, { id: "courses", name: "Courses", kind: "VARIABLE", expenseGroup: "DAILY_LIFE", plannedCents: 0 });
  for (const member of state.budget.members) state = savePayment(state, { id: member.id, memberId: member.id, amountCents: paid / 2, date: "2026-11-01", note: "Contribution" });
  return saveExpense(state, { id: "invoice", lineId: "electricite", amountCents: 8000, date: "2026-11-02", description: "Facture payée" }, true);
}

describe("clôture individuelle dans l’interface", () => {
  it("annonce le surplus réellement financé et exige la confirmation des paiements", () => {
    const state = fixture();
    const line = budgetSummary(state.budget).lines[0];
    const html = renderToStaticMarkup(<BillCloseForm line={line} busy={false} submit={vi.fn()} />);
    expect(html).toContain(`Provision prévue</dt><dd>${euro(10000)}`);
    expect(html).toContain(`Déjà payé</dt><dd>${euro(8000)}`);
    expect(html).toContain(`Surplus vers le pot</dt><dd>${euro(2000)}`);
    expect(html).toContain('name="confirmed" required=""');
    const partial = fixture(8000);
    const limited = renderToStaticMarkup(<BillClosing budget={partial.budget} line={budgetSummary(partial.budget).lines[0]} actions={actions} potAvailableCents={0} />);
    expect(limited).toContain('disabled=""');
    expect(limited).toContain(`Encore ${euro(2000)} à financer`);
  });

  it("garde la facture consultable sans actions pour le lecteur et bloque la correction de ses paiements", () => {
    const state = closeBill(fixture(), "electricite");
    const line = budgetSummary(state.budget).lines[0];
    const panel = renderToStaticMarkup(<BillClosing budget={state.budget} line={line} actions={actions} readOnly potAvailableCents={2000} />);
    expect(panel).toContain("Facture clôturée");
    expect(panel).not.toContain("<button");
    const payments = renderToStaticMarkup(<EnvelopeExpenses budget={state.budget} line={line} actions={actions} />);
    expect(payments).toContain("Facture payée");
    expect(payments).not.toContain("<button");
    const form = renderToStaticMarkup(<ExpenseForm state={state} busy={false} submit={vi.fn()} />);
    expect(form).toContain('<option value="electricite" disabled="">');
    expect(form).toContain('<option value="courses" selected="">');
  });

  it("garde la programmation future accessible et désactive une réouverture sans fonds", () => {
    const state = closeBill(fixture(), "electricite");
    const line = state.budget.lines[0];
    const form = renderToStaticMarkup(<EnvelopeAmountForm line={line} budgetMonth={state.budget.id} closedBill busy={false} submit={vi.fn()} remove={vi.fn()} />);
    expect(form).toContain('min="2026-12"');
    expect(form).toContain('value="2026-12"');
    const reopen = renderToStaticMarkup(<BillReopenForm amountCents={2000} potAvailableCents={0} busy={false} submit={vi.fn()} />);
    expect(reopen).toContain("Le pot ne contient plus assez");
    expect(reopen).toContain('type="submit" disabled=""');
  });

  it("identifie clôture et réouverture comme mouvements internes, sans doubler les dépenses", () => {
    const state = reopenBill(closeBill(fixture(), "electricite"), "electricite");
    const entries = historyJournalEntries(state);
    expect(filterHistoryJournal(entries, { kind: "expenses" })).toHaveLength(1);
    expect(filterHistoryJournal(entries, { kind: "transfers" }).map((entry) => entry.source).sort()).toEqual(["billRelease", "billReopen"]);
    const html = renderToStaticMarkup(<HistoryJournal state={state} />);
    expect(html).toContain(`Dépenses filtrées</span><strong>${euro(8000)}`);
    expect(potSummary(state).availableCents).toBe(0);
  });
});
