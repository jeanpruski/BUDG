import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { accountBalance, budgetSummary, potSummary, validateState } from "./domain";
import { startTrackingAtMonth, trackingStartBlockReason } from "./budgetStart";
import { TrackingStartPanel } from "./TrackingStart";
import { closeMonth, configureHousehold, initialState, saveExpense, saveLine, saveLineAmount, saveMonthlyIncomes, savePayment, startNextMonth } from "./store";

function preparation() {
  return configureHousehold(initialState("2026-10"), ["Camille", "Alex"], [300000, 200000], "2026-10");
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00+01:00")); });
afterEach(() => { vi.useRealTimers(); });

describe("premier mois de suivi après une préparation", () => {
  it("conserve la préparation et commence novembre sans créer d’activité d’octobre", () => {
    let state = saveLine(preparation(), { ...preparation().budget.lines[0], plannedCents: 100001 });
    state = saveLine(state, { ...state.budget.lines.find((line) => line.id === "vacances")!, plannedCents: 20000 });
    state = saveMonthlyIncomes(state, [301234, 202345], "2026-11");
    state = saveLineAmount(state, "credit", 0, "2026-11", "MONTH");
    const before = JSON.stringify(state);
    const next = startTrackingAtMonth(state, "2026-11");
    expect(next.budget.id).toBe("2026-11");
    expect(next.budget.label).toBe("novembre 2026");
    expect(next.budget.members.map((member) => member.incomeCents)).toEqual([301234, 202345]);
    expect(next.budget.lines.map((line) => [line.id, line.name, line.allocationType, line.amountPlan])).toEqual(
      state.budget.lines.map((line) => [line.id, line.name, line.allocationType, line.amountPlan]),
    );
    expect(next.budget.lines[0].plannedCents).toBe(0);
    expect(next.budget.payments).toEqual([]);
    expect(next.budget.expenses).toEqual([]);
    expect(next.budget.lines.every((line) => line.openingShares.every((share) => share.amountCents === 0))).toBe(true);
    expect(next.archivedBudgets).toEqual([]);
    expect(accountBalance(next)).toBe(0);
    expect(potSummary(next).availableCents).toBe(0);
    expect(budgetSummary(next.budget).paid).toEqual({ jean: 0, miruna: 0 });
    expect(JSON.stringify(state)).toBe(before);
    expect(validateState(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("refuse les opérations réelles, même si elles se compensent", () => {
    const state = saveLine(preparation(), { ...preparation().budget.lines[0], plannedCents: 10000 });
    const withPayment = savePayment(state, { id: "p", memberId: "jean", amountCents: 10000, date: "2026-10-01", note: "Reçu" });
    const withBoth = saveExpense(withPayment, { id: "e", lineId: "credit", amountCents: 10000, date: "2026-10-02", description: "Payé" }, true);
    expect(accountBalance(withBoth)).toBe(0);
    expect(() => startTrackingAtMonth(withBoth, "2026-11")).toThrow(/opérations/);
    expect(() => startTrackingAtMonth(withPayment, "2026-11")).toThrow(/opérations/);
    expect(() => startTrackingAtMonth(saveExpense(state, { id: "e", lineId: "credit", amountCents: 1000, date: "2026-10-01", description: "Payé" }, true), "2026-11")).toThrow(/opérations/);
  });
  it("refuse de déplacer un mois clôturé ou un suivi avec archives et réserve", () => {
    let state = saveLine(preparation(), { ...preparation().budget.lines.find((line) => line.id === "vacances")!, plannedCents: 10000 });
    for (const member of state.members) state = savePayment(state, { id: member.id, memberId: member.id, amountCents: 5000, date: "2026-10-01", note: "Reçu" });
    const closed = closeMonth(state);
    expect(() => startTrackingAtMonth(closed, "2026-11")).toThrow(/déjà commencé/);
    expect(() => startTrackingAtMonth(startNextMonth(closed), "2026-12")).toThrow(/déjà commencé/);
    const invalidOpening = { ...preparation(), budget: { ...preparation().budget, lines: [{ ...preparation().budget.lines[0], openingShares: [{ memberId: "jean", amountCents: 1 }, { memberId: "miruna", amountCents: 0 }] }] } };
    expect(trackingStartBlockReason(invalidOpening)).toMatch(/réserve/);
  });
  it("refuse les dates identiques, antérieures, futures et invalides", () => {
    for (const month of ["2026-10", "2026-09", "2026-12", "2026-13", "2026-11-01", ""]) {
      expect(() => startTrackingAtMonth(preparation(), month)).toThrow();
    }
    expect(() => startTrackingAtMonth(initialState("2026-10"), "2026-11")).toThrow(/foyer/);
  });
  it("propose le démarrage uniquement à l’éditeur avant le premier mois suivi", () => {
    const render = (state = preparation(), readOnly = false) => renderToStaticMarkup(<TrackingStartPanel state={state} open={() => {}} readOnly={readOnly} />);
    expect(render()).toContain("Démarrer le suivi en novembre 2026");
    expect(render(preparation(), true)).toBe("");
    expect(render(startTrackingAtMonth(preparation(), "2026-11"))).toBe("");
    expect(render(savePayment(preparation(), { id: "p", memberId: "jean", amountCents: 1, date: "2026-10-01", note: "Reçu" }))).toBe("");
  });
});
