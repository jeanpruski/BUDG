import { describe, expect, it } from "vitest";
import { AppState, BudgetLine, accountBalance, budgetSummary, validateState } from "./domain";
import {
  closeMonth,
  configureHousehold,
  confirmMonthlyIncomes,
  initialState,
  membersForMonth,
  saveExpense,
  saveLine,
  saveMonthlyIncomes,
  savePayment,
  startNextMonth,
} from "./store";

function household(month = "2026-08") {
  const state = configureHousehold(
    initialState(month),
    ["Camille", "Alex"],
    [300000, 200000],
    month,
  );
  return { ...state, budget: { ...state.budget, lines: [] } };
}

function envelope(
  state: AppState,
  id: string,
  plannedCents = 100000,
  allocationType: BudgetLine["allocationType"] = "PRO_RATA",
  kind: BudgetLine["kind"] = "VARIABLE",
) {
  return saveLine(state, {
    id,
    name: id,
    plannedCents,
    expenseGroup: "HOUSING",
    kind,
    allocationType,
    ...(allocationType === "CUSTOM"
      ? { customPercentages: [{ memberId: "jean", percent: 70 }, { memberId: "miruna", percent: 30 }] }
      : {}),
  });
}

function pay(state: AppState, memberId: string, amountCents: number) {
  return savePayment(state, {
    id: `payment-${state.budget.payments.length}`,
    memberId,
    amountCents,
    date: `${state.budget.id}-01`,
    note: "Versement reçu",
  });
}

function fullyFunded(state: AppState) {
  for (const member of budgetSummary(state.budget).balances) {
    if (member.remaining) state = pay(state, member.id, member.remaining);
  }
  return state;
}

function spend(state: AppState, lineId: string, amountCents: number) {
  return saveExpense(state, {
    id: `expense-${state.budget.expenses.length}`,
    lineId,
    amountCents,
    date: `${state.budget.id}-02`,
    description: "Achat payé",
  }, false);
}

