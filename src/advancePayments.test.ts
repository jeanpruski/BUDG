import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { accountBalance, advanceSummary, budgetSummary, potSummary, reservedAdvanceCents, validateState } from "./domain";
import { initialState, configureHousehold, saveLine, savePayment, saveAdvancePayment, removeAdvancePayment,
  useAdvance, removeAdvanceUse, savePotExpense, removePotExpense, closeMonth, startNextMonth, saveLineAmount, saveMonthlyIncomes, removePayment } from "./store";
import { nextMonthForecast } from "./futureBudget";
import { monthOverview } from "./monthOverview";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-12-20T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup() {
  let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  s = { ...s, budget: { ...s.budget, lines: [] } };
  s = saveLine(s, { id: "daily", name: "Courses", kind: "VARIABLE", expenseGroup: "DAILY_LIFE", plannedCents: 100000 });
  s = saveLine(s, { id: "tax", name: "Taxe", kind: "RESERVE", expenseGroup: "HOUSING", plannedCents: 10000 });
  for (const person of budgetSummary(s.budget).balances) s = savePayment(s, { id: person.id, memberId: person.id, amountCents: person.remaining, date: "2026-11-01", note: "Novembre" });
  return s;
}
function advance(s = setup(), amountCents = 50000) {
  return saveAdvancePayment(s, { id: "early", memberId: "jean", amountCents, receivedMonth: "2026-11", month: "2026-12", date: "2026-11-05", note: "Salaire reçu tôt" });
}
describe("versements anticipés et prévision", () => {
  it("accepte une réception avant le 25 sans financer ni modifier les statistiques du mois courant", () => {
    const before = setup(), after = advance(before);
    expect(after.budget).toEqual(before.budget);
    expect(budgetSummary(after.budget)).toEqual(budgetSummary(before.budget));
    expect(monthOverview(after).spentCents).toBe(monthOverview(before).spentCents);
    expect(potSummary(after)).toEqual(potSummary(before));
    expect(accountBalance(after)).toBe(accountBalance(before) + 50000);
    expect(reservedAdvanceCents(after)).toBe(50000);
    expect(accountBalance(after) - reservedAdvanceCents(after)).toBe(accountBalance(before));
  });
  it("ne compte jamais un salaire programmé comme de l’argent reçu", () => {
    const before = setup(), after = saveMonthlyIncomes(before, [301234, 201111], "2026-12");
    expect(accountBalance(after)).toBe(accountBalance(before));
    expect(reservedAdvanceCents(after)).toBe(0);
    const forecast = nextMonthForecast(after);
    expect(forecast.preparedIncomes).toBe(true);
    expect(forecast.members.map((m) => m.incomeCents)).toEqual([301234, 201111]);
    expect(forecast.members.reduce((sum, m) => sum + m.expectedCents, 0)).toBe(110000);
  });
  it("utilise les exceptions, les nouvelles répartitions et la totalité de la provision des réserves", () => {
    let s = advance();
    s = saveLineAmount(s, "daily", 120000, "2026-12", "MONTH");
    s = saveMonthlyIncomes(s, [400000, 100000], "2026-12");
    const forecast = nextMonthForecast(s);
    expect(forecast.plannedPaymentsCents).toBe(120000);
    expect(forecast.plannedReservesCents).toBe(10000);
    expect(forecast.members[0].expectedCents).toBe(60000 + 8000);
    expect(forecast.members[0].remainingCents).toBe(18000);
    expect(forecast.members[0].personalRemainderCents).toBe(400000 - 68000);
    expect(budgetSummary(s.budget).plannedCents).toBe(110000);
  });
  it("réaffecte 50 € au pot sans mouvement bancaire puis conserve 450 € pour le mois suivant", () => {
    let s = advance(); const bank = accountBalance(s);
    s = useAdvance(s, { id: "use", advanceId: "early", amountCents: 5000, date: "2026-11-10", note: "Imprévu" });
    expect(accountBalance(s)).toBe(bank);
    expect(potSummary(s).availableCents).toBe(5000);
    expect(advanceSummary(s).availableCents).toBe(45000);
    expect(budgetSummary(s.budget).paid.jean).toBe(56000);
    s = savePotExpense(s, { id: "real", date: "2026-11-10", amountCents: 5000, description: "Achat réel" });
    expect(monthOverview(s).spentCents).toBe(5000);
    expect(accountBalance(s)).toBe(bank - 5000);
    const forecast = nextMonthForecast(s);
    expect(forecast.members[0]).toMatchObject({ advanceCents: 50000, usedCents: 5000, availableCents: 45000, remainingCents: 11000, personalRemainderCents: 239000 });
    s = startNextMonth(closeMonth(s));
    expect(s.budget.payments).toEqual([{ id: "advance:early", advanceId: "early", memberId: "jean", amountCents: 45000, date: "2026-11-05", note: "Salaire reçu tôt" }]);
    expect(accountBalance(s)).toBe(bank - 5000);
    expect(reservedAdvanceCents(s)).toBe(0);
    expect(budgetSummary(s.budget).balances[0].remaining).toBe(11000);
    expect(s.archivedBudgets[0].payments).toHaveLength(2);
    expect(validateState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(() => removePayment(s, "advance:early")).toThrow(/historique/);
  });
  it("peut alimenter directement une enveloppe via le pot et rendre une utilisation non dépensée", () => {
    let s = advance(); const bank = accountBalance(s);
    s = useAdvance(s, { id: "use", advanceId: "early", amountCents: 5000, date: "2026-11-10", note: "Courses" }, "daily");
    expect(accountBalance(s)).toBe(bank);
    expect(potSummary(s).availableCents).toBe(0);
    expect(budgetSummary(s.budget).lines.find((line) => line.id === "daily")?.potAddedCents).toBe(5000);
    expect(() => removeAdvanceUse(s, "use")).toThrow(/pot commun/);
    expect(() => removeAdvancePayment(s, "early")).toThrow(/Rendez/);
  });
  it("refuse les utilisations excessives, antidatées ou futures et les avances inventées", () => {
    const s = advance();
    for (const override of [{ amountCents: 50001 }, { date: "2026-11-04" }, { date: "2026-12-21" }, { advanceId: "unknown" }])
      expect(() => useAdvance(s, { id: "bad", advanceId: "early", amountCents: 5000, date: "2026-11-10", note: "", ...override })).toThrow();
    expect(() => saveAdvancePayment(s, { ...s.advancePayments[0], amountCents: 1, date: "2026-12-21" })).toThrow();
    expect(() => validateState({ ...s, budget: { ...s.budget, payments: [...s.budget.payments, { id: "fake", advanceId: "early", memberId: "jean", amountCents: 50000, date: "2026-11-05", note: "" }] } })).toThrow();
  });
  it("peut annuler un retrait si le pot n’a pas dépensé cet argent", () => {
    let s = useAdvance(advance(), { id: "use", advanceId: "early", amountCents: 5000, date: "2026-11-10", note: "" });
    const bank = accountBalance(s);
    s = savePotExpense(s, { id: "expense", amountCents: 5000, date: "2026-11-10", description: "Réel" });
    expect(() => removeAdvanceUse(s, "use")).toThrow();
    s = removeAdvanceUse(removePotExpense(s, "expense"), "use");
    expect(reservedAdvanceCents(s)).toBe(50000);
    expect(accountBalance(s)).toBe(bank);
    expect(potSummary(s).availableCents).toBe(0);
  });
  it("reprend une avance intégralement utilisée sans paiement nul ni double comptage", () => {
    let s = useAdvance(advance(), { id: "use", advanceId: "early", amountCents: 50000, date: "2026-11-10", note: "" });
    const bank = accountBalance(s);
    s = startNextMonth(closeMonth(s));
    expect(s.budget.payments).toEqual([]);
    expect(accountBalance(s)).toBe(bank);
    expect(potSummary(s).advanceUsedCents).toBe(50000);
    expect(() => saveAdvancePayment(s, { ...s.advancePayments[0], amountCents: 60000 })).toThrow();
  });
  it("gère décembre vers janvier, les deux personnes et les anciennes sauvegardes sans inventer d’avance", () => {
    let s = startNextMonth(closeMonth(setup()));
    s = saveAdvancePayment(s, { id: "jan", memberId: "miruna", receivedMonth: "2026-12", month: "2027-01", date: "2026-12-01", amountCents: 30000, note: "" });
    expect(nextMonthForecast(s).month).toBe("2027-01");
    expect(nextMonthForecast(s).members[1].availableCents).toBe(30000);
    const legacy = { ...setup(), version: 8, advancePayments: undefined, advanceUses: undefined };
    const migrated = validateState(legacy);
    expect(migrated.version).toBe(9);
    expect(migrated.advancePayments).toEqual([]);
    expect(migrated.budget).toEqual(legacy.budget);
  });
});
