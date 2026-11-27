import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance, budgetSummary, potSummary, today } from "./domain";
import { applyDueScheduledPayments } from "./scheduledPayments";
import { closeMonth, configureHousehold, initialState, reopenBill, reopenEnvelopeMonth, saveAdvancePayment, saveLine, savePayment, saveScheduledExpense, startNextMonth } from "./store";
import { monthOverview } from "./monthOverview";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-27T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup(kind: "FIXED" | "RESERVE" | "VARIABLE" = "FIXED", funded = true) {
  let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  s = { ...s, budget: { ...s.budget, lines: [] } };
  s = saveLine(s, { id: "bill", name: "Électricité", expenseGroup: "HOUSING", kind, plannedCents: 10000 });
  if (funded) for (const member of budgetSummary(s.budget).balances) s = savePayment(s, { id: member.id, memberId: member.id, amountCents: member.remaining, date: "2026-11-01", note: "" });
  return s;
}
const planned = { id: "planned", lineId: "bill", date: "2026-11-29", amountCents: 8500, description: "Annoncé" };
describe("traitement automatique des débits prévus", () => {
  it("projette uniquement les débits du mois sans consommer les avances du suivant", () => {
    let s = saveScheduledExpense(setup(), planned);
    s = saveScheduledExpense(s, { ...planned, id: "next", date: "2026-12-05", amountCents: 9000 });
    s = saveAdvancePayment(s, { id: "advance", memberId: s.members[0].id, amountCents: 50000, date: "2026-11-25", receivedMonth: "2026-11", month: "2026-12", note: "Avance" });
    expect(monthOverview(s)).toMatchObject({ scheduledCents: 8500, accountBalanceCents: 60000, projectedAccountBalanceCents: 51500, balanceExcludingAdvancesCents: 10000, projectedBalanceExcludingAdvancesCents: 1500 });
    vi.setSystemTime(new Date("2026-11-29T12:00:00+01:00"));
    const posted = applyDueScheduledPayments(s);
    expect(monthOverview(posted)).toMatchObject({ scheduledCents: 0, accountBalanceCents: 51500, projectedAccountBalanceCents: 51500, balanceExcludingAdvancesCents: 1500, projectedBalanceExcludingAdvancesCents: 1500 });
    expect(posted.scheduledExpenses.map(entry => entry.id)).toEqual(["next"]);
  });

  it("attend la date puis débite et clôture la facture avec un unique transfert du surplus", () => {
    const s = saveScheduledExpense(setup(), planned);
    expect(applyDueScheduledPayments(s)).toBe(s);
    expect(monthOverview(s).projectedAccountBalanceCents).toBe(1500);
    expect(monthOverview(s).accountBalanceCents).toBe(10000);
    vi.setSystemTime(new Date("2026-11-29T00:00:00+01:00"));
    const result = applyDueScheduledPayments(s);
    expect(result.scheduledExpenses).toEqual([]);
    expect(result.budget.expenses).toEqual([planned]);
    expect(accountBalance(result)).toBe(1500);
    expect(potSummary(result).availableCents).toBe(1500);
    expect(result.budget.billClosures[0]).toMatchObject({ date: "2026-11-29", amountCents: 1500 });
    expect(applyDueScheduledPayments(result, today(), [planned.id])).toBe(result);
    expect(monthOverview(result).projectedAccountBalanceCents).toBe(1500);
  });
  it("attend le dernier paiement annoncé avant de fermer la facture", () => {
    let s = saveScheduledExpense(setup(), { ...planned, amountCents: 4000, date: "2026-11-27" });
    s = saveScheduledExpense(s, { ...planned, id: "last", amountCents: 4500, date: "2026-11-29" });
    s = applyDueScheduledPayments(s);
    expect(s.budget.expenses).toHaveLength(1);
    expect(s.budget.billClosures).toEqual([]);
    expect(s.budget.lines[0].settled).toBe(false);
    expect(accountBalance(s)).toBe(6000);
    expect(monthOverview(s).projectedAccountBalanceCents).toBe(1500);
    vi.setSystemTime(new Date("2026-11-29T12:00:00+01:00"));
    s = applyDueScheduledPayments(s);
    expect(s.budget.expenses).toHaveLength(2);
    expect(s.budget.billClosures).toHaveLength(1);
    expect(potSummary(s).availableCents).toBe(1500);
  });
  it("enregistre le débit même non financé, puis clôture après réception du complément", () => {
    const s = saveScheduledExpense(setup("FIXED", false), { ...planned, date: "2026-11-27" });
    let result = applyDueScheduledPayments(s);
    expect(accountBalance(result)).toBe(-8500);
    expect(result.budget.billClosures).toEqual([]);
    for (const member of budgetSummary(result.budget).balances) result = savePayment(result, { id: member.id, memberId: member.id, amountCents: member.remaining, date: "2026-11-27", note: "Complément" });
    result = applyDueScheduledPayments(result, today(), [planned.id]);
    expect(result.budget.billClosures).toHaveLength(1);
    expect(potSummary(result).availableCents).toBe(1500);
    const reopened = reopenBill(result, "bill");
    expect(applyDueScheduledPayments(reopened, today(), [planned.id])).toBe(reopened);
  });
  it("conserve le solde d’une réserve et respecte sa réouverture manuelle", () => {
    const s = saveScheduledExpense(setup("RESERVE"), { ...planned, date: "2026-11-27" });
    const result = applyDueScheduledPayments(s);
    expect(result.budget.lines[0].monthFinished).toBe(true);
    expect(potSummary(result).availableCents).toBe(0);
    expect(budgetSummary(result.budget).reservedCents).toBe(1500);
    const reopened = reopenEnvelopeMonth(result, "bill");
    expect(applyDueScheduledPayments(reopened, today(), [planned.id])).toBe(reopened);
  });
  it("ne termine pas un budget à consommer après un seul achat et ne clôture pas le mois", () => {
    const result = applyDueScheduledPayments(saveScheduledExpense(setup("VARIABLE"), { ...planned, date: "2026-11-27" }));
    expect(result.budget.status).toBe("ACTIVE");
    expect(result.budget.billClosures).toEqual([]);
    expect(result.budget.lines[0].monthFinished).toBeUndefined();
    expect(accountBalance(result)).toBe(1500);
  });
  it("traite le mois prochain à son ouverture et rattrape un débit dans le mois budgétaire concerné", () => {
    let s = saveScheduledExpense(setup("RESERVE"), { ...planned, date: "2026-12-02" });
    s = closeMonth(s);
    vi.setSystemTime(new Date("2026-12-03T12:00:00+01:00"));
    expect(applyDueScheduledPayments(s)).toBe(s);
    s = startNextMonth(s);
    const result = applyDueScheduledPayments(s);
    expect(result.budget.expenses[0].date).toBe("2026-12-02");
    expect(result.budget.status).toBe("ACTIVE");
    expect(result.archivedBudgets[0].status).toBe("CLOSED");
  });
  it("utilise le changement de jour à Paris indépendamment du fuseau du serveur", () => {
    const s = saveScheduledExpense(setup(), { ...planned, date: "2026-11-28" });
    vi.setSystemTime(new Date("2026-11-27T22:59:59Z"));
    expect(today()).toBe("2026-11-27");
    expect(applyDueScheduledPayments(s)).toBe(s);
    vi.setSystemTime(new Date("2026-11-27T23:00:00Z"));
    expect(today()).toBe("2026-11-28");
    expect(applyDueScheduledPayments(s).budget.billClosures[0].date).toBe("2026-11-28");
  });
});
