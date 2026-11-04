import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000);
const id = z.string().min(1);
const order = z.number().int().positive().safe();
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
const amountPlanSchema = z.object({
  baseCents: money,
  changes: z.array(z.object({ fromMonth: monthSchema, amountCents: money })),
  exceptions: z.array(z.object({ month: monthSchema, amountCents: money })),
}).superRefine((plan, context) => {
  if (new Set(plan.changes.map((change) => change.fromMonth)).size !== plan.changes.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Montants habituels dupliqués pour le même mois." });
  if (new Set(plan.exceptions.map((exception) => exception.month)).size !== plan.exceptions.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Montants exceptionnels dupliqués pour le même mois." });
});
const lineSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  plannedCents: money,
  amountPlan: amountPlanSchema.optional(),
  expenseGroup: z.enum(["HOUSING", "DAILY_LIFE"]),
  kind: z.enum(["FIXED", "VARIABLE", "RESERVE"]),
  allocationType: z.enum(["PRO_RATA", "FIFTY_FIFTY", "CUSTOM"]),
  customPercentages: z
    .array(z.object({ memberId: id, percent: z.number().min(0).max(100) }))
    .length(2)
    .optional(),
  shares: z.array(shareSchema).length(2),
  openingShares: z.array(shareSchema).length(2),
  openingPotCents: money.default(0),
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
  order,
});
const potTransferSchema = z.object({
  id,
  lineId: id,
  amountCents: money.positive(),
  date: dateSchema,
  note: z.string().trim().max(200),
  order,
});
const billClosureSchema = z.object({
  id,
  lineId: id,
  date: dateSchema,
  amountCents: money,
  plannedCents: money,
  plannedShares: z.array(shareSchema).length(2),
  fundingShares: z.array(shareSchema).length(2),
  order,
  reopened: z.object({ date: dateSchema, order }).optional(),
});
const budgetSchema = z.object({
  id: monthSchema,
  label: z.string(),
  status: z.enum(["ACTIVE", "CLOSED"]),
  members: z.array(memberSchema).length(2),
  lines: z.array(lineSchema),
  expenses: z.array(expenseSchema),
  payments: z.array(paymentSchema),
  potTransfers: z.array(potTransferSchema).default([]),
  billClosures: z.array(billClosureSchema),
  // Already executed transfers from the previous version are preserved as history.
  refunds: z.array(refundSchema),
  closedPotCents: money.default(0),
  closedOrder: z.number().int().nonnegative().safe(),
  closedAt: z.string().optional(),
});
export const stateSchema = z.object({
  version: z.literal(7),
  revision: z.number().int().nonnegative(),
  potSequence: z.number().int().nonnegative().safe(),
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
export type AmountPlan = z.infer<typeof amountPlanSchema>;
export type AmountScope = "MONTH" | "FROM_MONTH";
export type Expense = z.infer<typeof expenseSchema>;
export type PotExpense = z.infer<typeof potExpenseSchema>;
export type PotTransfer = z.infer<typeof potTransferSchema>;
export type BillClosure = z.infer<typeof billClosureSchema>;
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
export function amountForMonth(
  line: Pick<BudgetLine, "plannedCents" | "amountPlan">,
  month: string,
): number {
  monthSchema.parse(month);
  if (!line.amountPlan) return line.plannedCents;
  const exception = line.amountPlan.exceptions.find((entry) => entry.month === month);
  if (exception) return exception.amountCents;
  const change = [...line.amountPlan.changes]
    .filter((entry) => entry.fromMonth <= month)
    .sort((left, right) => right.fromMonth.localeCompare(left.fromMonth))[0];
  return change?.amountCents ?? line.amountPlan.baseCents;
}
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
  const billClosures = new Map(budget.billClosures.filter((closure) => !closure.reopened).map((closure) => [closure.lineId, closure]));
  const closedFunding = Object.fromEntries(ids.map((id) => [id,
    sum([...billClosures.values()].map((closure) => owned(closure.fundingShares, id))),
  ]));
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
  // Money already assigned to a closed bill stays earmarked. Only the remaining
  // receipts can fund open envelopes when their provisions or salaries change.
  const funding = Object.fromEntries(
    ids.map((id) => {
      const open = budget.lines.filter((line) => !billClosures.has(line.id));
      const remaining = Math.max(0, paid[id] - closedFunding[id]);
      const amounts = open.length ? splitAmount(
        Math.min(remaining, sum(open.map((line) => owned(line.shares, id)))),
        open.map((line) => owned(line.shares, id)), open.map((line) => line.id),
      ) : [];
      return [id, budget.lines.map((line) => {
        const closure = billClosures.get(line.id);
        return closure ? owned(closure.fundingShares, id) : amounts[open.findIndex((entry) => entry.id === line.id)];
      })];
    }),
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
    const personalOpening = sum(line.openingShares.map((s) => s.amountCents));
    const personalCapacityCents = line.plannedCents + personalOpening;
    const potAddedCents = sum(budget.potTransfers.filter((transfer) => transfer.lineId === line.id).map((transfer) => transfer.amountCents));
    const potFunding = line.openingPotCents + potAddedCents;
    const opening = personalOpening + line.openingPotCents;
    const capacity = personalCapacityCents + potFunding;
    const billClosure = billClosures.get(line.id) ?? null;
    const weights =
      personalCapacityCents > 0
        ? capacityShares
        : billClosure ? ids.map((id) => owned(billClosure.fundingShares, id)) : allocationWeights(
            line.allocationType,
            members,
            line.customPercentages,
          );
    // Monthly personal provisions stay due. The common pot covers only spending
    // beyond personal capacity, before any additional personal contribution.
    const potSpentCents = Math.min(potFunding, Math.max(0, spent - personalCapacityCents));
    const costs = splitAmount(spent - potSpentCents, weights, ids);
    const reservedShares = capacityShares.map((n, i) =>
      line.kind === "RESERVE" ? Math.max(0, n - costs[i]) : 0,
    );
    const reservedPotCents = line.kind === "RESERVE" ? potFunding - potSpentCents : 0;
    const funded = opening + potAddedCents + sum(ids.map((id) => funding[id][index]));
    const releasedToPotCents = billClosure?.amountCents ?? 0;
    return {
      ...line,
      spent,
      opening,
      capacity,
      personalCapacityCents,
      potAddedCents,
      potSpentCents,
      funded,
      fundedShares: ids.map((id) => ({ memberId: id, amountCents: funding[id][index] })),
      billClosure,
      releasedToPotCents,
      available: funded - spent - releasedToPotCents,
      remaining: capacity - spent,
      costs,
      reservedShares,
      reservedPotCents,
    };
  });
  // Complements beyond the planned contribution first fund this member's overruns.
  for (const [i, memberId] of ids.entries()) {
    const deficits = lines.map((l) =>
      l.billClosure ? 0 : Math.max(
        0,
        l.costs[i] -
          owned(l.shares, memberId) -
          owned(l.openingShares, memberId),
      ),
    );
    const extra = Math.min(
      Math.max(0, paid[memberId] - closedFunding[memberId] -
        sum(lines.filter((line) => !line.billClosure).map((line) => owned(line.shares, memberId)))),
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
        l.fundedShares[i].amountCents += additions[index];
        l.available = l.funded - l.spent - l.releasedToPotCents;
      });
    }
  }
  const balances = members.map((m, i) => {
    const opening = sum(budget.lines.map((l) => owned(l.openingShares, m.id)));
    const cost = sum(lines.map((l) => l.costs[i]));
    const reserved = sum(lines.map((l) => l.reservedShares[i]));
    const openCost = sum(lines.filter((line) => !line.billClosure).map((line) => line.costs[i]));
    const openExpected = sum(lines.filter((line) => !line.billClosure).map((line) => owned(line.shares, m.id)));
    const required = Math.max(expected[m.id], closedFunding[m.id] + openExpected,
      closedFunding[m.id] + openCost + reserved - opening);
    return {
      ...m,
      expected: expected[m.id],
      paid: paid[m.id],
      cost,
      reserved,
      remaining: Math.max(0, required - paid[m.id]),
      unspent: paid[m.id] + opening - closedFunding[m.id] - openCost - reserved,
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
    refundedCents +
    sum(budget.potTransfers.map((transfer) => transfer.amountCents)) -
    sum([...billClosures.values()].map((closure) => closure.amountCents));
  const reservedCents = sum(lines.flatMap((l) => l.reservedShares)) + sum(lines.map((line) => line.reservedPotCents));
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
    potTransferredCents: sum(budget.potTransfers.map((transfer) => transfer.amountCents)),
    releasedToPotCents: sum([...billClosures.values()].map((closure) => closure.amountCents)),
    unpaidBills,
    missingCents: sum(balances.map((m) => m.remaining)),
    surplusCents: Math.max(0, cashCents - reservedCents),
  };
}
export function closeBudget(budget: Budget, closedOrder?: number): Budget {
  if (budget.status === "CLOSED") return budget;
  const summary = budgetSummary(budget);
  if (!budget.lines.length)
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
    closedOrder: closedOrder ?? Math.max(0, ...budget.potTransfers.map((entry) => entry.order),
      ...budget.billClosures.flatMap((entry) => [entry.order, entry.reopened?.order ?? 0])) + 1,
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
  const billCredits = [state.budget, ...state.archivedBudgets].flatMap((budget) => budget.billClosures.map((closure) => ({
    ...closure, month: budget.id, lineName: budget.lines.find((line) => line.id === closure.lineId)?.name ?? "Facture",
  })));
  const billReopenedCents = sum(billCredits.filter((closure) => closure.reopened).map((closure) => closure.amountCents));
  const billReleasedCents = sum(billCredits.map((closure) => closure.amountCents)) - billReopenedCents;
  const receivedCents = sum(credits.map((b) => b.closedPotCents)) + sum(billCredits.map((closure) => closure.amountCents));
  const spentCents = sum(state.potExpenses.map((e) => e.amountCents));
  const transferredCents = sum([state.budget, ...state.archivedBudgets].flatMap((budget) => budget.potTransfers.map((transfer) => transfer.amountCents)));
  return {
    credits,
    billCredits,
    billReopenedCents,
    billReleasedCents,
    receivedCents,
    spentCents,
    transferredCents,
    availableCents: receivedCents - spentCents - transferredCents - billReopenedCents,
  };
}
export function nextPotOrder(state: AppState) {
  const orders = [state.budget, ...state.archivedBudgets].flatMap((budget) => [budget.closedOrder,
    ...budget.potTransfers.map((transfer) => transfer.order),
    ...budget.billClosures.flatMap((closure) => [closure.order, closure.reopened?.order ?? 0]),
  ]);
  const next = Math.max(state.potSequence, ...orders, ...state.potExpenses.map((expense) => expense.order)) + 1;
  if (!Number.isSafeInteger(next)) throw new Error("Le journal des mouvements a atteint sa limite.");
  return next;
}
function migrateState(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "version" in raw && raw.version === 6) {
    const legacyTransfer = potTransferSchema.omit({ order: true });
    const legacyBudget = budgetSchema.omit({ billClosures: true, closedOrder: true }).extend({ potTransfers: z.array(legacyTransfer).default([]) });
    const legacy = stateSchema.omit({ potSequence: true }).extend({
      version: z.literal(6), budget: legacyBudget, archivedBudgets: z.array(legacyBudget),
      potExpenses: z.array(potExpenseSchema.omit({ order: true })),
    }).parse(raw);
    let sequence = 0;
    const budgets: Budget[] = [legacy.budget, ...legacy.archivedBudgets].map((budget) => ({
      ...budget, billClosures: [], closedOrder: 0,
      potTransfers: budget.potTransfers.map((transfer) => ({ ...transfer, order: 0 })),
    }));
    const expenses = legacy.potExpenses.map((expense) => ({ ...expense, order: 0 }));
    const months = [...new Set([...budgets.map((budget) => budget.id), ...expenses.map((expense) => expense.date.slice(0, 7))])].sort();
    for (const month of months) {
      const budget = budgets.find((entry) => entry.id === month);
      // V6 permitted transfers only from earlier months; its same-month pot
      // purchases may use the subsequent monthly close. Preserve that ordering.
      if (budget) {
        for (const transfer of [...budget.potTransfers].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) transfer.order = ++sequence;
        if (budget.status === "CLOSED") budget.closedOrder = ++sequence;
      }
      for (const expense of expenses.filter((entry) => entry.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) expense.order = ++sequence;
    }
    return { ...legacy, version: 7, potSequence: sequence, budget: budgets[0], archivedBudgets: budgets.slice(1), potExpenses: expenses };
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    ![3, 4, 5].includes(Number(raw.version))
  )
    return raw;
  const legacyLineSchema = lineSchema.omit({ openingPotCents: true });
  const legacyBudgetSchema = budgetSchema.omit({ potTransfers: true, billClosures: true, closedOrder: true }).extend({ lines: z.array(legacyLineSchema) });
  const legacy = stateSchema.omit({ potSequence: true })
    .extend({
      version: z.union([z.literal(3), z.literal(4), z.literal(5)]),
      budget: legacyBudgetSchema,
      archivedBudgets: z.array(legacyBudgetSchema),
      potExpenses: z.array(potExpenseSchema.omit({ order: true })).default([]),
    })
    .parse(raw);
  const convert = (old: z.infer<typeof legacyBudgetSchema>): Budget => {
    const b: Budget = { ...old, potTransfers: [], billClosures: [], closedOrder: 0, lines: old.lines.map((line) => ({ ...line, openingPotCents: 0 })) };
    if (legacy.version !== 3) return b;
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
  return migrateState({
    ...legacy,
    version: 6,
    budget: convert(legacy.budget),
    archivedBudgets: legacy.archivedBudgets.map(convert),
  });
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
    for (const entries of [b.lines, b.expenses, b.payments, b.potTransfers, b.billClosures])
      if (new Set(entries.map((e) => e.id)).size !== entries.length)
        throw new Error("Identifiants dupliqués.");
    for (const l of b.lines) {
      const closure = b.billClosures.find((entry) => entry.lineId === l.id && !entry.reopened);
      if (l.amountPlan && l.plannedCents !== amountForMonth(l, b.id))
        throw new Error("Le montant de l’enveloppe ne correspond pas à sa programmation pour ce mois.");
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
      if (!closure && (
        l.shares.some(
          (share) =>
            share.amountCents !==
            computed.find((x) => x.memberId === share.memberId)?.amountCents,
        )
      ))
        throw new Error(
          "Les parts ne correspondent pas à la règle de répartition.",
        );
      if (l.kind !== "RESERVE" && (l.openingShares.some((x) => x.amountCents) || l.openingPotCents > 0))
        throw new Error("Report réservé à une enveloppe de réserve.");
    }
    const activeClosures = b.billClosures.filter((closure) => !closure.reopened);
    if (new Set(activeClosures.map((closure) => closure.lineId)).size !== activeClosures.length)
      throw new Error("Une facture est clôturée plusieurs fois.");
    for (const closure of b.billClosures) {
      const line = b.lines.find((entry) => entry.id === closure.lineId);
      if (!line || closure.date.slice(0, 7) !== b.id || closure.date > today() ||
          (closure.reopened && (closure.reopened.date.slice(0, 7) !== b.id || closure.reopened.date > today() ||
            closure.reopened.date < closure.date || closure.reopened.order <= closure.order)))
        throw new Error("Clôture de facture rattachée au mauvais mois ou mouvement invalide.");
      for (const shares of [closure.plannedShares, closure.fundingShares])
        if (new Set(shares.map((share) => share.memberId)).size !== 2 || shares.some((share) => !ids.includes(share.memberId)))
          throw new Error("Financement de facture invalide.");
      if (sum(closure.plannedShares.map((share) => share.amountCents)) !== closure.plannedCents ||
          closure.fundingShares.some((share) => share.amountCents < owned(closure.plannedShares, share.memberId)))
        throw new Error("La facture doit être entièrement financée avant sa clôture.");
      if (!closure.reopened) {
        if (line.kind !== "FIXED" || !line.settled || line.plannedCents !== closure.plannedCents ||
            line.shares.some((share) => share.amountCents !== owned(closure.plannedShares, share.memberId)))
          throw new Error("La provision et les parts d’une facture clôturée sont figées. Rouvrez-la pour les modifier.");
        const transfers = b.potTransfers.filter((transfer) => transfer.lineId === line.id);
        const expenses = b.expenses.filter((expense) => expense.lineId === line.id);
        const spent = sum(expenses.map((expense) => expense.amountCents));
        if (transfers.some((transfer) => transfer.order >= closure.order || transfer.date > closure.date) ||
            expenses.some((expense) => expense.date > closure.date) ||
            sum(closure.fundingShares.map((share) => share.amountCents)) + sum(transfers.map((transfer) => transfer.amountCents)) - spent !== closure.amountCents)
          throw new Error("Le surplus libéré ne correspond pas au financement réel de la facture clôturée.");
        for (const memberId of ids) {
          const committed = sum(activeClosures.filter((entry) => entry.order <= closure.order).map((entry) => owned(entry.fundingShares, memberId)));
          const receivedBefore = sum(b.payments.filter((payment) => payment.memberId === memberId && payment.date <= closure.date).map((payment) => payment.amountCents));
          if (committed > receivedBefore)
            throw new Error("Ces versements financent déjà des factures clôturées : ils doivent rester reçus au plus tard à leur date de clôture.");
        }
      }
    }
    for (const memberId of ids) {
      const earmarked = sum(activeClosures.map((closure) => owned(closure.fundingShares, memberId)));
      const received = sum(b.payments.filter((payment) => payment.memberId === memberId).map((payment) => payment.amountCents));
      if (received < earmarked)
        throw new Error("Ces versements financent déjà des factures clôturées. Rouvrez-les avant de retirer cet argent.");
    }
    if (
      b.payments.some(
        (p) => !ids.includes(p.memberId) || p.date.slice(0, 7) !== b.id,
      ) ||
      b.expenses.some(
        (e) =>
          !b.lines.some((l) => l.id === e.lineId) ||
          e.date.slice(0, 7) !== b.id,
      ) ||
      b.potTransfers.some((transfer) =>
        transfer.date.slice(0, 7) !== b.id || transfer.date > today() ||
        !b.lines.some((line) => line.id === transfer.lineId),
      )
    )
      throw new Error(
        "Opération rattachée au mauvais mois ou à une enveloppe inconnue.",
      );
    if (b.status === "CLOSED") {
      const summary = budgetSummary(b);
      const lastMovement = Math.max(0, ...b.potTransfers.map((transfer) => transfer.order),
        ...b.billClosures.flatMap((closure) => [closure.order, closure.reopened?.order ?? 0]));
      if (!b.closedOrder || b.closedOrder <= lastMovement)
        throw new Error("L’ordre de clôture mensuelle est invalide.");
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
    } else if (b.refunds.length || b.closedPotCents || b.closedOrder)
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
    const monthOrders = [
      ...(budget.status === "CLOSED" ? [budget.closedOrder] : []),
      ...budget.potTransfers.map((transfer) => transfer.order),
      ...budget.billClosures.flatMap((closure) => [closure.order, ...(closure.reopened ? [closure.reopened.order] : [])]),
    ];
    if (previous && monthOrders.some((order) => order <= previous.closedOrder))
      throw new Error("Un mouvement a été enregistré avant l’ouverture de son mois budgétaire.");
    const previousLines = previous ? budgetSummary(previous).lines : [];
    for (const line of budget.lines) {
      const prior = previousLines.find((l) => l.id === line.id);
      if (line.openingPotCents !== (prior?.reservedPotCents ?? 0))
        throw new Error("Réserve commune reportée incohérente.");
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
          (l.reservedShares.some((n) => n > 0) || l.reservedPotCents > 0) &&
          !budget.lines.some((current) => current.id === l.id),
      )
    )
      throw new Error("Une réserve reportée a disparu.");
  });
  if (new Set(s.potExpenses.map((e) => e.id)).size !== s.potExpenses.length)
    throw new Error("Dépenses du pot commun dupliquées.");
  if (potSummary(s).availableCents < 0)
    throw new Error("Le montant dépasse le pot commun disponible.");
  // Posting order, rather than the editable business date, determines whether
  // the common pot actually held the money before a movement was recorded.
  const movements = budgets.flatMap((budget) => [
    ...(budget.status === "CLOSED" ? [{ order: budget.closedOrder, amount: budget.closedPotCents }] : []),
    ...budget.potTransfers.map((transfer) => ({ order: transfer.order, amount: -transfer.amountCents })),
    ...budget.billClosures.flatMap((closure) => [
      { order: closure.order, amount: closure.amountCents },
      ...(closure.reopened ? [{ order: closure.reopened.order, amount: -closure.amountCents }] : []),
    ]),
  ]).concat(s.potExpenses.map((expense) => ({ order: expense.order, amount: -expense.amountCents })));
  if (new Set(movements.map((movement) => movement.order)).size !== movements.length)
    throw new Error("Ordres des mouvements du pot commun dupliqués.");
  if (s.potSequence < Math.max(0, ...movements.map((movement) => movement.order)))
    throw new Error("Le compteur des mouvements du pot commun est incohérent.");
  let available = 0;
  for (const movement of movements.sort((a, b) => a.order - b.order)) {
    available += movement.amount;
    if (available < 0)
      throw new Error("Le pot commun n’était pas suffisamment alimenté avant ce mouvement.");
  }
  // Keep legacy value-date protection as well: a backdated purchase cannot use
  // a later month's savings. Within one day, posting order resolves chronology.
  const daily = new Map<string, number>();
  const addDay = (date: string, amount: number) => daily.set(date, (daily.get(date) ?? 0) + amount);
  for (const budget of budgets) {
    if (budget.status === "CLOSED") addDay(`${budget.id}-01`, budget.closedPotCents);
    for (const transfer of budget.potTransfers) addDay(transfer.date, -transfer.amountCents);
    for (const closure of budget.billClosures) {
      addDay(closure.date, closure.amountCents);
      if (closure.reopened) addDay(closure.reopened.date, -closure.amountCents);
    }
  }
  for (const expense of s.potExpenses) addDay(expense.date, -expense.amountCents);
  let datedAvailable = 0;
  for (const [, amount] of [...daily].sort(([a], [b]) => a.localeCompare(b))) {
    datedAvailable += amount;
    if (datedAvailable < 0) throw new Error("Le pot commun n’était pas suffisamment alimenté à cette date.");
  }
  return s;
}
