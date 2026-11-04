import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance, budgetSummary, closeBudget, potSummary, validateState, type AppState, type BudgetLine, type PotTransfer } from "./domain";
import {
  closeMonth, configureHousehold, initialState, removeLine, removePotTransfer, resetState,
  saveExpense, saveLine, saveLineAmount, savePayment, savePotExpense, savePotTransfer, startNextMonth,
} from "./store";
import { trackingStartBlockReason } from "./budgetStart";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T12:00:00+01:00")); });
afterEach(() => { vi.useRealTimers(); });
function household(month = "2026-08") {
  const state = configureHousehold(initialState(month), ["Camille", "Alex"], [300000, 200000], month);
  return { ...state, budget: { ...state.budget, lines: [] } };
}
function envelope(state: AppState, id: string, plannedCents: number, kind: BudgetLine["kind"] = "VARIABLE", expenseGroup: BudgetLine["expenseGroup"] = "DAILY_LIFE") {
  return saveLine(state, { id, name: id, plannedCents, kind, expenseGroup });
}
function fund(state: AppState) {
  for (const member of budgetSummary(state.budget).balances)
    if (member.remaining) state = savePayment(state, {
      id: `pay-${state.budget.payments.length}`, memberId: member.id,
      amountCents: member.remaining, date: `${state.budget.id}-01`, note: "Versement réel",
    });
  return state;
}
function spend(state: AppState, lineId: string, amountCents: number, settled = false) {
  return saveExpense(state, { id: `expense-${state.budget.expenses.length}`, lineId, amountCents, date: `${state.budget.id}-02`, description: "Achat réel" }, settled);
}
function withPot(amountCents = 50000, reserveCents = 0, month = "2026-08") {
  let state = envelope(household(month), "seed", amountCents);
  if (reserveCents) state = envelope(state, "target", reserveCents, "RESERVE");
  return removeLine(startNextMonth(closeMonth(fund(state))), "seed");
}
function transfer(state: AppState, amountCents: number, id = "transfer-1", lineId = "target", date = `${state.budget.id}-01`) {
  return savePotTransfer(state, { id, lineId, amountCents, date, note: "Renfort ponctuel" });
}
const line = (state: AppState, id = "target") => budgetSummary(state.budget).lines.find((entry) => entry.id === id)!;

