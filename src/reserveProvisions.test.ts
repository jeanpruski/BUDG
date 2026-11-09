import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance, budgetSummary, type AppState, type BudgetLine } from "./domain";
import { monthOverview } from "./monthOverview";
import { monthlyReserveProvisions } from "./reserveProvisions";
import {
  closeBill, closeMonth, configureHousehold, initialState, removeLine, reopenBill,
  saveExpense, saveLine, saveLineAmount, savePayment, savePotTransfer, startNextMonth,
} from "./store";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());

function household(month = "2026-11") {
  const state = configureHousehold(initialState(month), ["Camille", "Alex"], [300000, 200000], month);
  return { ...state, budget: { ...state.budget, lines: [] } };
}
function envelope(state: AppState, id: string, amount: number, kind: BudgetLine["kind"] = "RESERVE", expenseGroup: BudgetLine["expenseGroup"] = "DAILY_LIFE") {
  return saveLine(state, { id, name: id, plannedCents: amount, kind, expenseGroup });
}
function pay(state: AppState, memberId: string, amountCents: number) {
  return savePayment(state, { id: `p-${state.budget.payments.length}`, memberId, amountCents, date: `${state.budget.id}-01`, note: "Versement reçu" });
}
function fund(state: AppState) {
  for (const member of budgetSummary(state.budget).balances)
    if (member.remaining) state = pay(state, member.id, member.remaining);
  return state;
}
function spend(state: AppState, lineId: string, amountCents: number) {
  return saveExpense(state, { id: `e-${state.budget.expenses.length}`, lineId, amountCents, date: `${state.budget.id}-02`, description: "Achat réel" }, true);
}
function withOpening(potCents = 0) {
  let state = envelope(household("2026-10"), "vacances", 30000);
  if (potCents) state = envelope(state, "seed-pot", potCents, "VARIABLE");
  state = startNextMonth(closeMonth(fund(state)));
  if (potCents) state = removeLine(state, "seed-pot");
  return saveLineAmount(state, "vacances", 10000, "2026-11", "FROM_MONTH");
}
const provision = (state: AppState) => monthlyReserveProvisions(budgetSummary(state.budget));

describe("provisions personnelles des réserves reçues ce mois", () => {
  it("distingue 300 € reportés des 100 € nouvellement versés", () => {
    const before = withOpening();
    expect(provision(before)).toEqual({ fundedCents: 0, availableCents: 30000, lines: [{ id: "vacances", name: "vacances", fundedCents: 0 }] });
    const state = fund(before);
    expect(provision(state)).toEqual({ fundedCents: 10000, availableCents: 40000, lines: [{ id: "vacances", name: "vacances", fundedCents: 10000 }] });
    expect(accountBalance(state)).toBe(40000);
    expect(monthOverview(state).spentCents).toBe(0);
  });

  it("compte uniquement la part des versements partiels réellement affectée aux réserves", () => {
    let state = envelope(withOpening(), "courses", 10000, "VARIABLE");
    state = pay(state, "jean", 5000);
    expect(provision(state)).toEqual({ fundedCents: 2500, availableCents: 32500, lines: [{ id: "vacances", name: "vacances", fundedCents: 2500 }] });
    expect(budgetSummary(state.budget).lines.find((line) => line.id === "courses")!.funded).toBe(2500);
  });

  it("exclut les renforts venant du pot et leur report commun au mois suivant", () => {
    let state = withOpening(50000);
    state = savePotTransfer(state, { id: "top-up", lineId: "vacances", amountCents: 20000, date: "2026-11-09", note: "Depuis le pot" });
    expect(provision(state)).toMatchObject({ fundedCents: 0, availableCents: 50000 });
    state = fund(state);
    expect(provision(state)).toMatchObject({ fundedCents: 10000, availableCents: 60000 });
    state = startNextMonth(closeMonth(state));
    expect(state.budget.lines[0].openingPotCents).toBe(20000);
    expect(provision(state)).toMatchObject({ fundedCents: 0, availableCents: 60000 });
  });

  it("conserve les 100 € de provision après un achat et compte la dépense réelle une seule fois", () => {
    const funded = fund(withOpening());
    const before = accountBalance(funded);
    const state = spend(funded, "vacances", 25000);
    expect(provision(state)).toMatchObject({ fundedCents: 10000, availableCents: 15000 });
    expect(accountBalance(state)).toBe(before - 25000);
    expect(monthOverview(state).spentCents).toBe(25000);
    expect(budgetSummary(state.budget).spentCents).toBe(25000);
    expect(provision(closeMonth(state)).fundedCents).toBe(10000);
  });

  it("plafonne les compléments par personne sans masquer une provision encore sous-financée", () => {
    let state = envelope(household(), "taxe", 10000, "RESERVE", "HOUSING");
    state = spend(state, "taxe", 20000);
    state = pay(pay(state, "jean", 12000), "miruna", 2000);
    const summary = budgetSummary(state.budget);
    expect(summary.lines[0].fundedShares.map((share) => share.amountCents)).toEqual([12000, 2000]);
    expect(provision(state)).toEqual({ fundedCents: 8000, availableCents: -6000, lines: [{ id: "taxe", name: "taxe", fundedCents: 8000 }] });
    // Matching by member ID matters when one person has paid above their provision.
    const reordered = structuredClone(summary);
    reordered.lines[0].fundedShares.reverse();
    expect(monthlyReserveProvisions(reordered)).toEqual(provision(state));
    state = fund(state);
    expect(provision(state)).toMatchObject({ fundedCents: 10000, availableCents: 0 });
    expect(monthOverview(state).spentCents).toBe(20000);
  });

  it("inclut chaque réserve même à zéro et exclut factures et dépenses courantes", () => {
    let state = envelope(envelope(envelope(envelope(household(), "vacances", 10000), "travaux", 0), "bill", 10000, "FIXED"), "courses", 5000, "VARIABLE");
    expect(provision(state).lines).toEqual([{ id: "vacances", name: "vacances", fundedCents: 0 }, { id: "travaux", name: "travaux", fundedCents: 0 }]);
    state = fund(state);
    expect(provision(state)).toEqual({ fundedCents: 10000, availableCents: 10000, lines: [{ id: "vacances", name: "vacances", fundedCents: 10000 }, { id: "travaux", name: "travaux", fundedCents: 0 }] });
    expect(provision(household())).toEqual({ fundedCents: 0, availableCents: 0, lines: [] });
  });

  it("ne compte pas le crédit d’une facture clôturée ou sa réouverture comme nouvelle provision", () => {
    let state = fund(envelope(envelope(household(), "vacances", 10000), "bill", 10000, "FIXED"));
    state = spend(state, "bill", 8000);
    const expected = provision(state);
    state = closeBill(state, "bill");
    expect(budgetSummary(state.budget).releasedToPotCents).toBe(2000);
    expect(provision(state)).toEqual(expected);
    state = reopenBill(state, "bill");
    expect(provision(state)).toEqual(expected);
    expect(monthOverview(state).spentCents).toBe(8000);
  });

  it("ne modifie pas le résumé et borne à zéro une part de financement négative", () => {
    const summary = budgetSummary(fund(withOpening()).budget);
    const before = structuredClone(summary);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    freeze(summary);
    expect(monthlyReserveProvisions(summary).fundedCents).toBe(10000);
    expect(summary).toEqual(before);
    const negative = structuredClone(before);
    negative.lines[0].fundedShares[0].amountCents = -500;
    expect(monthlyReserveProvisions(negative).fundedCents).toBe(5000);
  });
});
