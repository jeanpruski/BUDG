import { Budget, Member, Project, cents, sharesFor } from "./domain";

export type SurplusEntry = { id:string; amountCents:number; label:string; date:string; type:"saving"|"allocation" };
export type IncomeEntry = { id:string; memberId:string; amountCents:number; effectiveFrom:string; createdAt:string };
export type AppState = { householdName: string; members: Member[]; incomeHistory: IncomeEntry[]; budget: Budget; surplusCents: number; projects: Project[]; surplusEntries: SurplusEntry[] };
const members: Member[] = [{ id: "jean", name: "Jean", incomeCents: cents(2900) }, { id: "miruna", name: "Miruna", incomeCents: cents(1800) }];
const definitions = [
  ["credit", "Crédit immobilier", 1500, "PRO_RATA", "HOUSING"], ["copro", "Charges de copropriété", 290, "PRO_RATA", "HOUSING"],
  ["taxe", "Taxe foncière", 191, "PRO_RATA", "HOUSING"], ["courses", "Courses", 500, "FIFTY_FIFTY", "DAILY_LIFE"],
  ["electricite", "Électricité", 100, "FIFTY_FIFTY", "DAILY_LIFE"], ["internet", "Internet", 40, "FIFTY_FIFTY", "DAILY_LIFE"]
] as const;
export const initialState: AppState = {
  householdName: "Jean & Miruna", members,
  incomeHistory: members.map(m=>({id:`income-${m.id}-2026-01`,memberId:m.id,amountCents:m.incomeCents,effectiveFrom:"2026-01",createdAt:"2026-01-01"})),
  budget: { id: "2026-08", label: "Août 2026", status: "ACTIVE", lines: definitions.map(([id, name, amount, type, expenseGroup]) => ({ id, name, plannedCents: cents(amount), allocationType: type, expenseGroup, shares: sharesFor(cents(amount), type, members) })), expenses: [
    {id:"e1",lineId:"courses",amountCents:8640,date:"2026-08-14",description:"Courses Carrefour"},{id:"e2",lineId:"electricite",amountCents:3872,date:"2026-08-12",description:"Électricité"},{id:"e3",lineId:"courses",amountCents:640,date:"2026-08-11",description:"Boulangerie"},{id:"e4",lineId:"courses",amountCents:4500,date:"2026-08-10",description:"Essence"},{id:"e5",lineId:"courses",amountCents:5260,date:"2026-08-08",description:"Restaurant"},
    {id:"e6",lineId:"credit",amountCents:150000,date:"2026-08-05",description:"Crédit immobilier"},{id:"e7",lineId:"copro",amountCents:29000,date:"2026-08-05",description:"Charges copropriété"},{id:"e8",lineId:"taxe",amountCents:19100,date:"2026-08-03",description:"Taxe foncière"},{id:"e9",lineId:"internet",amountCents:4000,date:"2026-08-02",description:"Internet"}
  ], payments: [{id:"p1",memberId:"jean",amountCents:150000,date:"2026-08-01"},{id:"p2",memberId:"miruna",amountCents:107900,date:"2026-08-01"}] },
  surplusCents: cents(1250), projects: [{id:"pr1",name:"Travaux",targetCents:cents(3000),allocatedCents:cents(500)}],
  surplusEntries: [{id:"s1",amountCents:8000,label:"Économie Courses",date:"août 2026",type:"saving"},{id:"s2",amountCents:1800,label:"Économie Électricité",date:"août 2026",type:"saving"},{id:"s3",amountCents:6500,label:"Économie Restaurants",date:"juillet 2026",type:"saving"},{id:"s4",amountCents:-50000,label:"Affectation Travaux",date:"juillet 2026",type:"allocation"}]
};
const KEY = "budg-state-v2";
export function loadState(): AppState { try { const saved=JSON.parse(localStorage.getItem(KEY) ?? "null"); if(!saved)return initialState; const housingIds=new Set(["credit","copro","taxe"]); return {...saved,incomeHistory:saved.incomeHistory??saved.members.map((m:Member)=>({id:`income-${m.id}-legacy`,memberId:m.id,amountCents:m.incomeCents,effectiveFrom:"2026-01",createdAt:new Date().toISOString()})),budget:{...saved.budget,lines:saved.budget.lines.map((l:Budget["lines"][number])=>({...l,expenseGroup:l.expenseGroup??(housingIds.has(l.id)?"HOUSING":"DAILY_LIFE")}))}}; } catch { return initialState; } }
export function saveState(state: AppState) { localStorage.setItem(KEY, JSON.stringify(state)); }
export function resetState(): AppState { localStorage.removeItem(KEY); return structuredClone(initialState); }
