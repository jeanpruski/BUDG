import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BudgetGuide } from "./guide";
import { MonthClosing } from "./MonthClosing";
import { Actions, CommonPot, Dashboard, Envelopes, History, Members, Transactions } from "./screens";
import { closeMonth, configureHousehold, initialState, saveExpense, saveLine, saveLineAmount, savePayment } from "./store";

const actions: Actions = {
  expense: vi.fn(), payment: vi.fn(), line: vi.fn(), removeLine: vi.fn(),
  removeExpense: vi.fn(), removePayment: vi.fn(), settle: vi.fn(), close: vi.fn(),
  next: vi.fn(), potExpense: vi.fn(), removePotExpense: vi.fn(), amount: vi.fn(),
};
let state = configureHousehold(initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08");
state = saveLine(state, { ...state.budget.lines.find((line) => line.id === "courses")!, plannedCents: 20000 });
state = savePayment(state, { id: "payment-1", memberId: "jean", amountCents: 10000, date: "2026-08-01", note: "Versement réel" });
state = saveExpense(state, { id: "expense-1", lineId: "courses", amountCents: 1000, date: "2026-08-02", description: "Achat réel" }, false);

describe("interface en lecture seule", () => {
  it("présente un bilan consultatif sans actions de versement, dépense ou clôture", () => {
    const html = renderToStaticMarkup(<Dashboard state={state} />);
    expect(html).toContain("Les dépenses du mois");
    expect(html).toContain("Dépenses payées");
    expect(html).toContain("Mis de côté ce mois");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/Enregistrer un versement|Ajouter une dépense|Saisir un paiement|Vérifier et clôturer|Préparer le mois suivant/);
    expect(html).not.toContain("Confirmer : plus rien");
  });
  it("conserve la clôture et le mois suivant dans les enveloppes uniquement pour l’éditeur", () => {
    const active = renderToStaticMarkup(<MonthClosing budget={state.budget} actions={actions} />);
    expect(active).toContain("Vérifier et clôturer");
    expect(active).not.toContain("Préparer le mois suivant");
    const closed = closeMonth(savePayment(state, {
      id: "payment-2", memberId: "miruna", amountCents: 10000, date: "2026-08-03", note: "Contribution reçue",
    }));
    const next = renderToStaticMarkup(<MonthClosing budget={closed.budget} actions={actions} />);
    expect(next).toContain("Préparer le mois suivant");
    expect(next).not.toContain("Vérifier et clôturer");
    expect(renderToStaticMarkup(<MonthClosing budget={state.budget} actions={actions} readOnly />)).toBe("");
    expect(renderToStaticMarkup(<MonthClosing budget={closed.budget} actions={actions} readOnly />)).toBe("");
  });
  it("masque les actions des enveloppes et du pot, sans désactiver les filtres", () => {
    const html = renderToStaticMarkup(<>
      <Envelopes budget={state.budget} actions={actions} readOnly />
      <Members budget={state.budget} actions={actions} readOnly />
      <Transactions budget={state.budget} actions={actions} mode="payments" readOnly />
      <CommonPot state={state} actions={actions} readOnly />
      <History state={state} />
    </>);
    expect(html).not.toMatch(/Ajouter une dépense|Ajouter un versement|Enregistrer un versement|Saisir un paiement|Utiliser le pot commun|Modifier l’opération|Supprimer l’opération|Modifier la dépense|Supprimer la dépense|Montants par mois/);
    expect(html).toContain('type="search"');
    expect(html).toContain("Filtrer le journal par enveloppe");
    expect(html).not.toContain("disabled");
    expect(html).toContain("Achat réel");
    expect(html).toContain("Versement réel");
    expect(html).not.toContain('aria-label="Modifier');
    expect(html).not.toContain('aria-label="Supprimer');
  });
  it("garde les explications du guide et supprime ses invitations à modifier", () => {
    const html = renderToStaticMarkup(<BudgetGuide state={state} actions={actions} prepare={vi.fn()} payments={vi.fn()} readOnly />);
    expect(html).toContain("Comment ça marche");
    expect(html).not.toMatch(/Voir les contributions|Me guider pas à pas|Reprendre le guide des enveloppes/);
    expect(html).toContain("guide-lessons");
  });
  it("reconnaît un mois à zéro préparé sans redemander de construire ou financer les enveloppes", () => {
    let zero = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
    zero = saveLine(zero, { ...zero.budget.lines[0], plannedCents: 100000 });
    zero = saveLineAmount(zero, "credit", 0, "2026-11", "MONTH");
    const html = renderToStaticMarkup(<BudgetGuide state={zero} actions={actions} prepare={vi.fn()} payments={vi.fn()} />);
    expect(html).toContain("Rien à financer ce mois");
    expect(html).toContain("Aucun versement attendu pour ce mois");
    expect(html).toContain("Vérifier la clôture");
    expect(html).not.toMatch(/On construit votre budget|Me guider pas à pas|Voir les contributions/);
  });
});
