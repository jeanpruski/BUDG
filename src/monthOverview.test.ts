import { describe, expect, it } from "vitest";
import { AppState, BudgetLine, budgetSummary } from "./domain";
import { monthOverview } from "./monthOverview";
import {
  closeMonth,
  configureHousehold,
  initialState,
  saveExpense,
  saveLine,
  savePayment,
  savePotExpense,
  startNextMonth,
} from "./store";

function setup(): AppState {
  const state = configureHousehold(initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08");
  return { ...state, budget: { ...state.budget, lines: [] } };
}

function line(state: AppState, id: string, plannedCents: number, expenseGroup: BudgetLine["expenseGroup"], kind: BudgetLine["kind"] = "VARIABLE") {
  return saveLine(state, { id, name: id, plannedCents, expenseGroup, kind });
}

function payment(state: AppState, memberId: string, amountCents: number) {
  return savePayment(state, { id: `payment-${state.budget.payments.length}`, memberId, amountCents, date: `${state.budget.id}-01`, note: "" });
}

function paid(state: AppState) {
  for (const balance of budgetSummary(state.budget).balances) {
    if (balance.remaining > 0) state = payment(state, balance.id, balance.remaining);
  }
  return state;
}

function expense(state: AppState, lineId: string, amountCents: number) {
  return saveExpense(state, { id: `expense-${state.budget.expenses.length}`, lineId, amountCents, date: `${state.budget.id}-02`, description: "Paiement réel" }, true);
}

describe("bilan synthétique du mois", () => {
  it("garde un graphique vide quand les enveloppes sont prévues mais encore impayées", () => {
    let state = line(setup(), "loyer", 100000, "HOUSING", "FIXED");
    state = line(state, "vacances", 20000, "DAILY_LIFE", "RESERVE");

    expect(monthOverview(state)).toEqual({
      spentCents: 0,
      accountBalanceCents: 0,
      missingCents: 120000,
      categories: [
        { key: "housing", label: "Appartement", cents: 0 },
        { key: "daily", label: "Vie quotidienne", cents: 0 },
        { key: "pot", label: "Achats du pot commun", cents: 0 },
      ],
    });
  });

  it("compte seulement les paiements réels, y compris une réserve dans son groupe", () => {
    let state = line(setup(), "loyer", 100000, "HOUSING", "FIXED");
    state = line(state, "taxe", 20000, "HOUSING", "RESERVE");
    state = line(state, "courses", 40000, "DAILY_LIFE");
    state = line(state, "vacances", 20000, "DAILY_LIFE", "RESERVE");
    state = paid(state);
    state = expense(state, "loyer", 75000);
    state = expense(state, "taxe", 5000);
    state = expense(state, "courses", 12345);

    const result = monthOverview(state);
    expect(result.spentCents).toBe(92345);
    expect(result.categories.map((category) => category.cents)).toEqual([80000, 12345, 0]);
    expect(result.accountBalanceCents).toBe(87655);
    expect(result.missingCents).toBe(0);
  });

  it("ne compte pas une réserve reportée comme dépense et compte son paiement une seule fois", () => {
    const august = closeMonth(paid(line(setup(), "vacances", 20000, "DAILY_LIFE", "RESERVE")));
    const september = startNextMonth(august);

    expect(monthOverview(september).spentCents).toBe(0);
    expect(monthOverview(september).accountBalanceCents).toBe(20000);

    const result = monthOverview(expense(september, "vacances", 7500));
    expect(result.spentCents).toBe(7500);
    expect(result.categories.map((category) => category.cents)).toEqual([0, 7500, 0]);
    expect(result.accountBalanceCents).toBe(12500);
    expect(result.missingCents).toBe(20000);
  });

  it("inclut seulement les achats du pot du mois affiché et exclut les dépenses archivées", () => {
    let state = paid(line(setup(), "courses", 50000, "DAILY_LIFE"));
    state = closeMonth(expense(state, "courses", 20000));
    state = savePotExpense(state, { id: "pot-august", amountCents: 5000, date: "2026-08-31", description: "Ancien achat" });
    state = startNextMonth(state);
    state = line(state, "logement", 10000, "HOUSING");
    state = expense(state, "logement", 3000);
    state = savePotExpense(state, { id: "pot-september", amountCents: 2000, date: "2026-09-05", description: "Achat du mois" });

    const result = monthOverview(state);
    expect(result.spentCents).toBe(5000);
    expect(result.categories.map((category) => category.cents)).toEqual([3000, 0, 2000]);
    expect(result.accountBalanceCents).toBe(20000);
    expect(result.missingCents).toBe(60000);
  });

  it("conserve un solde négatif et les contributions manquantes sans les convertir en dépenses", () => {
    let state = line(setup(), "courses", 10000, "DAILY_LIFE");
    state = payment(state, "jean", 1000);
    state = expense(state, "courses", 2500);

    const result = monthOverview(state);
    expect(result.spentCents).toBe(2500);
    expect(result.categories.map((category) => category.cents)).toEqual([0, 2500, 0]);
    expect(result.accountBalanceCents).toBe(-1500);
    expect(result.missingCents).toBe(9000);
  });
});
