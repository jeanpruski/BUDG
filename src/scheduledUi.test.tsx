import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpenseForm } from "./forms";
import { ScheduledExpenses } from "./ScheduledExpenses";
import { Envelopes, type Actions } from "./screens";
import { FutureBudgetPanel } from "./FutureBudgetPanel";
import { configureHousehold, initialState, saveLine, saveScheduledExpense } from "./store";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-27T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup() {
  let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  s = { ...s, budget: { ...s.budget, lines: [] } };
  return saveLine(s, { id: "bill", name: "Électricité", kind: "FIXED", expenseGroup: "HOUSING", plannedCents: 10000 });
}
const entry = { id: "pending", lineId: "bill", amountCents: 9000, date: "2026-11-29", description: "Prélèvement annoncé" };
const actions = { scheduledExpense: vi.fn(), removeScheduledExpense: vi.fn() } as unknown as Actions;
describe("interface des paiements prévus", () => {
  it("accepte une date jusqu’au mois suivant et distingue le prévu de la confirmation réelle", () => {
    const state = saveScheduledExpense(setup(), entry), scheduled = state.scheduledExpenses[0];
    const html = renderToStaticMarkup(<ExpenseForm state={state} scheduled={scheduled} busy={false} submit={vi.fn()} />);
    expect(html).toContain('max="2026-12-31"');
    expect(html).toContain('name="scheduled" value="true"');
    expect(html).toContain("Montant prévu");
    expect(html).not.toContain('name="settled"');
    const confirmed = renderToStaticMarkup(<ExpenseForm state={state} scheduled={scheduled} confirmDebit busy={false} submit={vi.fn()} />);
    expect(confirmed).toContain('value="2026-11-27"');
    expect(confirmed).toContain('name="scheduled" value="false"');
    expect(confirmed).toContain("Montant payé");
  });
  it("affiche les prévisions sur les cartes et réserve leurs actions à l’éditeur", () => {
    const state = saveScheduledExpense(setup(), entry);
    const card = renderToStaticMarkup(<Envelopes budget={state.budget} scheduledExpenses={state.scheduledExpenses} actions={actions} />);
    expect(card).toContain("Paiement prévu");
    const html = renderToStaticMarkup(<ScheduledExpenses budget={state.budget} payments={state.scheduledExpenses} actions={actions} />);
    expect(html).toContain("Confirmer le débit");
    expect(html).toContain("Modifier le paiement prévu");
    expect(html).toContain("Annuler le paiement prévu");
    const viewer = renderToStaticMarkup(<ScheduledExpenses budget={state.budget} payments={state.scheduledExpenses} actions={actions} readOnly />);
    expect(viewer).toContain("Prélèvement annoncé");
    expect(viewer).not.toContain("<button");
  });
  it("rappelle les débits du mois prochain dans la prévision sans les additionner aux provisions", () => {
    const state = saveScheduledExpense(setup(), { ...entry, date: "2026-12-05" });
    const html = renderToStaticMarkup(<FutureBudgetPanel state={state} readOnly add={vi.fn()} edit={vi.fn()} use={vi.fn()} remove={vi.fn()} returnUse={vi.fn()} />);
    expect(html).toContain("Paiements déjà annoncés pour ce mois");
    expect(html).toContain("05/12/2026");
    expect(html).toContain("Électricité");
  });
});
