import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000);
const id = z.string().min(1);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide");
const memberSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  incomeCents: money,
});
const shareSchema = z.object({ memberId: id, amountCents: money });
const lineSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  plannedCents: money,
  expenseGroup: z.enum(["HOUSING", "DAILY_LIFE"]),
  kind: z.enum(["FIXED", "VARIABLE", "RESERVE"]),
  allocationType: z.enum(["PRO_RATA", "FIFTY_FIFTY", "CUSTOM"]),
  customPercentages: z
    .array(z.object({ memberId: id, percent: z.number().min(0).max(100) }))
    .length(2)
    .optional(),
  shares: z.array(shareSchema).length(2),
  openingShares: z.array(shareSchema).length(2),
  settled: z.boolean(),
  dueDay: z.number().int().min(1).max(31).optional(),
});
const expenseSchema = z.object({
  id,
  lineId: id,
  amountCents: money.positive(),
  date: dateSchema,
  description: z.string().trim().max(200),
});
const paymentSchema = z.object({
  id,
  memberId: id,
  amountCents: money.positive(),
  date: dateSchema,
  note: z.string().trim().max(200),
});
const refundSchema = z.object({
  memberId: id,
  amountCents: money,
  paidOn: dateSchema.optional(),
});
const potExpenseSchema = z.object({
  id,
  amountCents: money.positive(),
  date: dateSchema,
  description: z.string().trim().min(1).max(200),
});
const budgetSchema = z.object({
  id: monthSchema,
  label: z.string(),
  status: z.enum(["ACTIVE", "CLOSED"]),
  members: z.array(memberSchema).length(2),
  lines: z.array(lineSchema),
  expenses: z.array(expenseSchema),
  payments: z.array(paymentSchema),
  // Already executed transfers from the previous version are preserved as history.
  refunds: z.array(refundSchema),
  closedPotCents: money.default(0),
  closedAt: z.string().optional(),
});
export const stateSchema = z.object({
  version: z.literal(4),
  revision: z.number().int().nonnegative(),
  configured: z.boolean(),
  members: z.array(memberSchema).length(2),
  incomeHistory: z.array(
    z.object({ memberId: id, amountCents: money, effectiveFrom: monthSchema }),
  ),
  budget: budgetSchema,
  archivedBudgets: z.array(budgetSchema),
  potExpenses: z.array(potExpenseSchema),
});
export type Member = z.infer<typeof memberSchema>;
export type Share = z.infer<typeof shareSchema>;
export type BudgetLine = z.infer<typeof lineSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type PotExpense = z.infer<typeof potExpenseSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type AppState = z.infer<typeof stateSchema>;
export type AllocationType = BudgetLine["allocationType"];
export type ExpenseGroup = BudgetLine["expenseGroup"];
export type LineKind = BudgetLine["kind"];

export const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    n / 100,
  );
export const cents = (n: number) => Math.round(n * 100);
export function parseMoney(
  value: FormDataEntryValue | string | null,
  allowZero = false,
): number {
  const raw = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(raw))
    throw new Error(
      "Saisissez un montant valide, avec deux décimales maximum.",
    );
  const n = cents(Number(raw));
  if (!Number.isSafeInteger(n) || n > 1_000_000_000 || n < (allowZero ? 0 : 1))
    throw new Error(
      "Le montant doit être positif et inférieur ou égal à 10 millions d’euros.",
    );
  return n;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
