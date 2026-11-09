import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { euro, type AppState } from "./domain";
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
    expect(html).toContain("Répartition du mois");
    expect(html).toContain("Payé et réservé");
    expect(html).toContain("Mis de côté ce mois");
    const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('aria-pressed="true"');
    expect(buttons[0]).toContain("Réserves du mois");
    expect(html).not.toMatch(/Enregistrer un versement|Ajouter une dépense|Saisir un paiement|Vérifier et clôturer|Préparer le mois suivant/);
    expect(html).not.toContain("Confirmer : plus rien");
  });
  it("présente toutes les réserves dans un tableau distinguant la provision du mois et le disponible", () => {
    const configured = configureHousehold(initialState("2026-08"), ["Camille", "Alex"], [300000, 200000], "2026-08");
    let reserves: AppState = { ...configured, budget: { ...configured.budget, lines: [] } };
    reserves = saveLine(reserves, { id: "financed", name: "Vacances financées", plannedCents: 10000, expenseGroup: "DAILY_LIFE", kind: "RESERVE" });
    reserves = saveLine(reserves, { id: "unfunded", name: "Charges sans versement", plannedCents: 0, expenseGroup: "HOUSING", kind: "RESERVE" });
    reserves = savePayment(reserves, { id: "camille", memberId: "jean", amountCents: 5000, date: "2026-08-01", note: "Versement reçu" });
    reserves = savePayment(reserves, { id: "alex", memberId: "miruna", amountCents: 5000, date: "2026-08-01", note: "Versement reçu" });
    reserves = saveExpense(reserves, { id: "purchase", lineId: "financed", amountCents: 2500, date: "2026-08-02", description: "Achat réel" }, false);
    const html = renderToStaticMarkup(<Dashboard state={reserves} />);
    const table = html.match(/<table\b[^>]*aria-label="Réserves par enveloppe"[\s\S]*?<\/table>/)?.[0];
    expect(table).toBeDefined();
    expect(table).toContain("Ce mois");
    expect(table).toContain("Total disponible");
    const rows = [...table!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
    const financed = rows.find((row) => row.includes("Vacances financées"));
    const unfunded = rows.find((row) => row.includes("Charges sans versement"));
    expect(financed).toContain(euro(10000));
    expect(financed).toContain(euro(7500));
    expect(unfunded).toBeDefined();
    expect(unfunded!.split(euro(0))).toHaveLength(3);
    expect(html).not.toMatch(/Ajouter une dépense|Enregistrer un versement|Clôturer cette facture|Rouvrir la facture|Alimenter depuis le pot commun/);
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
