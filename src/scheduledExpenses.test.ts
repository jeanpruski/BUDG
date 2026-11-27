import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance, budgetSummary, potSummary, validateState } from "./domain";
import { closeBill, closeMonth, configureHousehold, confirmScheduledExpense, finishEnvelopeMonth, initialState, removeLine, removeScheduledExpense, saveExpense, saveLine, savePayment, saveScheduledExpense, setSettled, startNextMonth } from "./store";
import { monthOverview } from "./monthOverview";
import { nextMonthForecast } from "./futureBudget";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-27T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup(kind: "FIXED" | "RESERVE" = "FIXED") {
  let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  s = { ...s, budget: { ...s.budget, lines: [] } };
  s = saveLine(s, { id: "bill", name: "Électricité", kind, expenseGroup: "HOUSING", plannedCents: 10000 });
  for (const member of budgetSummary(s.budget).balances) s = savePayment(s, { id: member.id, memberId: member.id, amountCents: member.remaining, date: "2026-11-01", note: "" });
  return s;
}
const input = { id: "planned", lineId: "bill", amountCents: 9000, date: "2026-11-29", description: "Prélèvement annoncé" };
describe("paiements prévus", () => {
  it("accepte une date future sans compter une dépense ni diminuer le solde bancaire", () => {
    const before = setup(), after = saveScheduledExpense(before, input);
    expect(after.scheduledExpenses[0]).toEqual({ ...input, month: "2026-11", createdMonth: "2026-11" });
    expect(after.budget).toEqual(before.budget);
    expect(budgetSummary(after.budget)).toEqual(budgetSummary(before.budget));
    expect(accountBalance(after)).toBe(10000);
    expect(monthOverview(after).spentCents).toBe(0);
    expect(potSummary(after).availableCents).toBe(0);
  });
  it("confirme le montant et la date réels une seule fois, même si le débit est passé plus tôt", () => {
    const pending = saveScheduledExpense(setup(), input);
    let s = confirmScheduledExpense(pending, input.id, { ...input, date: "2026-11-27", amountCents: 8500 }, true);
    expect(s.scheduledExpenses).toEqual([]);
    expect(s.budget.expenses).toHaveLength(1);
    expect(s.budget.expenses[0]).toMatchObject({ date: "2026-11-27", amountCents: 8500 });
    expect(accountBalance(s)).toBe(1500);
    expect(monthOverview(s).spentCents).toBe(8500);
    expect(() => confirmScheduledExpense(s, input.id, { ...input, date: "2026-11-27" }, true)).toThrow(/n’existe plus/);
    s = closeBill(s, "bill");
    expect(potSummary(s).availableCents).toBe(1500);
    expect(accountBalance(s)).toBe(1500);
  });
  it("refuse de transformer un débit futur en paiement déjà passé", () => {
    const s = saveScheduledExpense(setup(), input);
    expect(() => confirmScheduledExpense(s, input.id, input, true)).toThrow(/paiement réel/);
    expect(() => saveExpense(setup(), input, true)).toThrow(/paiement réel/);
    expect(() => validateState({ ...setup(), budget: { ...setup().budget, expenses: [input] } })).toThrow();
    expect(s.scheduledExpenses).toHaveLength(1);
  });
  it("garde la facture ouverte tant qu’un autre paiement reste prévu", () => {
    let s = saveScheduledExpense(setup(), { ...input, amountCents: 4000 });
    s = saveScheduledExpense(s, { ...input, id: "second", amountCents: 6000 });
    s = confirmScheduledExpense(s, input.id, { ...input, amountCents: 4000, date: "2026-11-27" }, true);
    expect(s.budget.lines[0].settled).toBe(false);
    expect(() => setSettled(s, "bill", true)).toThrow(/prévu/);
    expect(() => closeBill(s, "bill")).toThrow();
    s = confirmScheduledExpense(s, "second", { ...input, id: "second", amountCents: 6000, date: "2026-11-27" }, true);
    expect(s.budget.lines[0].settled).toBe(true);
    expect(accountBalance(s)).toBe(0);
  });
  it("peut prévoir le mois prochain sur une facture déjà clôturée, puis conserver le paiement à l’ouverture", () => {
    let s = closeBill(saveExpense(setup(), { ...input, id: "paid", date: "2026-11-02", amountCents: 10000 }, true), "bill");
    const original = s.budget;
    s = saveScheduledExpense(s, { ...input, date: "2026-12-05" });
    expect(s.budget).toEqual(original);
    expect(nextMonthForecast(s).scheduledExpenses).toHaveLength(1);
    expect(nextMonthForecast(s).plannedCents).toBe(10000);
    s = startNextMonth(closeMonth(s));
    expect(s.scheduledExpenses[0].date).toBe("2026-12-05");
    expect(s.budget.expenses).toEqual([]);
    expect(accountBalance(s)).toBe(0);
    vi.setSystemTime(new Date("2026-12-06T12:00:00+01:00"));
    for (const member of budgetSummary(s.budget).balances) s = savePayment(s, { id: "dec-"+member.id, memberId: member.id, amountCents: member.remaining, date: "2026-12-01", note: "" });
    s = confirmScheduledExpense(s, input.id, { ...input, date: "2026-12-05" }, true);
    expect(accountBalance(s)).toBe(1000);
    expect(s.archivedBudgets[0]).toEqual({ ...original, status: "CLOSED", closedAt: s.archivedBudgets[0].closedAt, closedOrder: s.archivedBudgets[0].closedOrder });
  });
  it("permet de corriger, reporter ou annuler un paiement prévu sans mouvement bancaire", () => {
    let s = saveScheduledExpense(setup(), input);
    expect(() => closeMonth(s)).toThrow(/paiements encore prévus/);
    s = saveScheduledExpense(s, { ...input, amountCents: 8800, date: "2026-12-01" });
    expect(s.scheduledExpenses).toHaveLength(1);
    expect(s.scheduledExpenses[0].amountCents).toBe(8800);
    expect(accountBalance(s)).toBe(10000);
    s = removeScheduledExpense(s, input.id);
    expect(accountBalance(s)).toBe(10000);
    expect(s.scheduledExpenses).toEqual([]);
  });
  it("préserve aussi les réserves et empêche une clôture mensuelle prématurée", () => {
    const s = saveScheduledExpense(finishEnvelopeMonth(setup("RESERVE"), "bill"), input);
    expect(s.budget.lines[0].monthFinished).toBe(false);
    expect(() => finishEnvelopeMonth(s, "bill")).toThrow(/prévu/);
    expect(() => closeMonth(s)).toThrow(/paiements encore prévus/);
    expect(budgetSummary(s.budget).reservedCents).toBe(10000);
  });
  it("peut corriger une dépense saisie à tort comme payée en la remettant dans les prévisions", () => {
    const paid = saveExpense(setup(), { ...input, date: "2026-11-20" }, true);
    expect(accountBalance(paid)).toBe(1000);
    const planned = saveScheduledExpense(paid, input);
    expect(planned.budget.expenses).toEqual([]);
    expect(planned.budget.lines[0].settled).toBe(false);
    expect(planned.scheduledExpenses).toHaveLength(1);
    expect(accountBalance(planned)).toBe(10000);
  });
  it("valide les références et les dates et migre V9 sans inventer de paiement", () => {
    const s = saveScheduledExpense(setup(), input);
    expect(() => removeLine(s, "bill")).toThrow();
    expect(() => saveScheduledExpense(s, { ...input, lineId: "unknown" })).toThrow();
    expect(() => saveScheduledExpense(s, { ...input, date: "2027-01-01" })).toThrow(/mois prochain/);
    expect(() => validateState({ ...s, scheduledExpenses: [...s.scheduledExpenses, s.scheduledExpenses[0]] })).toThrow(/dupliqués/);
    const legacy = { ...setup(), version: 9, scheduledExpenses: undefined };
    const migrated = validateState(legacy);
    expect(migrated.version).toBe(10);
    expect(migrated.budget).toEqual(legacy.budget);
    expect(migrated.scheduledExpenses).toEqual([]);
  });
});
