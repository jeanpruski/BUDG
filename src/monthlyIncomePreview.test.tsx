import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { budgetSummary, euro } from "./domain";
import { MonthlyIncomeForm } from "./forms";
import { monthlyIncomePreview } from "./monthlyIncome";
import { configureHousehold, initialState, saveExpense, saveLine, saveLineAmount, saveMonthlyIncomes, savePayment } from "./store";

function fixture() {
  let state = configureHousehold(initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08");
  state = saveLine(state, { ...state.budget.lines[0], plannedCents: 100000 });
  for (const [index, member] of state.members.entries()) {
    state = savePayment(state, {
      id: `payment-${member.id}`, memberId: member.id, amountCents: index ? 40000 : 60000,
      date: "2026-08-01", note: "Virement réel",
    });
  }
  return state;
}

describe("aperçu des salaires mensuels", () => {
  it("présente les mêmes contributions et restes que l’enregistrement, avec les versements conservés", () => {
    const state = fixture();
    const original = JSON.stringify(state);
    const preview = monthlyIncomePreview(state, [400000, 100000], true);
    const saved = budgetSummary(saveMonthlyIncomes(state, [400000, 100000], "2026-08").budget);
    expect(preview.map((member) => [member.expected, member.paid, member.remaining])).toEqual(
      saved.balances.map((member) => [member.expected, member.paid, member.remaining]),
    );
    expect(preview[1].overpaid).toBe(20000);
    expect(JSON.stringify(state)).toBe(original);
  });
  it("inclut dans le reste à verser les dépenses dépassant les montants prévus", () => {
    const state = saveExpense(fixture(), {
      id: "expense", lineId: "credit", amountCents: 120000, date: "2026-08-02", description: "Dépense réelle",
    }, true);
    const preview = monthlyIncomePreview(state, [400000, 100000], true);
    const saved = budgetSummary(saveMonthlyIncomes(state, [400000, 100000], "2026-08").budget);
    expect(preview.map((member) => member.remaining)).toEqual(saved.balances.map((member) => member.remaining));
    expect(preview[0].remaining).toBe(36000);
  });
  it("estime le mois prochain sans reprendre les opérations du mois courant", () => {
    const state = saveExpense(fixture(), {
      id: "expense", lineId: "credit", amountCents: 120000, date: "2026-08-02", description: "Dépense réelle",
    }, true);
    const preview = monthlyIncomePreview(state, [400000, 100000], false);
    expect(preview.map((member) => [member.expected, member.paid, member.remaining])).toEqual([
      [80000, 0, 80000], [20000, 0, 20000],
    ]);
  });
  it("prérenseigne le mois préparé et garde tous les salaires directement modifiables", () => {
    const state = saveMonthlyIncomes(fixture(), [301234, 202345], "2026-09");
    for (const mode of ["schedule", "open"] as const) {
      const html = renderToStaticMarkup(<MonthlyIncomeForm state={state} mode={mode} busy={false} submit={() => {}} />);
      expect(html).toContain('value="3012.34"');
      expect(html).toContain('value="2023.45"');
      expect(html).toContain("Les salaires préparés");
      expect(html).not.toContain('type="hidden"');
    }
    const html = renderToStaticMarkup(<MonthlyIncomeForm state={state} mode="current" busy={false} submit={() => {}} />);
    expect(html).toContain('value="3000"');
    expect(html).toContain(euro(60000));
    expect(html).toContain("Déjà versé");
    expect(html).toContain("Enregistrer et recalculer");
  });
  it("utilise le montant prévu du mois prochain et non l’exception du mois courant", () => {
    let state = saveLineAmount(fixture(), "credit", 0, "2026-08", "MONTH");
    state = saveLineAmount(state, "credit", 150012, "2026-09", "MONTH");
    expect(monthlyIncomePreview(state, [400000, 100000], true).map((member) => member.expected)).toEqual([0, 0]);
    expect(monthlyIncomePreview(state, [400000, 100000], false).map((member) => member.expected)).toEqual([120010, 30002]);
  });
  it("explique la saisie invalide sans afficher de calcul trompeur", () => {
    const html = renderToStaticMarkup(<MonthlyIncomeForm state={initialState("2026-08")} mode="current" busy={false} submit={() => {}} />);
    expect(html).toContain("Renseignez au moins un salaire positif.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Contribution prévue</dt>");
  });
});
