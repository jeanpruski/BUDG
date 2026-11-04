import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance, budgetSummary, potSummary, validateState, type AppState, type BudgetLine } from "./domain";
import {
  closeBill, closeMonth, configureHousehold, initialState, removeExpense, removeLine, removePayment,
  removePotTransfer, reopenBill, saveExpense, saveLine, saveLineAmount, savePayment,
  savePotExpense, savePotTransfer, setSettled, startNextMonth,
} from "./store";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup() {
  const state = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  return { ...state, budget: { ...state.budget, lines: [] } };
}
function line(state: AppState, id = "bill", amountCents = 10000, kind: BudgetLine["kind"] = "FIXED") {
  return saveLine(state, { id, name: id, plannedCents: amountCents, kind, expenseGroup: "HOUSING" });
}
function fund(state: AppState) {
  for (const member of budgetSummary(state.budget).balances)
    if (member.remaining) state = savePayment(state, { id: `payment-${state.budget.payments.length}`, memberId: member.id, amountCents: member.remaining, date: `${state.budget.id}-01`, note: "" });
  return state;
}
function spend(state: AppState, id = "bill", amountCents = 8000) {
  return saveExpense(state, { id: `expense-${state.budget.expenses.length}`, lineId: id, amountCents, date: `${state.budget.id}-02`, description: "Facture réelle" }, false);
}
const info = (state: AppState, id = "bill") => budgetSummary(state.budget).lines.find((entry) => entry.id === id)!;
function balanced(state: AppState) {
  const summary = budgetSummary(state.budget);
  expect(accountBalance(state)).toBe(potSummary(state).availableCents + (state.budget.status === "CLOSED" ? summary.reservedCents : summary.cashCents));
}

