import { describe, expect, it } from "vitest";
import {
  AmountPlan,
  AmountScope,
  AppState,
  BudgetLine,
  accountBalance,
  amountForMonth,
  budgetSummary,
  stateSchema,
  validateState,
} from "./domain";
import {
  closeMonth,
  configureHousehold,
  initialState,
  removeLineAmount,
  saveExpense,
  saveLine,
  saveLineAmount,
  savePayment,
  startNextMonth,
} from "./store";

function household(month = "2025-11") {
  const state = configureHousehold(initialState(month), ["Camille", "Alex"], [300000, 200000], month);
  return { ...state, budget: { ...state.budget, lines: [] } };
}
function envelope(
  state: AppState,
  id = "loan",
  plannedCents = 120055,
  allocationType: BudgetLine["allocationType"] = "PRO_RATA",
  kind: BudgetLine["kind"] = "VARIABLE",
) {
  return saveLine(state, {
    id, name: id, plannedCents, allocationType, expenseGroup: "HOUSING", kind,
    ...(allocationType === "CUSTOM" ? {
      customPercentages: [{ memberId: "jean", percent: 70 }, { memberId: "miruna", percent: 30 }],
    } : {}),
  });
}
function line(state: AppState, id = "loan") {
  return state.budget.lines.find((entry) => entry.id === id)!;
}
function fund(state: AppState) {
  for (const member of budgetSummary(state.budget).balances) {
    if (member.remaining) state = savePayment(state, {
      id: `payment-${state.budget.payments.length}`, memberId: member.id,
      amountCents: member.remaining, date: `${state.budget.id}-01`, note: "Versement réel",
    });
  }
  return state;
}

