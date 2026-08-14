export type AllocationType = "PRO_RATA" | "FIFTY_FIFTY" | "CUSTOM" | "PERSONAL";
export type BudgetStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type Member = { id: string; name: string; incomeCents: number };
export type Share = { memberId: string; amountCents: number };
export type BudgetLine = { id: string; name: string; plannedCents: number; allocationType: AllocationType; shares: Share[] };
export type Expense = { id: string; lineId: string; amountCents: number; date: string; description: string };
export type Payment = { id: string; memberId: string; amountCents: number; date: string };
export type Project = { id: string; name: string; targetCents?: number; allocatedCents: number };
export type Budget = { id: string; label: string; status: BudgetStatus; lines: BudgetLine[]; expenses: Expense[]; payments: Payment[]; closedSurplusCents?: number };

export function splitAmount(amountCents: number, weights: number[], stableIds: string[]): number[] {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("Montant invalide");
  if (weights.length === 0 || weights.length !== stableIds.length || weights.some((w) => w < 0) || weights.every((w) => w === 0)) throw new Error("Pondération invalide");
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (amountCents * w) / total);
  const parts = raw.map(Math.floor);
  let remainder = amountCents - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((value, i) => ({ i, fraction: value - parts[i], id: stableIds[i] }))
    .sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  for (let i = 0; i < remainder; i++) parts[order[i].i]++;
  return parts;
}

export function sharesFor(amountCents: number, type: AllocationType, members: Member[], custom?: Record<string, number>, personalId?: string): Share[] {
  const active = members.filter((m) => m.incomeCents >= 0);
  const weights = type === "PRO_RATA" ? active.map((m) => m.incomeCents)
    : type === "FIFTY_FIFTY" ? active.map(() => 1)
    : type === "CUSTOM" ? active.map((m) => custom?.[m.id] ?? 0)
    : active.map((m) => m.id === personalId ? 1 : 0);
  return splitAmount(amountCents, weights, active.map((m) => m.id)).map((amount, i) => ({ memberId: active[i].id, amountCents: amount }));
}

export function budgetSummary(budget: Budget, members: Member[]) {
  const plannedCents = budget.lines.reduce((s, l) => s + l.plannedCents, 0);
  const spentCents = budget.expenses.reduce((s, e) => s + e.amountCents, 0);
  const expected = Object.fromEntries(members.map((m) => [m.id, budget.lines.reduce((s, l) => s + (l.shares.find((x) => x.memberId === m.id)?.amountCents ?? 0), 0)]));
  const paid = Object.fromEntries(members.map((m) => [m.id, budget.payments.filter((p) => p.memberId === m.id).reduce((s, p) => s + p.amountCents, 0)]));
  const personalOverpaymentCents = members.reduce((s, m) => s + Math.max(0, paid[m.id] - expected[m.id]), 0);
  const cashCents = Object.values(paid).reduce((s, n) => s + n, 0) - spentCents;
  const budgetSavingCents = Math.max(0, plannedCents - spentCents);
  const transferableSurplusCents = Math.max(0, Math.min(budgetSavingCents, cashCents - personalOverpaymentCents));
  return { plannedCents, spentCents, expected, paid, personalOverpaymentCents, cashCents, budgetSavingCents, transferableSurplusCents };
}

export function closeBudget(budget: Budget, members: Member[]): Budget {
  if (budget.status === "CLOSED") return budget;
  const summary = budgetSummary(budget, members);
  return { ...budget, status: "CLOSED", closedSurplusCents: summary.transferableSurplusCents };
}

export const cents = (euros: number) => Math.round(euros * 100);
export const euro = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value / 100);