export function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
}
export function splitAmount(
  amount: number,
  weights: number[],
  ids: string[],
): number[] {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error("Montant invalide");
  if (
    !weights.length ||
    weights.length !== ids.length ||
    new Set(ids).size !== ids.length ||
    weights.some((w) => !Number.isFinite(w) || w < 0)
  )
    throw new Error("Pondération invalide");
  if (amount === 0) return weights.map(() => 0);
  const total = weights.reduce((s, n) => s + n, 0);
  if (!Number.isFinite(total) || total <= 0)
    throw new Error(
      "Renseignez au moins un salaire positif pour calculer le prorata.",
    );
  const raw = weights.map((w) => amount * (w / total));
  const parts = raw.map(Math.floor);
  const order = raw
    .map((n, i) => ({ i, fraction: n - parts[i] }))
    .sort(
      (a, b) => b.fraction - a.fraction || ids[a.i].localeCompare(ids[b.i]),
    );
  const remainder = amount - parts.reduce((s, n) => s + n, 0);
  for (let i = 0; i < remainder; i++) parts[order[i % order.length].i]++;
  return parts;
}
export function allocationWeights(
  type: AllocationType,
  members: Member[],
  custom?: BudgetLine["customPercentages"],
) {
  if (type !== "CUSTOM")
    return members.map((m) => (type === "PRO_RATA" ? m.incomeCents : 1));
  if (
    !custom ||
    custom.length !== members.length ||
    new Set(custom.map((x) => x.memberId)).size !== members.length ||
    custom.some(
      (x) =>
        !members.some((m) => m.id === x.memberId) ||
        !Number.isFinite(x.percent) ||
        x.percent < 0 ||
        x.percent > 100,
    ) ||
    Math.abs(custom.reduce((n, x) => n + x.percent, 0) - 100) > 0.000001
  )
    throw new Error(
      "Les pourcentages doivent totaliser 100 % pour les deux personnes.",
    );
  return members.map((m) => custom.find((x) => x.memberId === m.id)!.percent);
}
export function allocationLabel(
  line: Pick<BudgetLine, "allocationType" | "customPercentages">,
) {
  return line.allocationType === "PRO_RATA"
    ? "Selon les salaires"
    : line.allocationType === "CUSTOM"
      ? "Pourcentages personnalisés"
      : "50/50";
}
export function sharesFor(
  amount: number,
  type: AllocationType,
  members: Member[],
  customPercentages?: BudgetLine["customPercentages"],
): Share[] {
  return splitAmount(
    amount,
    allocationWeights(type, members, customPercentages),
    members.map((m) => m.id),
  ).map((n, i) => ({ memberId: members[i].id, amountCents: n }));
}
const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);
const owned = (shares: Share[], memberId: string) =>
  shares.find((s) => s.memberId === memberId)?.amountCents ?? 0;