describe("clôture anticipée d’une facture", () => {
  it("libère 20 € réellement financés immédiatement et garde la provision du mois", () => {
    const before = spend(fund(line(setup())));
    const state = closeBill(before, "bill");
    expect(state.budget.status).toBe("ACTIVE");
    expect(info(state)).toMatchObject({ plannedCents: 10000, funded: 10000, spent: 8000, available: 0, releasedToPotCents: 2000 });
    expect(potSummary(state)).toMatchObject({ receivedCents: 2000, availableCents: 2000, billReleasedCents: 2000 });
    expect(state.budget.payments).toEqual(before.budget.payments);
    expect(state.budget.expenses).toEqual(before.budget.expenses);
    expect(accountBalance(state)).toBe(accountBalance(before));
    expect(closeBill(state, "bill")).toBe(state);
    balanced(state);
  });
  it("n’accorde jamais un crédit déjà financé par le même crédit dans un cycle", () => {
    const state = closeBill(spend(fund(line(setup()))), "bill");
    const closure = state.budget.billClosures[0];
    expect(() => validateState({ ...state, budget: { ...state.budget, billClosures: [{ ...closure, fundingShares: closure.fundingShares.map((share) => ({ ...share, amountCents: 0 })) }] } })).toThrow(/entièrement financée/);
    expect(() => validateState({ ...state, budget: { ...state.budget, billClosures: [{ ...closure, amountCents: 20000 }] } })).toThrow(/surplus libéré/);
  });
  it("réemploie le crédit dans une réserve du même mois et ne le crédite pas deux fois à la clôture", () => {
    let state = closeBill(spend(fund(line(line(setup()), "vacances", 0, "RESERVE"))), "bill");
    state = savePotTransfer(state, { id: "reuse", lineId: "vacances", amountCents: 2000, date: "2026-11-04", note: "Surplus facture" });
    expect(potSummary(state).availableCents).toBe(0);
    expect(info(state, "vacances").available).toBe(2000);
    state = closeMonth(state);
    expect(state.budget.closedPotCents).toBe(0);
    expect(potSummary(state).availableCents).toBe(0);
    balanced(state);
    state = startNextMonth(state);
    expect(info(state, "vacances").openingPotCents).toBe(2000);
    expect(state.budget.billClosures).toEqual([]);
    expect(state.budget.closedOrder).toBe(0);
    balanced(state);
  });
  it("rend le crédit une seule fois au pot si la seconde enveloppe ne le dépense pas", () => {
    let state = closeBill(spend(fund(line(line(setup()), "courses", 0, "VARIABLE"))), "bill");
    state = savePotTransfer(state, { id: "reuse", lineId: "courses", amountCents: 2000, date: "2026-11-04", note: "" });
    state = closeMonth(state);
    expect(state.budget.closedPotCents).toBe(2000);
    expect(potSummary(state).availableCents).toBe(2000);
    expect(accountBalance(state)).toBe(2000);
    balanced(state);
  });
  it("refuse la clôture de 100 € prévus lorsque seulement 80 € ont été financés et payés", () => {
    let state = line(setup());
    state = savePayment(state, { id: "a", memberId: "jean", amountCents: 4800, date: "2026-11-01", note: "" });
    state = savePayment(state, { id: "b", memberId: "miruna", amountCents: 3200, date: "2026-11-01", note: "" });
    state = spend(state);
    expect(info(state).available).toBe(0);
    expect(() => closeBill(state, "bill")).toThrow(/Financez entièrement/);
    expect(potSummary(state).availableCents).toBe(0);
  });
  it("accepte une clôture sans surplus et un dépassement entièrement financé", () => {
    let state = fund(spend(fund(line(setup())), "bill", 12000));
    state = closeBill(state, "bill");
    expect(state.budget.billClosures[0].amountCents).toBe(0);
    expect(info(state).fundedShares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(12000);
    expect(potSummary(state).availableCents).toBe(0);
    balanced(closeMonth(state));
    const zero = closeBill(line(setup(), "zero", 0), "zero");
    expect(zero.budget.billClosures[0].amountCents).toBe(0);
  });
  it("permet de changer autres provisions et salaires sans retirer le financement figé", () => {
    let state = closeBill(spend(fund(line(line(setup()), "other", 10000, "VARIABLE"))), "bill");
    const frozen = structuredClone(state.budget.billClosures[0]);
    state = saveLineAmount(state, "other", 20000, "2026-11", "MONTH");
    state = configureHousehold(state, ["Camille", "Alex"], [100000, 400000], "2026-11");
    expect(state.budget.billClosures[0]).toEqual(frozen);
    expect(info(state).funded).toBe(10000);
    expect(info(state).available).toBe(0);
    expect(info(state).shares).toEqual(frozen.plannedShares);
    expect(potSummary(state).availableCents).toBe(2000);
    state = saveLineAmount(state, "bill", 15000, "2026-12", "FROM_MONTH");
    expect(info(state).plannedCents).toBe(10000);
    expect(() => saveLineAmount(state, "bill", 15000, "2026-11", "MONTH")).toThrow(/clôturée/);
    balanced(state);
  });
  it("fige aussi le coût par personne d’une facture initialement prévue à zéro", () => {
    let state = closeBill(fund(spend(line(setup(), "bill", 0), "bill", 10000)), "bill");
    expect(info(state).costs).toEqual([6000, 4000]);
    state = configureHousehold(state, ["Camille", "Alex"], [100000, 400000], "2026-11");
    expect(info(state).costs).toEqual([6000, 4000]);
    expect(info(state).fundedShares.map((share) => share.amountCents)).toEqual([6000, 4000]);
    balanced(state);
  });
  it("demande un complément pour un dépassement d’une autre enveloppe sans réutiliser le surplus libéré", () => {
    let state = closeBill(spend(fund(line(line(setup()), "other", 10000, "VARIABLE"))), "bill");
    state = spend(state, "other", 12000);
    expect(budgetSummary(state.budget).missingCents).toBe(2000);
    expect(info(state).funded).toBe(10000);
    expect(info(state, "other").available).toBe(-2000);
    state = fund(state);
    expect(info(state, "other").available).toBe(0);
    balanced(closeMonth(state));
  });
  it("conserve les 600 € dus à une nouvelle enveloppe après une facture financée à 120 € pour 100 € prévus", () => {
    let state = closeBill(fund(spend(fund(line(setup())), "bill", 12000)), "bill");
    state = line(state, "next-bill", 60000);
    expect(budgetSummary(state.budget).plannedCents).toBe(70000);
    expect(budgetSummary(state.budget).missingCents).toBe(60000);
    // A total of 700 € received still leaves 20 € of the new bill unfunded.
    state = savePayment(state, { id: "partial-a", memberId: "jean", amountCents: 34800, date: "2026-11-04", note: "" });
    state = savePayment(state, { id: "partial-b", memberId: "miruna", amountCents: 23200, date: "2026-11-04", note: "" });
    expect(state.budget.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(70000);
    expect(budgetSummary(state.budget).missingCents).toBe(2000);
    expect(info(state, "next-bill").funded).toBe(58000);
    expect(() => closeBill(state, "next-bill")).toThrow(/Financez entièrement/);
    state = fund(state);
    expect(info(state, "next-bill").funded).toBe(60000);
    expect(budgetSummary(state.budget).missingCents).toBe(0);
    balanced(closeBill(state, "next-bill"));
  });
});

describe("réouverture et intégrité du journal", () => {
  it("rouvre une facture en rendant l’argent depuis le pot, puis autorise sa correction", () => {
    const before = spend(fund(line(setup())));
    let state = closeBill(before, "bill");
    state = reopenBill(state, "bill");
    expect(state.budget.billClosures[0].reopened!.order).toBeGreaterThan(state.budget.billClosures[0].order);
    expect(potSummary(state)).toMatchObject({ availableCents: 0, billReopenedCents: 2000, billReleasedCents: 0 });
    expect(info(state).available).toBe(2000);
    state = saveExpense(state, { ...state.budget.expenses[0], amountCents: 9000 }, true);
    state = closeBill(state, "bill");
    expect(potSummary(state).availableCents).toBe(1000);
    expect(state.budget.billClosures).toHaveLength(2);
    balanced(state);
  });
  it("refuse de rouvrir quand le pot est vide et le permet après un vrai réapprovisionnement", () => {
    let state = closeBill(spend(fund(line(line(line(setup()), "bill2", 0), "reserve", 0, "RESERVE"))), "bill");
    state = savePotTransfer(state, { id: "reuse", lineId: "reserve", amountCents: 2000, date: "2026-11-04", note: "" });
    expect(() => reopenBill(state, "bill")).toThrow(/pot commun doit pouvoir rendre/);
    state = saveLineAmount(state, "bill2", 10000, "2026-11", "MONTH");
    state = closeBill(spend(fund(state), "bill2"), "bill2");
    expect(potSummary(state).availableCents).toBe(2000);
    state = reopenBill(state, "bill");
    expect(potSummary(state).availableCents).toBe(0);
    expect(info(state).available).toBe(2000);
    expect(info(state, "reserve").available).toBe(2000);
    balanced(state);
  });
  it("rouvre aussi après un changement de salaires et reprend la répartition courante", () => {
    let state = closeBill(spend(fund(line(setup()))), "bill");
    state = configureHousehold(state, ["Camille", "Alex"], [100000, 400000], "2026-11");
    expect(info(state).shares.map((share) => share.amountCents)).toEqual([6000, 4000]);
    state = reopenBill(state, "bill");
    expect(info(state).shares.map((share) => share.amountCents)).toEqual([2000, 8000]);
    expect(potSummary(state).availableCents).toBe(0);
    expect(info(state).billClosure).toBeNull();
    balanced(state);
  });
  it("verrouille dépenses, versements nécessaires et transferts d’une facture close", () => {
    const state = closeBill(spend(fund(line(setup()))), "bill");
    expect(() => saveExpense(state, { ...state.budget.expenses[0], description: "Correction" }, true)).toThrow(/facture est clôturée/);
    expect(() => removeExpense(state, state.budget.expenses[0].id)).toThrow(/facture est clôturée/);
    expect(() => removePayment(state, state.budget.payments[0].id)).toThrow(/financent déjà/);
    expect(() => setSettled(state, "bill", false)).toThrow(/facture est clôturée/);
    expect(() => removeLine(state, "bill")).toThrow();
    expect(() => savePotTransfer(state, { id: "extra", lineId: "bill", amountCents: 100, date: "2026-11-04", note: "" })).toThrow(/facture est clôturée/);
    const closed = closeMonth(state);
    expect(() => reopenBill(closed, "bill")).toThrow(/mois est clôturé/);
    expect(() => closeBill(line(setup(), "reserve", 10000, "RESERVE"), "reserve")).toThrow(/Seule une facture/);
  });
  it("refuse un crédit futur, un montant inventé et un ordre comptable dupliqué", () => {
    const state = closeBill(spend(fund(line(setup()))), "bill");
    const closure = state.budget.billClosures[0];
    expect(() => validateState({ ...state, budget: { ...state.budget, billClosures: [{ ...closure, date: "2026-11-05" }] } })).toThrow();
    expect(() => validateState({ ...state, budget: { ...state.budget, billClosures: [{ ...closure, amountCents: 5000 }] } })).toThrow(/surplus libéré/);
    const spent = savePotExpense(state, { id: "pot", amountCents: 1000, date: "2026-11-04", description: "Achat" });
    expect(() => validateState({ ...spent, potExpenses: [{ ...spent.potExpenses[0], order: closure.order }] })).toThrow(/dupliqués/);
  });
  it("garde un compteur monotone après annulation et un JSON V7 réimportable", () => {
    let state = closeBill(spend(fund(line(line(setup()), "reserve", 0, "RESERVE"))), "bill");
    state = savePotTransfer(state, { id: "t", lineId: "reserve", amountCents: 1000, date: "2026-11-04", note: "" });
    const oldOrder = state.budget.potTransfers[0].order;
    state = removePotTransfer(state, "t");
    state = savePotTransfer(state, { id: "new", lineId: "reserve", amountCents: 1000, date: "2026-11-04", note: "" });
    expect(state.budget.potTransfers[0].order).toBeGreaterThan(oldOrder);
    expect(validateState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("interdit de placer un crédit du nouveau mois avant la clôture du mois précédent", () => {
    vi.setSystemTime(new Date("2026-12-04T12:00:00+01:00"));
    let state = startNextMonth(closeMonth(fund(line(setup(), "seed", 10000, "VARIABLE"))));
    state = line(state, "bill", 10000);
    state = closeBill(spend(fund(state)), "bill");
    const closure = state.budget.billClosures[0];
    const archived = state.archivedBudgets[0];
    const forged = {
      ...state,
      archivedBudgets: [{ ...archived, closedOrder: closure.order }],
      budget: { ...state.budget, billClosures: [{ ...closure, order: archived.closedOrder }] },
    };
    expect(() => validateState(forged)).toThrow(/avant l’ouverture/);
  });
  it("migre V6 sans clôturer automatiquement une ancienne facture déjà marquée réglée", () => {
    let state = setSettled(spend(fund(line(setup()))), "bill", true);
    state = savePotExpense(closeMonth(state), { id: "past", amountCents: 1000, date: "2026-11-04", description: "Achat" });
    const raw = JSON.parse(JSON.stringify(state));
    raw.version = 6;
    delete raw.potSequence;
    for (const budget of [raw.budget, ...raw.archivedBudgets]) { delete budget.billClosures; delete budget.closedOrder; for (const transfer of budget.potTransfers) delete transfer.order; }
    for (const expense of raw.potExpenses) delete expense.order;
    const migrated = validateState(raw);
    expect(migrated.version).toBe(7);
    expect(migrated.budget.billClosures).toEqual([]);
    expect(migrated.budget.lines[0].settled).toBe(true);
    expect(migrated.budget.closedPotCents).toBe(state.budget.closedPotCents);
    expect(accountBalance(migrated)).toBe(accountBalance(state));
    expect(potSummary(migrated).availableCents).toBe(1000);
  });
});