describe("renfort d’une enveloppe depuis le pot commun", () => {
  it("ajoute 200 € aux 100 € reportés et aux 600 € mensuels sans changer les versements demandés ni la banque", () => {
    let state = saveLineAmount(withPot(50000, 10000), "target", 60000, "2026-09", "FROM_MONTH");
    const expected = budgetSummary(state.budget).expected;
    const before = accountBalance(state);
    state = transfer(state, 20000);
    expect(accountBalance(state)).toBe(before);
    expect(potSummary(state)).toMatchObject({ availableCents: 30000, transferredCents: 20000 });
    expect(budgetSummary(state.budget)).toMatchObject({ expected, missingCents: 60000, potTransferredCents: 20000 });
    expect(line(state)).toMatchObject({ opening: 10000, openingPotCents: 0, potAddedCents: 20000, capacity: 90000, funded: 30000, available: 30000 });
    expect(state.budget.payments).toEqual([]); expect(state.budget.expenses).toEqual([]); expect(state.potExpenses).toEqual([]);
    state = fund(state);
    expect(line(state).available).toBe(90000);
    expect(state.budget.lines[0].plannedCents).toBe(60000);
    expect(accountBalance(state)).toBe(120000);
  });
  it("consomme d’abord la capacité personnelle puis le renfort commun sans attribuer ce dernier aux personnes", () => {
    let state = fund(transfer(saveLineAmount(withPot(50000, 10000), "target", 60000, "2026-09", "FROM_MONTH"), 20000));
    state = spend(state, "target", 75000);
    expect(line(state)).toMatchObject({ costs: [35000, 35000], potSpentCents: 5000, reservedShares: [0, 0], reservedPotCents: 15000, available: 15000 });
    expect(budgetSummary(state.budget).missingCents).toBe(0);
    const bank = accountBalance(state);
    state = closeMonth(state);
    expect(state.budget.closedPotCents).toBe(0);
    expect(accountBalance(state)).toBe(bank);
    expect(bank).toBe(potSummary(state).availableCents + budgetSummary(state.budget).reservedCents);
    state = startNextMonth(state);
    expect(state.budget.potTransfers).toEqual([]);
    expect(line(state)).toMatchObject({ opening: 15000, openingPotCents: 15000, potAddedCents: 0, funded: 15000, capacity: 75000 });
    expect(state.budget.lines[0].openingShares.map((share) => share.amountCents)).toEqual([0, 0]);
    expect(potSummary(state).availableCents).toBe(30000);
    expect(budgetSummary(state.budget).missingCents).toBe(60000);
  });
  it.each(["VARIABLE", "FIXED"] as const)("rend uniquement le renfort non dépensé au pot à la clôture d’une enveloppe %s", (kind) => {
    let state = fund(transfer(envelope(withPot(), "target", 60000, kind), 20000));
    state = spend(state, "target", 65000, true);
    expect(line(state)).toMatchObject({ costs: [30000, 30000], potSpentCents: 5000, reservedPotCents: 0 });
    expect(budgetSummary(state.budget).missingCents).toBe(0);
    state = closeMonth(state);
    expect(state.budget.closedPotCents).toBe(15000);
    expect(potSummary(state).availableCents).toBe(45000);
    expect(accountBalance(state)).toBe(45000);
    expect(closeMonth(state)).toEqual(state);
    expect(potSummary(closeMonth(state)).availableCents).toBe(45000);
    state = startNextMonth(state);
    expect(line(state).openingPotCents).toBe(0);
  });
  it("finance personnellement uniquement le dépassement au-delà des deux sources", () => {
    let state = fund(transfer(saveLineAmount(withPot(50000, 10000), "target", 60000, "2026-09", "FROM_MONTH"), 20000));
    state = spend(state, "target", 100000);
    expect(line(state)).toMatchObject({ costs: [40000, 40000], potSpentCents: 20000, available: -10000 });
    expect(budgetSummary(state.budget).missingCents).toBe(10000);
    expect(() => closeMonth(state)).toThrow(/versements/);
    state = closeMonth(fund(state));
    expect(accountBalance(state)).toBe(30000); expect(potSummary(state).availableCents).toBe(30000);
    expect(budgetSummary(state.budget).reservedCents).toBe(0);
  });
  it("conserve une réserve commune seule même avec une provision mensuelle à zéro", () => {
    let state = transfer(envelope(withPot(), "target", 0, "RESERVE"), 20000);
    state = startNextMonth(closeMonth(state));
    expect(line(state)).toMatchObject({ openingPotCents: 20000, funded: 20000, reservedPotCents: 20000, costs: [0, 0] });
    state = spend(state, "target", 5000);
    expect(line(state)).toMatchObject({ potSpentCents: 5000, reservedPotCents: 15000, costs: [0, 0] });
    state = startNextMonth(closeMonth(state));
    expect(line(state).openingPotCents).toBe(15000);
    expect(accountBalance(state)).toBe(potSummary(state).availableCents + line(state).available);
    expect(validateState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("préserve la provenance commune malgré un changement de salaires et de répartition", () => {
    let state = transfer(envelope(withPot(), "target", 10000, "RESERVE", "HOUSING"), 20000);
    state = configureHousehold(state, ["Camille", "Alex"], [100000, 400000], "2026-09");
    expect(state.budget.lines[0].shares.map((share) => share.amountCents)).toEqual([2000, 8000]);
    state = startNextMonth(closeMonth(spend(fund(state), "target", 15000)));
    expect(line(state).openingPotCents).toBe(15000);
    expect(state.budget.lines[0].openingShares.map((share) => share.amountCents)).toEqual([0, 0]);
    expect(potSummary(state).transferredCents).toBe(20000);
    expect(budgetSummary(state.budget).missingCents).toBe(10000);
  });
  it("additionne plusieurs transferts et conserve la banque et les réserves après plusieurs mois", () => {
    let state = envelope(withPot(), "target", 20000, "RESERVE");
    state = transfer(transfer(state, 12345, "first"), 6789, "second");
    expect(line(state).potAddedCents).toBe(19134);
    state = spend(fund(state), "target", 23001);
    state = startNextMonth(closeMonth(state));
    state = spend(fund(state), "target", 11003);
    state = closeMonth(state);
    expect(accountBalance(state)).toBe(potSummary(state).availableCents + budgetSummary(state.budget).reservedCents);
    expect(potSummary(state).transferredCents).toBe(19134);
  });
});

describe("annulation, protections et validation des transferts", () => {
  it("annule un renfort disponible et trace une correction sans créer de versement", () => {
    const before = envelope(withPot(), "target", 10000);
    let state = transfer(before, 20000);
    state = savePotTransfer(state, { ...state.budget.potTransfers[0], amountCents: 15000, note: "Corrigé" });
    expect(state.budget.potTransfers).toHaveLength(1); expect(line(state).potAddedCents).toBe(15000);
    expect(potSummary(state).availableCents).toBe(35000);
    state = removePotTransfer(state, "transfer-1");
    expect(state).toEqual(before);
    expect(accountBalance(state)).toBe(accountBalance(before));
  });
  it("refuse d’annuler ou déplacer une somme dépensée, permet de réduire le reliquat disponible", () => {
    let state = transfer(envelope(envelope(withPot(), "target", 10000), "other", 0), 20000);
    state = spend(fund(state), "target", 25000);
    expect(line(state).available).toBe(5000);
    expect(() => removePotTransfer(state, "transfer-1")).toThrow(/déjà été dépensé/);
    expect(() => savePotTransfer(state, { ...state.budget.potTransfers[0], lineId: "other" })).toThrow(/déjà été dépensé/);
    expect(() => savePotTransfer(state, { ...state.budget.potTransfers[0], amountCents: 10000 })).toThrow(/déjà été dépensé/);
    state = savePotTransfer(state, { ...state.budget.potTransfers[0], amountCents: 15000 });
    expect(line(state).available).toBe(0); expect(budgetSummary(state.budget).missingCents).toBe(0);
  });
  it("protège les enveloppes et reports communs, et verrouille les mois clôturés", () => {
    let state = transfer(envelope(withPot(), "target", 0, "RESERVE"), 20000);
    expect(() => removeLine(state, "target")).toThrow();
    expect(() => saveLine(state, { ...state.budget.lines[0], kind: "VARIABLE" })).toThrow(/pot commun/);
    state = closeMonth(state);
    expect(() => transfer(state, 1)).toThrow(/clôturé/);
    expect(() => removePotTransfer(state, "transfer-1")).toThrow(/clôturé/);
    state = startNextMonth(state);
    expect(() => removeLine(state, "target")).toThrow();
    expect(() => saveLine(state, { ...state.budget.lines[0], kind: "VARIABLE" })).toThrow(/réserve reportée/);
    const reset = resetState(state);
    expect(reset.budget.lines[0].openingPotCents).toBe(0); expect(reset.budget.potTransfers).toEqual([]);
  });
  it("refuse montant, date, référence et identifiants invalides ainsi qu’un financement futur", () => {
    const state = envelope(withPot(), "target", 0, "RESERVE");
    for (const amount of [0, -1, 0.5, NaN, Infinity, 50001]) expect(() => transfer(state, amount)).toThrow();
    for (const date of ["2026-09-31", "2026-08-01", "2050-09-01"]) expect(() => transfer(state, 1000, "t", "target", date)).toThrow();
    expect(() => transfer(state, 1000, "", "target")).toThrow();
    expect(() => transfer(state, 1000, "t", "missing")).toThrow();
    expect(() => removePotTransfer(state, "missing")).toThrow(/n’existe pas/);
    const funded = transfer(state, 1000);
    expect(() => validateState({ ...funded, budget: { ...funded.budget, potTransfers: [...funded.budget.potTransfers, ...funded.budget.potTransfers] } })).toThrow(/dupliqués/);
    const future = envelope(withPot(50000, 0, "2026-10"), "target", 0, "RESERVE");
    expect(() => transfer(future, 1000, "future", "target", "2026-11-05")).toThrow(/futur/);
  });
  it("valide la continuité des reports communs et refuse leur disparition", () => {
    const state = startNextMonth(closeMonth(transfer(envelope(withPot(), "target", 0, "RESERVE"), 20000)));
    expect(() => validateState({ ...state, budget: { ...state.budget, lines: [{ ...state.budget.lines[0], openingPotCents: 1 }] } })).toThrow(/commune reportée/);
    expect(() => validateState({ ...state, budget: { ...state.budget, lines: [] } })).toThrow(/réserve reportée a disparu/);
    expect(() => validateState({ ...state, budget: { ...state.budget, lines: [{ ...state.budget.lines[0], kind: "VARIABLE" }] } })).toThrow(/Report réservé/);
  });
  it("empêche qu’un transfert soit financé par le surplus qu’il crée à sa propre clôture", () => {
    const state = fund(envelope(household(), "target", 60000));
    const forged: PotTransfer = { id: "circular", lineId: "target", amountCents: 10000, date: "2026-08-01", note: "Boucle" };
    const closed = closeBudget({ ...state.budget, potTransfers: [forged] });
    expect(closed.closedPotCents).toBe(70000);
    expect(() => validateState({ ...state, budget: closed })).toThrow(/mois précédents/);
  });
  it("déduit ensemble les achats du pot et les transferts sans rejeter un achat après clôture le même jour", () => {
    let state = transfer(fund(envelope(withPot(10000), "target", 10000)), 10000);
    state = closeMonth(state);
    expect(potSummary(state).availableCents).toBe(20000);
    state = savePotExpense(state, { id: "after-close", amountCents: 20000, date: "2026-09-01", description: "Après clôture" });
    expect(potSummary(state).availableCents).toBe(0);
    expect(accountBalance(state)).toBe(0);
    expect(validateState(state)).toEqual(state);
  });
  it("refuse de réutiliser les crédits d’un mois ultérieur pour financer un ancien transfert", () => {
    let state = withPot(10000);
    state = savePotExpense(state, { id: "earlier", amountCents: 5000, date: "2026-08-31", description: "Ancien achat" });
    state = fund(envelope(state, "target", 10000));
    const forged = closeBudget({ ...state.budget, potTransfers: [{ id: "overdraft", lineId: "target", amountCents: 6000, date: "2026-09-01", note: "" }] });
    expect(() => validateState({ ...state, budget: forged })).toThrow(/mois précédents/);
  });
  it("bloque le déplacement du démarrage si un transfert ou un report commun existe", () => {
    const state = envelope(household(), "target", 0, "RESERVE");
    expect(trackingStartBlockReason({ ...state, budget: { ...state.budget, potTransfers: [{ id: "t", lineId: "target", amountCents: 1, date: "2026-08-01", note: "" }] } })).toMatch(/opérations/);
    expect(trackingStartBlockReason({ ...state, budget: { ...state.budget, lines: [{ ...state.budget.lines[0], openingPotCents: 1 }] } })).toMatch(/réserve/);
  });
});

describe("migration et conservation des anciens budgets", () => {
  it.each([4, 5])("migre la version %i avec renforts et reports communs à zéro sans modifier les montants", (version) => {
    const current = withPot(50000, 10000);
    const raw = JSON.parse(JSON.stringify({ ...current, version }));
    for (const budget of [raw.budget, ...raw.archivedBudgets]) {
      delete budget.potTransfers;
      for (const line of budget.lines) delete line.openingPotCents;
    }
    const migrated = validateState(raw);
    expect(migrated.version).toBe(6); expect(migrated.budget.potTransfers).toEqual([]);
    expect(migrated.budget.lines.every((line) => line.openingPotCents === 0)).toBe(true);
    expect(accountBalance(migrated)).toBe(accountBalance(current));
    expect(potSummary(migrated).availableCents).toBe(potSummary(current).availableCents);
    expect(migrated.budget.lines[0].openingShares).toEqual(current.budget.lines[0].openingShares);
    expect(validateState(migrated)).toEqual(migrated);
  });
});
