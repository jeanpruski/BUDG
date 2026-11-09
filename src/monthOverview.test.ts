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
  savePotTransfer,
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

function reserveCarry(includePot = false) {
  let state = line(setup(), "vacances", 30000, "DAILY_LIFE", "RESERVE");
  if (includePot) state = line(state, "source-pot", 20000, "DAILY_LIFE");
  state = startNextMonth(closeMonth(paid(state)));
  state = line(state, "vacances", 10000, "DAILY_LIFE", "RESERVE");
  if (includePot) state = line(state, "source-pot", 0, "DAILY_LIFE");
  return state;
}

describe("bilan synthétique du mois", () => {
  it("garde un graphique vide quand les enveloppes sont prévues mais encore impayées", () => {
    let state = line(setup(), "loyer", 100000, "HOUSING", "FIXED");
    state = line(state, "vacances", 20000, "DAILY_LIFE", "RESERVE");

    expect(monthOverview(state)).toEqual({
      spentCents: 0,
      accountBalanceCents: 0,
      missingCents: 120000,
      reserveProvisions: {
        fundedCents: 0,
        availableCents: 0,
        lines: [{ id: "vacances", name: "vacances", fundedCents: 0, availableCents: 0 }],
      },
      retainedReserveCents: 0,
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

  it.each([
    [0, 10000, 40000],
    [25000, 10000, 15000],
    [35000, 5000, 5000],
    [40000, 0, 0],
  ])("retient les nouvelles provisions après utilisation du report personnel : dépensé %s", (spentCents, retainedCents, availableCents) => {
    let state = paid(reserveCarry());
    if (spentCents) state = expense(state, "vacances", spentCents);
    const before = structuredClone(state);
    const result = monthOverview(state);
    expect(result.reserveProvisions.fundedCents).toBe(10000);
    expect(result.retainedReserveCents).toBe(retainedCents);
    expect(result.reserveProvisions.availableCents).toBe(availableCents);
    expect(result.reserveProvisions.lines).toEqual([{ id: "vacances", name: "vacances", fundedCents: 10000, availableCents }]);
    expect(result.spentCents).toBe(spentCents);
    expect(result.categories.map((category) => category.cents)).toEqual([0, spentCents, 0]);
    expect(result.accountBalanceCents).toBe(availableCents);
    expect(state).toEqual(before);
  });

  it("laisse un report disponible sans le présenter comme une nouvelle réserve du mois", () => {
    const result = monthOverview(reserveCarry());
    expect(result.reserveProvisions.fundedCents).toBe(0);
    expect(result.retainedReserveCents).toBe(0);
    expect(result.reserveProvisions.availableCents).toBe(30000);
    expect(result.accountBalanceCents).toBe(30000);
    expect(result.spentCents).toBe(0);
  });

  it("exclut le reliquat d’un renfort du pot du graphique des nouvelles réserves", () => {
    let state = savePotTransfer(paid(reserveCarry(true)), {
      id: "pot-to-reserve", lineId: "vacances", amountCents: 20000,
      date: "2026-09-01", note: "Ancien argent du pot",
    });
    state = expense(state, "vacances", 50000);
    const result = monthOverview(state);
    expect(result.reserveProvisions.fundedCents).toBe(10000);
    expect(result.reserveProvisions.availableCents).toBe(10000);
    expect(result.retainedReserveCents).toBe(0);
    expect(result.spentCents).toBe(50000);
    expect(result.accountBalanceCents).toBe(10000);
  });

  it("exclut aussi un ancien report issu du pot quand la nouvelle provision personnelle a été dépensée", () => {
    let state = line(setup(), "source-pot", 10000, "DAILY_LIFE");
    state = line(state, "vacances", 0, "DAILY_LIFE", "RESERVE");
    state = startNextMonth(closeMonth(paid(state)));
    state = line(state, "source-pot", 0, "DAILY_LIFE");
    state = savePotTransfer(state, {
      id: "pot-to-reserve", lineId: "vacances", amountCents: 10000,
      date: "2026-09-01", note: "Réserve commune de septembre",
    });
    state = startNextMonth(closeMonth(state));
    state = paid(line(state, "vacances", 10000, "DAILY_LIFE", "RESERVE"));
    state = expense(state, "vacances", 10000);
    const result = monthOverview(state);
    expect(budgetSummary(state.budget).lines.find((entry) => entry.id === "vacances")!.openingPotCents).toBe(10000);
    expect(result.reserveProvisions.fundedCents).toBe(10000);
    expect(result.reserveProvisions.availableCents).toBe(10000);
    expect(result.retainedReserveCents).toBe(0);
    expect(result.spentCents).toBe(10000);
    expect(result.accountBalanceCents).toBe(10000);
  });

  it("plafonne chaque réserve séparément sans absorber la réserve B pour compenser les dépenses de A", () => {
    let state = line(setup(), "reserve-a", 30000, "DAILY_LIFE", "RESERVE");
    state = line(state, "reserve-b", 0, "DAILY_LIFE", "RESERVE");
    state = startNextMonth(closeMonth(paid(state)));
    state = line(state, "reserve-a", 10000, "DAILY_LIFE", "RESERVE");
    state = paid(line(state, "reserve-b", 10000, "DAILY_LIFE", "RESERVE"));
    state = paid(expense(state, "reserve-a", 50000));
    const result = monthOverview(state);
    const fundedA = budgetSummary(state.budget).lines.find((entry) => entry.id === "reserve-a")!.fundedShares.reduce((sum, share) => sum + share.amountCents, 0);
    expect(fundedA).toBe(20000);
    expect(result.reserveProvisions.lines).toEqual([
      { id: "reserve-a", name: "reserve-a", fundedCents: 10000, availableCents: 0 },
      { id: "reserve-b", name: "reserve-b", fundedCents: 10000, availableCents: 10000 },
    ]);
    expect(result.reserveProvisions.fundedCents).toBe(20000);
    expect(result.reserveProvisions.availableCents).toBe(10000);
    expect(result.retainedReserveCents).toBe(10000);
    expect(result.spentCents).toBe(50000);
    expect(result.accountBalanceCents).toBe(10000);
  });
});