export function budgetSummary(budget: Budget) {
  const members = budget.members;
  const ids = members.map((m) => m.id);
  const expected = Object.fromEntries(
    ids.map((id) => [id, sum(budget.lines.map((l) => owned(l.shares, id)))]),
  );
  const paid = Object.fromEntries(
    ids.map((id) => [
      id,
      sum(
        budget.payments
          .filter((p) => p.memberId === id)
          .map((p) => p.amountCents),
      ),
    ]),
  );
  // A partial contribution funds all envelopes proportionally; it is never assumed received.
  const funding = Object.fromEntries(
    ids.map((id) => [
      id,
      budget.lines.length
        ? splitAmount(
            Math.min(paid[id], expected[id]),
            budget.lines.map((l) => owned(l.shares, id)),
            budget.lines.map((l) => l.id),
          )
        : [],
    ]),
  );
  const lines = budget.lines.map((line, index) => {
    const spent = sum(
      budget.expenses
        .filter((e) => e.lineId === line.id)
        .map((e) => e.amountCents),
    );
    const capacityShares = ids.map(
      (id) => owned(line.shares, id) + owned(line.openingShares, id),
    );
    const opening = sum(line.openingShares.map((s) => s.amountCents));
    const capacity = line.plannedCents + opening;
    const weights =
      capacity > 0
        ? capacityShares
        : allocationWeights(
            line.allocationType,
            members,
            line.customPercentages,
          );
    const costs = splitAmount(spent, weights, ids);
    const reservedShares = capacityShares.map((n, i) =>
      line.kind === "RESERVE" ? Math.max(0, n - costs[i]) : 0,
    );
    const funded = opening + sum(ids.map((id) => funding[id][index]));
    return {
      ...line,
      spent,
      opening,
      capacity,
      funded,
      available: funded - spent,
      remaining: capacity - spent,
      costs,
      reservedShares,
    };
  });
  // Complements beyond the planned contribution first fund this member's overruns.
  for (const [i, memberId] of ids.entries()) {
    const deficits = lines.map((l) =>
      Math.max(
        0,
        l.costs[i] -
          owned(l.shares, memberId) -
          owned(l.openingShares, memberId),
      ),
    );
    const extra = Math.min(
      Math.max(0, paid[memberId] - expected[memberId]),
      sum(deficits),
    );
    if (extra > 0) {
      const additions = splitAmount(
        extra,
        deficits,
        lines.map((l) => l.id),
      );
      lines.forEach((l, index) => {
        l.funded += additions[index];
        l.available = l.funded - l.spent;
      });
    }
  }
  const balances = members.map((m, i) => {
    const opening = sum(budget.lines.map((l) => owned(l.openingShares, m.id)));
    const cost = sum(lines.map((l) => l.costs[i]));
    const reserved = sum(lines.map((l) => l.reservedShares[i]));
    const required = Math.max(expected[m.id], cost + reserved - opening);
    return {
      ...m,
      expected: expected[m.id],
      paid: paid[m.id],
      cost,
      reserved,
      remaining: Math.max(0, required - paid[m.id]),
      unspent: paid[m.id] + opening - cost - reserved,
    };
  });
  const spentCents = sum(lines.map((l) => l.spent));
  const refundedCents = sum(
    budget.refunds.filter((r) => r.paidOn).map((r) => r.amountCents),
  );
  const cashCents =
    sum(Object.values(paid)) +
    sum(lines.map((l) => l.opening)) -
    spentCents -
    refundedCents;
  const reservedCents = sum(lines.flatMap((l) => l.reservedShares));
  const unpaidBills = lines.filter(
    (l) => l.kind === "FIXED" && l.capacity > 0 && !l.settled,
  );
  return {
    expected,
    paid,
    lines,
    balances,
    plannedCents: sum(lines.map((l) => l.plannedCents)),
    spentCents,
    cashCents,
    reservedCents,
    unpaidBills,
    missingCents: sum(balances.map((m) => m.remaining)),
    surplusCents: Math.max(0, cashCents - reservedCents),
  };
}
export function closeBudget(budget: Budget): Budget {
  if (budget.status === "CLOSED") return budget;
  const summary = budgetSummary(budget);
  if (
    !budget.lines.some(
      (l) =>
        l.plannedCents > 0 || l.openingShares.some((s) => s.amountCents > 0),
    )
  )
    throw new Error("Préparez au moins une enveloppe avant de clôturer.");
  if (summary.unpaidBills.length)
    throw new Error(
      "Confirmez le règlement de toutes les factures avant de clôturer.",
    );
  if (summary.missingCents > 0)
    throw new Error(
      "Des versements manquent encore. Enregistrez les compléments avant de clôturer.",
    );
  return {
    ...budget,
    status: "CLOSED",
    closedAt: new Date().toISOString(),
    refunds: [],
    closedPotCents: summary.surplusCents,
  };
}
export function accountBalance(state: AppState) {
  return (
    sum(
      [state.budget, ...state.archivedBudgets].map(
        (b) =>
          sum(b.payments.map((p) => p.amountCents)) -
          sum(b.expenses.map((e) => e.amountCents)) -
          sum(b.refunds.filter((r) => r.paidOn).map((r) => r.amountCents)),
      ),
    ) - sum(state.potExpenses.map((e) => e.amountCents))
  );
}
export function potSummary(state: AppState) {
  const credits = [state.budget, ...state.archivedBudgets].filter(
    (b) => b.status === "CLOSED",
  );
  const receivedCents = sum(credits.map((b) => b.closedPotCents));
  const spentCents = sum(state.potExpenses.map((e) => e.amountCents));
  return {
    credits,
    receivedCents,
    spentCents,
    availableCents: receivedCents - spentCents,
  };
}
function migrateState(raw: unknown): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== 3
  )
    return raw;
  const legacy = stateSchema
    .extend({
      version: z.literal(3),
      potExpenses: z.array(potExpenseSchema).default([]),
    })
    .parse(raw);
  const convert = (b: Budget): Budget => {
    if (b.status !== "CLOSED") return { ...b, closedPotCents: 0 };
    const summary = budgetSummary(b);
    if (
      b.refunds.length !== 2 ||
      new Set(b.refunds.map((r) => r.memberId)).size !== 2 ||
      b.refunds.some(
        (r) =>
          r.amountCents !==
          summary.balances.find((m) => m.id === r.memberId)?.unspent,
      )
    )
      throw new Error("Ancienne clôture incohérente.");
    // Pending personal refunds now stay in the common pot; actual bank transfers stay deducted.
    return {
      ...b,
      refunds: b.refunds.filter((r) => r.paidOn),
      closedPotCents: summary.surplusCents,
    };
  };
  return {
    ...legacy,
    version: 4,
    budget: convert(legacy.budget),
    archivedBudgets: legacy.archivedBudgets.map(convert),
  };
}
export function validateState(raw: unknown): AppState {
  const s = stateSchema.parse(migrateState(raw));
  // Correct the old envelope label while preserving IDs, amounts and linked operations.
  for (const budget of [s.budget, ...s.archivedBudgets]) {
    for (const line of budget.lines) {
      if (/^taxe d[’']habitation$/i.test(line.name.trim()))
        line.name = "Taxe foncière";
    }
  }
  const ids = s.members.map((m) => m.id);
  if (new Set(ids).size !== 2)
    throw new Error("Deux membres distincts sont nécessaires.");
  const budgets = [s.budget, ...s.archivedBudgets];
  if (
    new Set(budgets.map((b) => b.id)).size !== budgets.length ||
    s.archivedBudgets.some((b) => b.status !== "CLOSED")
  )
    throw new Error("Historique des mois invalide.");
  for (const b of budgets) {
    if (
      b.members.some((m) => !ids.includes(m.id)) ||
      new Set(b.members.map((m) => m.id)).size !== 2
    )
      throw new Error("Membres du mois invalides.");
    for (const entries of [b.lines, b.expenses, b.payments])
      if (new Set(entries.map((e) => e.id)).size !== entries.length)
        throw new Error("Identifiants dupliqués.");
    for (const l of b.lines) {
      for (const shares of [l.shares, l.openingShares])
        if (
          new Set(shares.map((x) => x.memberId)).size !== 2 ||
          shares.some((x) => !ids.includes(x.memberId))
        )
          throw new Error("Répartition invalide.");
      if (sum(l.shares.map((x) => x.amountCents)) !== l.plannedCents)
        throw new Error("Répartition incohérente.");
      const computed = sharesFor(
        l.plannedCents,
        l.allocationType,
        b.members,
        l.customPercentages,
      );
      if (
        l.shares.some(
          (share) =>
            share.amountCents !==
            computed.find((x) => x.memberId === share.memberId)?.amountCents,
        )
      )
        throw new Error(
          "Les parts ne correspondent pas à la règle de répartition.",
        );
      if (l.kind !== "RESERVE" && l.openingShares.some((x) => x.amountCents))
        throw new Error("Report réservé à une enveloppe de réserve.");
    }
    if (
      b.payments.some(
        (p) => !ids.includes(p.memberId) || p.date.slice(0, 7) !== b.id,
      ) ||
      b.expenses.some(
        (e) =>
          !b.lines.some((l) => l.id === e.lineId) ||
          e.date.slice(0, 7) !== b.id,
      )
    )
      throw new Error(
        "Opération rattachée au mauvais mois ou à une enveloppe inconnue.",
      );
    if (b.status === "CLOSED") {
      const summary = budgetSummary(b);
      if (
        summary.missingCents ||
        summary.unpaidBills.length ||
        b.closedPotCents !== summary.surplusCents ||
        new Set(b.refunds.map((r) => r.memberId)).size !== b.refunds.length ||
        b.refunds.some(
          (r) =>
            !r.paidOn ||
            !ids.includes(r.memberId) ||
            r.amountCents !==
              summary.balances.find((m) => m.id === r.memberId)?.unspent,
        )
      )
        throw new Error("Clôture incohérente.");
    } else if (b.refunds.length || b.closedPotCents)
      throw new Error("Affectation au pot commun avant clôture.");
  }
  if (s.incomeHistory.some((i) => !ids.includes(i.memberId)))
    throw new Error("Revenu d’un membre inconnu.");
  if (
    new Set(s.incomeHistory.map((i) => i.memberId + i.effectiveFrom)).size !==
    s.incomeHistory.length
  )
    throw new Error("Revenus dupliqués pour le même mois.");
  const chronological = [...budgets].sort((a, b) => a.id.localeCompare(b.id));
  if (chronological[chronological.length - 1].id !== s.budget.id)
    throw new Error("Le mois courant doit être le plus récent.");
  chronological.forEach((budget, index) => {
    const previous = chronological[index - 1];
    if (previous && nextMonth(previous.id) !== budget.id)
      throw new Error("Un mois manque dans l’historique.");
    const previousLines = previous ? budgetSummary(previous).lines : [];
    for (const line of budget.lines) {
      const prior = previousLines.find((l) => l.id === line.id);
      for (const share of line.openingShares) {
        const memberIndex =
          previous?.members.findIndex((m) => m.id === share.memberId) ?? -1;
        const expected =
          prior && memberIndex >= 0 ? prior.reservedShares[memberIndex] : 0;
        if (share.amountCents !== expected)
          throw new Error("Réserve reportée incohérente.");
      }
    }
    if (
      previousLines.some(
        (l) =>
          l.reservedShares.some((n) => n > 0) &&
          !budget.lines.some((current) => current.id === l.id),
      )
    )
      throw new Error("Une réserve reportée a disparu.");
  });
  if (new Set(s.potExpenses.map((e) => e.id)).size !== s.potExpenses.length)
    throw new Error("Dépenses du pot commun dupliquées.");
  if (potSummary(s).availableCents < 0)
    throw new Error("Le montant dépasse le pot commun disponible.");
  for (const expense of s.potExpenses) {
    const credits = budgets.filter(
      (b) => b.status === "CLOSED" && b.id <= expense.date.slice(0, 7),
    );
    const spending = s.potExpenses.filter((e) => e.date <= expense.date);
    if (
      sum(spending.map((e) => e.amountCents)) >
      sum(credits.map((b) => b.closedPotCents))
    )
      throw new Error(
        "Le pot commun n’était pas suffisamment alimenté à cette date.",
      );
  }
  return s;
}