describe("montants habituels et exceptions mensuelles", () => {
  it("donne priorité à l’exception exacte puis au dernier changement, indépendamment de l’ordre", () => {
    const definition = {
      plannedCents: 12345,
      amountPlan: {
        baseCents: 12345,
        changes: [{ fromMonth: "2025-11", amountCents: 20000 }, { fromMonth: "2025-09", amountCents: 15000 }],
        exceptions: [{ month: "2025-11", amountCents: 25000 }, { month: "2025-10", amountCents: 0 }],
      },
    };
    expect(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12"].map((month) => amountForMonth(definition, month))).toEqual([
      12345, 15000, 0, 25000, 20000,
    ]);
    expect(definition.amountPlan.changes[0].fromMonth).toBe("2025-11");
    expect(amountForMonth({ plannedCents: 98765 }, "2026-01")).toBe(98765);
  });

  it("prévoit zéro en novembre, une première échéance majorée en décembre puis le montant normal en janvier", () => {
    let state = envelope(envelope(household(), "loan", 120055, "PRO_RATA", "FIXED"), "courses", 1000);
    state = saveLineAmount(state, "loan", 0, "2025-11", "MONTH");
    state = saveLineAmount(state, "loan", 185099, "2025-12", "MONTH");
    expect(line(state).plannedCents).toBe(0);
    expect(budgetSummary(state.budget).unpaidBills).toEqual([]);
    expect(budgetSummary(state.budget).plannedCents).toBe(1000);
    const november = closeMonth(fund(state));
    state = startNextMonth(november);
    expect(line(state).plannedCents).toBe(185099);
    expect(line(state).shares.map((share) => share.amountCents)).toEqual([111059, 74040]);
    expect(line(state).settled).toBe(false);
    state = saveExpense(fund(state), {
      id: "first-loan", lineId: "loan", amountCents: 185099, date: "2025-12-02", description: "Première mensualité",
    }, true);
    const december = closeMonth(state);
    state = startNextMonth(december);
    expect(line(state).plannedCents).toBe(120055);
    expect(line(state).shares.map((share) => share.amountCents)).toEqual([72033, 48022]);
    expect(line(state).settled).toBe(false);
    expect(state.budget.payments).toEqual([]);
    expect(state.budget.expenses).toEqual([]);
    expect(state.archivedBudgets).toEqual([november.budget, december.budget]);
    expect(state.archivedBudgets.map((budget) => budget.lines[0].plannedCents)).toEqual([0, 185099]);
  });

  it("clôture un mois réellement à zéro sans inventer de mouvements avant les premières mensualités", () => {
    let state = envelope(household(), "loan", 1000, "PRO_RATA", "FIXED");
    state = saveLineAmount(state, "loan", 0, "2025-11", "MONTH");
    state = saveLineAmount(state, "loan", 1500, "2025-12", "MONTH");
    const november = closeMonth(state);
    expect(november.budget.status).toBe("CLOSED");
    expect(november.budget.closedPotCents).toBe(0);
    expect(november.budget.payments).toEqual([]);
    expect(november.budget.expenses).toEqual([]);
    expect(november.budget.refunds).toEqual([]);
    expect(accountBalance(november)).toBe(0);

    state = startNextMonth(november);
    expect(line(state).plannedCents).toBe(1500);
    expect(state.budget.payments).toEqual([]);
    state = saveExpense(fund(state), {
      id: "first-loan", lineId: "loan", amountCents: 1500,
      date: "2025-12-02", description: "Première mensualité réelle",
    }, true);
    const december = closeMonth(state);
    state = startNextMonth(december);
    expect(line(state).plannedCents).toBe(1000);
    expect(state.budget.payments).toEqual([]);
    expect(state.budget.expenses).toEqual([]);
    expect(state.archivedBudgets.map((budget) => ({
      month: budget.id, planned: budget.lines[0].plannedCents,
      paid: budget.payments.reduce((total, payment) => total + payment.amountCents, 0),
      spent: budget.expenses.reduce((total, expense) => total + expense.amountCents, 0),
    }))).toEqual([
      { month: "2025-11", planned: 0, paid: 0, spent: 0 },
      { month: "2025-12", planned: 1500, paid: 1500, spent: 1500 },
    ]);
    expect(accountBalance(state)).toBe(0);
  });

  it("refuse toujours la clôture sans enveloppe ou avec des dépenses non financées malgré un prévu à zéro", () => {
    expect(() => closeMonth(household())).toThrow(/enveloppe/);
    const state = saveLineAmount(envelope(household(), "loan", 1000, "PRO_RATA", "FIXED"), "loan", 0, "2025-11", "MONTH");
    const spent = saveExpense(state, {
      id: "unplanned-loan", lineId: "loan", amountCents: 500,
      date: "2025-11-02", description: "Débit inattendu",
    }, true);
    expect(budgetSummary(spent.budget).missingCents).toBe(500);
    expect(() => closeMonth(spent)).toThrow(/versements/i);
  });

  it("remplace seulement la programmation choisie et conserve les changements et exceptions futurs", () => {
    let state = envelope(household(), "loan", 100001);
    state = saveLineAmount(state, "loan", 150007, "2026-02", "FROM_MONTH");
    state = saveLineAmount(state, "loan", 200009, "2026-03", "MONTH");
    state = saveLineAmount(state, "loan", 0, "2025-12", "MONTH");
    const original = JSON.stringify(state);
    const updated = saveLineAmount(state, "loan", 110003, "2025-12", "FROM_MONTH");
    expect(line(updated).plannedCents).toBe(100001);
    expect(line(updated).amountPlan?.baseCents).toBe(100001);
    expect(["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"].map((month) => amountForMonth(line(updated), month))).toEqual([
      110003, 110003, 150007, 200009, 150007,
    ]);
    expect(line(updated).amountPlan?.exceptions.some((entry) => entry.month === "2025-12")).toBe(false);
    const replaced = saveLineAmount(updated, "loan", 160011, "2026-02", "FROM_MONTH");
    expect(line(replaced).amountPlan?.changes.filter((entry) => entry.fromMonth === "2026-02")).toEqual([
      { fromMonth: "2026-02", amountCents: 160011 },
    ]);
    expect(amountForMonth(line(replaced), "2026-03")).toBe(200009);
    expect(JSON.stringify(state)).toBe(original);
  });

  it("préserve le plan quand on change seulement le nom ou la règle d’une enveloppe", () => {
    let state = saveLineAmount(envelope(household()), "loan", 0, "2025-11", "MONTH");
    state = saveLineAmount(state, "loan", 180000, "2025-12", "MONTH");
    const updated = saveLine(state, { ...line(state), name: "Prêt immobilier", allocationType: "FIFTY_FIFTY" });
    expect(line(updated).name).toBe("Prêt immobilier");
    expect(line(updated).amountPlan).toEqual(line(state).amountPlan);
    expect(line(updated).plannedCents).toBe(0);
    expect(amountForMonth(line(updated), "2026-01")).toBe(120055);
  });

  it("traite une ancienne modification de montant sans options comme un changement habituel du mois courant", () => {
    let state = saveLineAmount(envelope(household()), "loan", 0, "2025-11", "MONTH");
    state = saveLineAmount(state, "loan", 180000, "2025-12", "MONTH");
    const updated = saveLine(state, { ...line(state), plannedCents: 125001 });
    expect(line(updated).plannedCents).toBe(125001);
    expect(line(updated).amountPlan?.baseCents).toBe(120055);
    expect(line(updated).amountPlan?.exceptions).toEqual([{ month: "2025-12", amountCents: 180000 }]);
    expect(amountForMonth(line(updated), "2026-01")).toBe(125001);
  });

  it("permet à une nouvelle enveloppe de démarrer plus tard sans contribution avant le début", () => {
    const state = saveLine(household(), {
      id: "loan", name: "Prêt", plannedCents: 120055, allocationType: "PRO_RATA", expenseGroup: "HOUSING", kind: "FIXED",
    }, { month: "2025-12", scope: "FROM_MONTH" });
    expect(line(state).amountPlan?.baseCents).toBe(0);
    expect(line(state).plannedCents).toBe(0);
    expect(line(state).shares.map((share) => share.amountCents)).toEqual([0, 0]);
    expect(amountForMonth(line(state), "2025-12")).toBe(120055);
    expect(amountForMonth(line(state), "2026-01")).toBe(120055);
  });

  it("supprime une programmation en retrouvant le montant précédent sans effacer la base ni les autres dates", () => {
    let state = saveLineAmount(envelope(household()), "loan", 180000, "2025-12", "MONTH");
    state = saveLineAmount(state, "loan", 125001, "2026-01", "FROM_MONTH");
    state = saveLineAmount(state, "loan", 0, "2025-11", "MONTH");
    state = removeLineAmount(state, "loan", "2025-11", "MONTH");
    expect(line(state).plannedCents).toBe(120055);
    expect(line(state).shares.map((share) => share.amountCents)).toEqual([72033, 48022]);
    state = removeLineAmount(state, "loan", "2026-01", "FROM_MONTH");
    expect(amountForMonth(line(state), "2026-01")).toBe(120055);
    expect(amountForMonth(line(state), "2025-12")).toBe(180000);
    state = removeLineAmount(state, "loan", "2025-12", "MONTH");
    expect(line(state).amountPlan).toEqual({ baseCents: 120055, changes: [], exceptions: [] });
  });

  it.each([
    ["PRO_RATA", [6002, 4001]],
    ["FIFTY_FIFTY", [5002, 5001]],
    ["CUSTOM", [7002, 3001]],
  ] as const)("conserve chaque centime et la règle %s pendant le passage de mois", (allocationType, expectedShares) => {
    const state = saveLineAmount(envelope(household(), "loan", 10001, allocationType), "loan", 10003, "2025-11", "MONTH");
    expect(line(state).shares.map((share) => share.amountCents)).toEqual(expectedShares);
    expect(line(state).shares.reduce((total, share) => total + share.amountCents, 0)).toBe(10003);
    const closed = closeMonth(fund(state));
    const next = startNextMonth(closed);
    expect(line(next).plannedCents).toBe(10001);
    expect(line(next).allocationType).toBe(allocationType);
    expect(line(next).customPercentages).toEqual(line(state).customPercentages);
    expect(next.archivedBudgets[0]).toEqual(closed.budget);
  });

  it("conserve les versements, dépenses, réserves reportées et archives lors d’une programmation", () => {
    const previous = closeMonth(fund(envelope(household("2025-10"), "reserve", 10001, "PRO_RATA", "RESERVE")));
    let state = startNextMonth(previous);
    state = saveExpense(fund(state), {
      id: "reserve-expense", lineId: "reserve", amountCents: 3000, date: "2025-11-02", description: "Achat réel",
    }, false);
    const original = JSON.stringify(state);
    const updated = saveLineAmount(state, "reserve", 0, "2025-11", "MONTH");
    expect(updated.budget.payments).toEqual(state.budget.payments);
    expect(updated.budget.expenses).toEqual(state.budget.expenses);
    expect(line(updated, "reserve").openingShares).toEqual(line(state, "reserve").openingShares);
    expect(line(updated, "reserve").openingShares.map((share) => share.amountCents)).toEqual([6001, 4000]);
    expect(updated.archivedBudgets).toEqual(state.archivedBudgets);
    expect(accountBalance(updated)).toBe(accountBalance(state));
    const next = startNextMonth(closeMonth(updated));
    expect(line(next, "reserve").plannedCents).toBe(10001);
    expect(line(next, "reserve").openingShares.reduce((total, share) => total + share.amountCents, 0)).toBe(7001);
    expect(JSON.stringify(state)).toBe(original);
  });

  it("verrouille la programmation des mois clôturés et refuse les dates passées", () => {
    const state = envelope(household());
    const closed = closeMonth(fund(state));
    expect(() => saveLineAmount(closed, "loan", 100, "2025-12", "MONTH")).toThrow(/clôturé/);
    expect(() => removeLineAmount(closed, "loan", "2025-12", "MONTH")).toThrow(/clôturé/);
    for (const month of ["2025-10", "2025-13", "2025-1", "2025-11-01", ""]) {
      expect(() => saveLineAmount(state, "loan", 100, month, "MONTH")).toThrow();
      expect(() => removeLineAmount(state, "loan", month, "MONTH")).toThrow();
    }
    expect(() => saveLineAmount(state, "missing", 100, "2025-11", "MONTH")).toThrow(/n’existe pas/);
    expect(() => removeLineAmount(state, "missing", "2025-11", "MONTH")).toThrow(/n’existe pas/);
    expect(() => saveLineAmount(state, "loan", 100, "2025-11", "ALL" as AmountScope)).toThrow();
  });

  it("refuse les montants non entiers, négatifs, non finis ou hors limites", () => {
    const state = envelope(household());
    for (const amount of [-1, 0.5, NaN, Infinity, 1_000_000_001]) {
      expect(() => saveLineAmount(state, "loan", amount, "2025-11", "MONTH")).toThrow();
    }
    expect(line(saveLineAmount(state, "loan", 1_000_000_000, "2025-11", "MONTH")).plannedCents).toBe(1_000_000_000);
  });

  it("valide les programmations importées et leur cohérence avec le mois du budget", () => {
    const state = envelope(household(), "loan", 10000);
    const base: AmountPlan = { baseCents: 10000, changes: [], exceptions: [] };
    const plans = [
      { ...base, baseCents: -1 },
      { ...base, changes: [{ fromMonth: "2025-13", amountCents: 10000 }] },
      { ...base, exceptions: [{ month: "2025-11", amountCents: 1.5 }] },
      { ...base, changes: [{ fromMonth: "2025-12", amountCents: 20000 }, { fromMonth: "2025-12", amountCents: 20000 }] },
      { ...base, exceptions: [{ month: "2025-11", amountCents: 10000 }, { month: "2025-11", amountCents: 10000 }] },
      { ...base, exceptions: [{ month: "2025-11", amountCents: 10001 }] },
    ];
    for (const amountPlan of plans) {
      expect(() => validateState({ ...state, budget: { ...state.budget, lines: [{ ...line(state), amountPlan }] } })).toThrow();
    }
    const closed = closeMonth(fund(state));
    const next = startNextMonth(closed);
    expect(() => validateState({
      ...next,
      archivedBudgets: [{ ...closed.budget, lines: [{ ...line(closed), amountPlan: { ...base, baseCents: 10001 } }] }],
    })).toThrow(/programmation/);
  });

  it("migre les budgets v4 vers v6 sans changer les finances ni inventer une programmation", () => {
    const before = startNextMonth(closeMonth(fund(envelope(household(), "loan", 15769))));
    const legacy = JSON.parse(JSON.stringify({ ...before, version: 4 }));
    const migrated = validateState(legacy);
    expect(migrated.version).toBe(7);
    expect(migrated.budget).toEqual(before.budget);
    expect(migrated.archivedBudgets).toEqual(before.archivedBudgets);
    expect(accountBalance(migrated)).toBe(accountBalance(before));
    expect(line(migrated).amountPlan).toBeUndefined();
    expect(amountForMonth(line(migrated), "2026-12")).toBe(15769);
    expect(stateSchema.safeParse(legacy).success).toBe(false);
    expect(initialState().version).toBe(7);
  });
});
