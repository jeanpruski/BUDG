import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetGuide } from "./guide";
import { Actions, CommonPot, Dashboard, Envelopes, Members, Transactions } from "./screens";
import { configureHousehold, initialState, saveExpense, saveLine, savePayment } from "./store";

const actions: Actions = {
  expense: vi.fn(), payment: vi.fn(), line: vi.fn(), removeLine: vi.fn(),
  removeExpense: vi.fn(), removePayment: vi.fn(), settle: vi.fn(), close: vi.fn(),
  next: vi.fn(), potExpense: vi.fn(), removePotExpense: vi.fn(),
};
let state = configureHousehold(initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08");
state = saveLine(state, { ...state.budget.lines.find((line) => line.id === "courses")!, plannedCents: 20000 });
state = savePayment(state, { id: "payment-1", memberId: "jean", amountCents: 10000, date: "2026-08-01", note: "Versement réel" });
state = saveExpense(state, { id: "expense-1", lineId: "courses", amountCents: 1000, date: "2026-08-02", description: "Achat réel" }, false);

describe("interface en lecture seule", () => {
  it("conserve la navigation du tableau de bord et masque les versements, dépenses et clôtures", () => {
    const html = renderToStaticMarkup(<Dashboard state={state} actions={actions} openBudget={vi.fn()} readOnly />);
    expect(html).toContain("Voir les enveloppes");
    expect(html).not.toMatch(/Enregistrer un versement|Ajouter une dépense|Saisir un paiement|Vérifier et clôturer|Préparer le mois suivant/);
    expect(html).not.toContain("Confirmer : plus rien");
    const editor = renderToStaticMarkup(<Dashboard state={state} actions={actions} openBudget={vi.fn()} />);
    expect(editor).toContain("Enregistrer un versement");
    expect(editor).toContain("Vérifier et clôturer");
  });
  it("masque les actions des enveloppes et du pot, sans désactiver les filtres", () => {
    const html = renderToStaticMarkup(<>
      <Envelopes budget={state.budget} actions={actions} readOnly />
      <Members budget={state.budget} actions={actions} readOnly />
      <Transactions budget={state.budget} actions={actions} mode="expenses" readOnly />
      <Transactions budget={state.budget} actions={actions} mode="payments" readOnly />
      <CommonPot state={state} actions={actions} readOnly />
    </>);
    expect(html).not.toMatch(/Ajouter une dépense|Ajouter un versement|Enregistrer un versement|Saisir un paiement|Utiliser le pot commun|Modifier l’opération|Supprimer l’opération/);
    expect(html).toContain('type="search"');
    expect(html).toContain("Filtrer par enveloppe");
    expect(html).not.toContain("disabled");
    expect(html).toContain("Achat réel");
    expect(html).toContain("Versement réel");
    expect(html).not.toContain('aria-label="Modifier');
    expect(html).not.toContain('aria-label="Supprimer');
  });
  it("garde les explications du guide et supprime ses invitations à modifier", () => {
    const html = renderToStaticMarkup(<BudgetGuide state={state} actions={actions} prepare={vi.fn()} payments={vi.fn()} readOnly />);
    expect(html).toContain("Comment ça marche");
    expect(html).not.toContain("<button");
    expect(html).toContain("guide-lessons");
  });
});
