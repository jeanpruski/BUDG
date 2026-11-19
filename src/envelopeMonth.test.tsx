import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { accountBalance, budgetSummary, potSummary, validateState, envelopeMonthFinished } from "./domain";
import { initialState, configureHousehold, saveLine, saveLineAmount, savePayment, saveExpense, savePotTransfer,
  finishEnvelopeMonth, reopenEnvelopeMonth, closeMonth, startNextMonth, closeBill, removePayment } from "./store";
import { EnvelopeMonthClosing } from "./EnvelopeMonthClosing";
import { Envelopes, type Actions } from "./screens";
import { monthlyReserveProvisions } from "./reserveProvisions";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-12-20T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
const summary = (s: ReturnType<typeof initialState>) => budgetSummary(s.budget);
const line = (s: ReturnType<typeof initialState>) => summary(s).lines.find(l => l.id === "loan")!;
function setup(kind: "FIXED" | "RESERVE" = "FIXED") {
  const s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  return saveLine({ ...s, budget: { ...s.budget, lines: [] } }, { id: "loan", name: "Prêt immobilier", kind, expenseGroup: "HOUSING", plannedCents: 20000 });
}
function fund(s: ReturnType<typeof initialState>) {
  for (const member of summary(s).balances) if (member.remaining > 0) s = savePayment(s, {
    id: `${s.budget.id}-${member.id}-${s.budget.payments.length}`, memberId: member.id, amountCents: member.remaining,
    date: `${s.budget.id}-01`, note: "Versement", });
  return s;
}
function spend(s: ReturnType<typeof initialState>, amountCents: number) {
  return saveExpense(s, { id: "real-payment", lineId: "loan", amountCents, date: `${s.budget.id}-02`, description: "Vrai paiement" }, false);
}
describe("suivi mensuel des réserves et reports de facture", () => {
  it.each(["FIXED", "RESERVE"] as const)("conserve 200 € sans paiement ni pot et demande bien 1000 € le mois suivant (%s)", kind => {
    const before = fund(setup(kind));
    let s = finishEnvelopeMonth(before, "loan");
    expect(envelopeMonthFinished(line(s))).toBe(true);
    expect(accountBalance(s)).toBe(accountBalance(before));
    expect(potSummary(s).availableCents).toBe(0);
    expect(s.budget.expenses).toEqual([]);
    expect(summary(s).reservedCents).toBe(20000);
    expect(summary(s).unpaidBills).toEqual([]);
    expect(finishEnvelopeMonth(s, "loan")).toEqual(s);
    s = saveLineAmount(s, "loan", 100000, "2026-12", "FROM_MONTH");
    expect(envelopeMonthFinished(line(s))).toBe(true);
    s = startNextMonth(closeMonth(s));
    expect(envelopeMonthFinished(line(s))).toBe(false);
    expect(line(s).opening).toBe(20000);
    expect(line(s).plannedCents).toBe(100000);
    expect(summary(s).missingCents).toBe(100000);
    s = fund(s);
    expect(line(s).available).toBe(120000);
    expect(monthlyReserveProvisions(summary(s)).fundedCents).toBe(100000);
    s = spend(s, 100000);
    expect(accountBalance(s)).toBe(20000);
    expect(line(s).available).toBe(20000);
    expect(potSummary(s).availableCents).toBe(0);
    const copy = JSON.parse(JSON.stringify(s));
    expect(validateState(copy)).toEqual(s);
    s = startNextMonth(closeMonth(s));
    expect(line(s).opening).toBe(20000);
    expect(summary(s).missingCents).toBe(100000);
  });
  it("revient à une facture habituelle une fois le report complètement consommé", () => {
    let s = finishEnvelopeMonth(fund(setup()), "loan");
    s = startNextMonth(closeMonth(s));
    s = spend(fund(s), 40000);
    expect(line(s).available).toBe(0);
    s = startNextMonth(closeMonth(s));
    expect(line(s).carryRemainder).toBeFalsy();
    expect(summary(s).unpaidBills).toHaveLength(1);
  });
  it("ne termine pas une provision non reçue, même si des reports sont disponibles", () => {
    expect(() => finishEnvelopeMonth(setup(), "loan")).toThrow(/entièrement/);
    const next = startNextMonth(closeMonth(finishEnvelopeMonth(fund(setup("RESERVE")), "loan")));
    expect(() => finishEnvelopeMonth(next, "loan")).toThrow(/entièrement/);
  });
  it("rouvre le suivi sans mouvement et conserve les reports déjà acquis", () => {
    const s = finishEnvelopeMonth(fund(setup()), "loan");
    const reopened = reopenEnvelopeMonth(s, "loan");
    expect(reopened.budget.expenses).toEqual([]);
    expect(line(reopened).carryRemainder).toBe(true);
    expect(summary(reopened).reservedCents).toBe(summary(s).reservedCents);
    expect(accountBalance(reopened)).toBe(20000);
    expect(potSummary(reopened).availableCents).toBe(0);
    const next = finishEnvelopeMonth(fund(startNextMonth(closeMonth(s))), "loan");
    const nextOpen = reopenEnvelopeMonth(next, "loan");
    expect(line(nextOpen).carryRemainder).toBe(true);
    expect(line(nextOpen).opening).toBe(20000);
  });
  it("un vrai paiement rouvre le suivi mais conserve la fonction de réserve", () => {
    const s = spend(finishEnvelopeMonth(fund(setup()), "loan"), 5000);
    expect(envelopeMonthFinished(line(s))).toBe(false);
    expect(line(s).available).toBe(15000);
    expect(summary(s).reservedCents).toBe(15000);
    expect(() => closeBill(s, "loan")).toThrow(/Terminer/);
    const underfunded = removePayment(finishEnvelopeMonth(fund(setup("RESERVE")), "loan"), "2026-11-jean-0");
    expect(envelopeMonthFinished(line(underfunded))).toBe(false);
  });
  it("ne libère jamais au pot le solde d’un renfort réservé et conserve sa provenance", () => {
    let s = setup("RESERVE");
    s = saveLine(s, { id: "seed", name: "Courses", plannedCents: 20000, expenseGroup: "DAILY_LIFE", kind: "VARIABLE" });
    s = startNextMonth(closeMonth(fund(s)));
    s = savePotTransfer(s, { id: "topup", lineId: "loan", amountCents: 10000, date: "2026-12-01", note: "Renfort" });
    s = finishEnvelopeMonth(fund(s), "loan");
    expect(line(s).available).toBe(50000);
    expect(potSummary(s).availableCents).toBe(10000);
    s = startNextMonth(closeMonth(s));
    expect(line(s).opening).toBe(50000);
    expect(line(s).openingPotCents).toBe(10000);
    expect(summary(s).missingCents).toBe(40000);
  });
  it("bloque les mois clôturés et les types incohérents, migre V7 sans inventer de report", () => {
    const before = fund(setup());
    const legacy = { ...before, version: 7 };
    const migrated = validateState(legacy);
    expect(migrated.version).toBe(8);
    expect(migrated.budget).toEqual(before.budget);
    expect(() => validateState({ ...before, budget: { ...before.budget, lines: before.budget.lines.map(l => ({ ...l, kind: "VARIABLE", carryRemainder: true })) } })).toThrow(/report ponctuel/);
    const closed = closeMonth(finishEnvelopeMonth(before, "loan"));
    expect(() => reopenEnvelopeMonth(closed, "loan")).toThrow(/clôturé/);
    expect(() => finishEnvelopeMonth(closed, "loan")).toThrow(/clôturé/);
  });
  it("affiche un statut vert en fin de groupe et réserve les boutons à l’éditeur", () => {
    let s = finishEnvelopeMonth(fund(setup("RESERVE")), "loan");
    s = saveLine(s, { id: "other", name: "Autre réserve", plannedCents: 0, expenseGroup: "HOUSING", kind: "RESERVE" });
    const actions = { finishEnvelopeMonth: vi.fn(), reopenEnvelopeMonth: vi.fn() } as unknown as Actions;
    const html = renderToStaticMarkup(<EnvelopeMonthClosing budget={s.budget} line={line(s)} actions={actions} readOnly />);
    expect(html).toContain("Terminé pour ce mois");
    expect(html).not.toContain("<button");
    const all = renderToStaticMarkup(<Envelopes budget={s.budget} actions={actions} readOnly />);
    expect(all.indexOf("Autre réserve")).toBeLessThan(all.indexOf("Prêt immobilier"));
    expect(all).toContain("envelope-closed");
    expect(renderToStaticMarkup(<EnvelopeMonthClosing budget={setup().budget} line={line(setup())} actions={actions} />)).toContain("disabled");
  });
});
