import { Budget, Member, Project, cents, sharesFor } from "./domain";

export type AppState = { householdName: string; members: Member[]; budget: Budget; surplusCents: number; projects: Project[] };
const members: Member[] = [{ id: "jean", name: "Jean", incomeCents: cents(2900) }, { id: "miruna", name: "Miruna", incomeCents: cents(1800) }];
const definitions = [
  ["credit", "Crédit immobilier", 1500, "PRO_RATA"], ["copro", "Charges de copropriété", 290, "PRO_RATA"],
  ["taxe", "Taxe foncière", 191, "PRO_RATA"], ["courses", "Courses", 500, "FIFTY_FIFTY"],
  ["electricite", "Électricité", 100, "FIFTY_FIFTY"], ["internet", "Internet", 40, "FIFTY_FIFTY"]
] as const;
export const initialState: AppState = {
  householdName: "Jean & Miruna", members,
  budget: { id: "2026-08", label: "Août 2026", status: "ACTIVE", lines: definitions.map(([id, name, amount, type]) => ({ id, name, plannedCents: cents(amount), allocationType: type, shares: sharesFor(cents(amount), type, members) })), expenses: [], payments: [] },
  surplusCents: cents(1250), projects: []
};
const KEY = "budg-state-v1";
export function loadState(): AppState { try { return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? initialState; } catch { return initialState; } }
export function saveState(state: AppState) { localStorage.setItem(KEY, JSON.stringify(state)); }
