import { describe, expect, it } from "vitest";
import { Budget, Member, budgetSummary, cents, closeBudget, sharesFor, splitAmount } from "./domain";
const members: Member[] = [{ id: "jean", name: "Jean", incomeCents: cents(2900) }, { id: "miruna", name: "Miruna", incomeCents: cents(1800) }];
const makeBudget = (planned: number, spent: number, paidJean: number, paidMiruna: number): Budget => ({ id:"x", label:"Test", status:"ACTIVE", lines:[{ id:"line", name:"Courses", plannedCents:cents(planned), allocationType:"FIFTY_FIFTY", shares:sharesFor(cents(planned),"FIFTY_FIFTY",members)}], expenses:spent ? [{id:"e",lineId:"line",amountCents:cents(spent),date:"2026-08-01",description:""}]:[], payments:[{id:"p1",memberId:"jean",amountCents:cents(paidJean),date:"2026-08-01"},{id:"p2",memberId:"miruna",amountCents:cents(paidMiruna),date:"2026-08-01"}] });
describe("répartition", () => {
  it("répartit 50/50", () => expect(sharesFor(10000,"FIFTY_FIFTY",members).map(x=>x.amountCents)).toEqual([5000,5000]));
  it("répartit au prorata des revenus", () => expect(sharesFor(150000,"PRO_RATA",members).map(x=>x.amountCents)).toEqual([92553,57447]));
  it("conserve chaque centime avec une règle déterministe", () => expect(splitAmount(100,[1,1,1],["a","b","c"])).toEqual([34,33,33]));
});
describe("clôture", () => {
  it("crée l'économie nette lorsque les contributions sont payées", () => expect(budgetSummary(makeBudget(500,420,250,250),members).transferableSurplusCents).toBe(cents(80)));
  it("plafonne le surplus à la trésorerie réelle", () => expect(budgetSummary(makeBudget(500,420,250,150),members).transferableSurplusCents).toBe(0));
  it("exclut le trop-versé personnel", () => { const s=budgetSummary(makeBudget(500,420,350,250),members); expect(s.personalOverpaymentCents).toBe(cents(100)); expect(s.transferableSurplusCents).toBe(cents(80)); });
  it("ne crée aucun surplus en cas de dépassement", () => expect(budgetSummary(makeBudget(500,560,280,280),members).transferableSurplusCents).toBe(0));
  it("est idempotente", () => { const once=closeBudget(makeBudget(500,420,250,250),members); expect(closeBudget(once,members)).toBe(once); });
});