describe("saisie des salaires d’un mois", () => {
  it("conserve les centimes exacts et recalcule seulement les répartitions au prorata", () => {
    const before = envelope(envelope(envelope(household(), "prorata", 100001), "moitie", 10001, "FIFTY_FIFTY"), "manuel", 10001, "CUSTOM");
    const updated = saveMonthlyIncomes(before, [300001, 200000], "2026-08");

    expect(updated.budget.members.map((m) => m.incomeCents)).toEqual([300001, 200000]);
    expect(updated.budget.lines.map((line) => line.shares.map((part) => part.amountCents))).toEqual([
      [60001, 40000],
      [5001, 5000],
      [7001, 3000],
    ]);
    expect(updated.budget.lines.map((line) => line.plannedCents)).toEqual([100001, 10001, 10001]);
    expect(updated.members.map((m) => m.name)).toEqual(["Camille", "Alex"]);
    expect(updated.budget.payments).toEqual([]);
    expect(validateState(JSON.parse(JSON.stringify(updated)))).toEqual(updated);
    expect(before.budget.members.map((m) => m.incomeCents)).toEqual([300000, 200000]);
  });

  it("ajuste le complément après un versement partiel sans modifier les opérations réelles", () => {
    const before = spend(pay(envelope(household(), "logement"), "jean", 30000), "logement", 20000);
    const updated = saveMonthlyIncomes(before, [400000, 100000], "2026-08");

    expect(budgetSummary(updated.budget).balances.map((m) => m.remaining)).toEqual([50000, 20000]);
    expect(updated.budget.payments).toEqual(before.budget.payments);
    expect(updated.budget.expenses).toEqual(before.budget.expenses);
    expect(accountBalance(updated)).toBe(10000);
    expect(accountBalance(updated)).toBe(accountBalance(before));
  });

  it("conserve un trop-versé après correction et demande seulement le complément réellement manquant", () => {
    const before = spend(fullyFunded(envelope(household(), "logement")), "logement", 40000);
    const updated = saveMonthlyIncomes(before, [250000, 250000], "2026-08");
    const summary = budgetSummary(updated.budget);

    expect(summary.balances.map((m) => m.expected)).toEqual([50000, 50000]);
    expect(summary.balances.map((m) => m.paid)).toEqual([60000, 40000]);
    expect(summary.balances.map((m) => m.remaining)).toEqual([0, 10000]);
    expect(summary.balances[0].paid - summary.balances[0].expected).toBe(10000);
    expect(updated.budget.payments).toEqual(before.budget.payments);
    expect(updated.budget.expenses).toEqual(before.budget.expenses);
    expect(accountBalance(updated)).toBe(60000);
    expect(() => closeMonth(updated)).toThrow(/versements/i);
    const closed = closeMonth(pay(updated, "miruna", 10000));
    expect(closed.budget.closedPotCents).toBe(70000);
  });

  it("préserve les réserves reportées et les archives lors d’une correction du mois actif", () => {
    const archived = closeMonth(spend(fullyFunded(envelope(household(), "vacances", 10000, "PRO_RATA", "RESERVE")), "vacances", 2000));
    const before = spend(startNextMonth(archived), "vacances", 1000);
    const updated = saveMonthlyIncomes(before, [100000, 400000], "2026-09");

    expect(updated.budget.lines[0].openingShares.map((part) => part.amountCents)).toEqual([4800, 3200]);
    expect(updated.budget.lines[0].openingShares).toEqual(before.budget.lines[0].openingShares);
    expect(updated.budget.lines[0].shares.map((part) => part.amountCents)).toEqual([2000, 8000]);
    expect(updated.archivedBudgets).toEqual(before.archivedBudgets);
    expect(updated.archivedBudgets[0]).toEqual(archived.budget);
    expect(updated.budget.expenses).toEqual(before.budget.expenses);
    expect(updated.budget.payments).toEqual(before.budget.payments);
    expect(accountBalance(updated)).toBe(accountBalance(before));
  });

  it("programme le mois suivant avant clôture sans modifier le budget courant", () => {
    const before = spend(pay(envelope(household(), "logement"), "jean", 30000), "logement", 10000);
    const scheduled = saveMonthlyIncomes(before, [350012, 210034], "2026-09");

    expect(scheduled.budget).toEqual(before.budget);
    expect(scheduled.archivedBudgets).toEqual(before.archivedBudgets);
    expect(membersForMonth(scheduled, "2026-09").map((m) => m.incomeCents)).toEqual([350012, 210034]);
    expect(accountBalance(scheduled)).toBe(accountBalance(before));
    expect(startNextMonth(closeMonth(fullyFunded(scheduled))).budget.members.map((m) => m.incomeCents)).toEqual([350012, 210034]);
  });

  it("corrige le mois courant sans écraser le suivant ni une programmation plus lointaine", () => {
    let before = configureHousehold(envelope(household(), "logement"), ["Camille", "Alex"], [360000, 220000], "2026-12");
    before = saveMonthlyIncomes(before, [350000, 210000], "2026-09");
    const updated = saveMonthlyIncomes(before, [301023, 198987], "2026-08");

    expect(updated.budget.members.map((m) => m.incomeCents)).toEqual([301023, 198987]);
    expect(updated.incomeHistory.filter((h) => h.effectiveFrom > "2026-08")).toEqual(before.incomeHistory.filter((h) => h.effectiveFrom > "2026-08"));
    expect(membersForMonth(updated, "2026-09").map((m) => m.incomeCents)).toEqual([350000, 210000]);
    expect(membersForMonth(updated, "2026-12").map((m) => m.incomeCents)).toEqual([360000, 220000]);
  });

  it("remplace les deux salaires du mois sélectionné sans créer de doublons", () => {
    let state = saveMonthlyIncomes(household(), [350000, 210000], "2026-09");
    state = saveMonthlyIncomes(state, [351012, 209998], "2026-09");

    expect(state.incomeHistory.filter((h) => h.effectiveFrom === "2026-09")).toEqual([
      { memberId: "jean", amountCents: 351012, effectiveFrom: "2026-09" },
      { memberId: "miruna", amountCents: 209998, effectiveFrom: "2026-09" },
    ]);
    expect(state.incomeHistory.filter((h) => h.effectiveFrom === "2026-08").map((h) => h.amountCents)).toEqual([300000, 200000]);
  });

  it("refuse de réécrire les salaires d’un mois clôturé mais autorise la préparation du suivant", () => {
    const closed = closeMonth(fullyFunded(envelope(household(), "logement")));
    expect(() => saveMonthlyIncomes(closed, [320000, 210000], "2026-08")).toThrow(/clôturé/);
    const scheduled = saveMonthlyIncomes(closed, [320000, 210000], "2026-09");
    expect(scheduled.budget).toEqual(closed.budget);
    expect(scheduled.budget.status).toBe("CLOSED");
    expect(startNextMonth(scheduled).budget.members.map((m) => m.incomeCents)).toEqual([320000, 210000]);
  });

  it("rejette les mois hors du mois courant et du suivant ainsi que les mois invalides", () => {
    const state = household();
    for (const month of ["2026-07", "2026-10", "2026-13", "2026-8", "", "2026-08-01"]) {
      expect(() => saveMonthlyIncomes(state, [300000, 200000], month)).toThrow();
    }
  });

  it("refuse des montants incomplets, supplémentaires, non entiers, négatifs ou hors limites", () => {
    const state = household();
    for (const incomes of [[], [300000], [300000, 200000, 100000], [0, 0], [1.5, 200000], [-1, 200000], [NaN, 200000], [Infinity, 200000], [1_000_000_001, 200000]]) {
      expect(() => saveMonthlyIncomes(state, incomes, "2026-08")).toThrow();
    }
    expect(saveMonthlyIncomes(state, [0, 200001], "2026-08").budget.members.map((m) => m.incomeCents)).toEqual([0, 200001]);
    expect(saveMonthlyIncomes(state, [1_000_000_000, 0], "2026-08").budget.members.map((m) => m.incomeCents)).toEqual([1_000_000_000, 0]);
  });

  it("confirme les salaires programmés lors du passage de décembre à janvier", () => {
    const state = saveMonthlyIncomes(envelope(household("2025-12"), "logement"), [320001, 210002], "2026-01");
    const closed = closeMonth(fullyFunded(state));
    const next = confirmMonthlyIncomes(closed, [320001, 210002]);

    expect(next.budget.id).toBe("2026-01");
    expect(next.budget.members.map((m) => m.incomeCents)).toEqual([320001, 210002]);
    expect(next.archivedBudgets[0]).toEqual(closed.budget);
    expect(next.budget.payments).toEqual([]);
    expect(next.budget.expenses).toEqual([]);
    expect(() => confirmMonthlyIncomes(state, [320001, 210002])).toThrow(/Clôturez/);
  });
});
