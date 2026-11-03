import {
  AppState,
  AmountPlan,
  AmountScope,
  Budget,
  BudgetLine,
  Expense,
  Member,
  Payment,
  PotExpense,
  Share,
  budgetSummary,
  amountForMonth,
  closeBudget,
  monthLabel,
  monthSchema,
  nextMonth,
  sharesFor,
  today,
  validateState,
} from "./domain";
export type { AppState } from "./domain";
export const uid = () => crypto.randomUUID();
const zeroShares = (members: Member[]): Share[] =>
  members.map((m) => ({ memberId: m.id, amountCents: 0 }));
export function initialState(month = today().slice(0, 7)): AppState {
  const members = [
    { id: "jean", name: "Jean", incomeCents: 0 },
    { id: "miruna", name: "Miruna", incomeCents: 0 },
  ];
  const definitions = [
    ["credit", "Prêt immobilier", "HOUSING", "FIXED"],
    ["electricite", "Électricité", "HOUSING", "FIXED"],
    ["assurance", "Assurance habitation", "HOUSING", "FIXED"],
    ["taxe-fonciere", "Taxe foncière", "HOUSING", "RESERVE"],
    ["charges", "Charges de copropriété", "HOUSING", "RESERVE"],
    ["internet", "Box internet", "HOUSING", "FIXED"],
    ["courses", "Courses", "DAILY_LIFE", "VARIABLE"],
    ["vacances", "Vacances", "DAILY_LIFE", "RESERVE"],
  ] as const;
  return {
    version: 5,
    revision: 0,
    configured: false,
    members,
    incomeHistory: members.map((m) => ({
      memberId: m.id,
      amountCents: 0,
      effectiveFrom: month,
    })),
    budget: {
      id: month,
      label: monthLabel(month),
      status: "ACTIVE",
      members,
      lines: definitions.map(([id, name, expenseGroup, kind]) => ({
        id,
        name,
        expenseGroup,
        kind,
        allocationType: expenseGroup === "HOUSING" ? "PRO_RATA" : "FIFTY_FIFTY",
        plannedCents: 0,
        shares: zeroShares(members),
        openingShares: zeroShares(members),
        settled: false,
      })),
      expenses: [],
      payments: [],
      refunds: [],
      closedPotCents: 0,
    },
    archivedBudgets: [],
    potExpenses: [],
  };
}
export function membersForMonth(s: AppState, month: string): Member[] {
  return s.members.map((m) => ({
    ...m,
    incomeCents:
      [...s.incomeHistory]
        .filter((h) => h.memberId === m.id && h.effectiveFrom <= month)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
        ?.amountCents ?? 0,
  }));
}
function active(s: AppState) {
  if (s.budget.status === "CLOSED")
    throw new Error(
      "Ce mois est clôturé. Ses dépenses et ses versements sont verrouillés.",
    );
}
function withBudget(s: AppState, budget: Budget) {
  return validateState({ ...s, budget });
}
export type LineAmountOptions = { month?: string; scope?: AmountScope };
function checkAmountMonth(s: AppState, month: string, scope: AmountScope) {
  monthSchema.parse(month);
  if (month < s.budget.id)
    throw new Error("Choisissez le mois en cours ou un mois à venir.");
  if (scope !== "MONTH" && scope !== "FROM_MONTH")
    throw new Error("Choisissez un montant pour ce mois ou à partir de ce mois.");
}
function planLineAmount(
  line: BudgetLine | undefined,
  amountCents: number,
  month: string,
  scope: AmountScope,
): AmountPlan {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 1_000_000_000)
    throw new Error("Renseignez un montant valide, positif ou nul, pour cette enveloppe.");
  const plan = line?.amountPlan ?? {
    baseCents: line?.plannedCents ?? 0,
    changes: [],
    exceptions: [],
  };
  return {
    baseCents: plan.baseCents,
    changes: (scope === "FROM_MONTH"
      ? [...plan.changes.filter((change) => change.fromMonth !== month), { fromMonth: month, amountCents }]
      : [...plan.changes]).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)),
    exceptions: [
      ...plan.exceptions.filter((exception) => exception.month !== month),
      ...(scope === "MONTH" ? [{ month, amountCents }] : []),
    ].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
export function saveLine(
  s: AppState,
  line: Pick<
    BudgetLine,
    "id" | "name" | "plannedCents" | "expenseGroup" | "kind" | "dueDay"
  > &
    Partial<Pick<BudgetLine, "allocationType" | "customPercentages">>,
  options?: LineAmountOptions,
): AppState {
  active(s);
  const old = s.budget.lines.find((l) => l.id === line.id);
  if (
    old &&
    s.budget.expenses.some((e) => e.lineId === old.id) &&
    (old.expenseGroup !== line.expenseGroup || old.kind !== line.kind)
  )
    throw new Error(
      "Cette enveloppe contient des dépenses : son groupe et son type doivent rester inchangés.",
    );
  if (
    old?.openingShares.some((x) => x.amountCents > 0) &&
    (line.kind !== "RESERVE" || line.expenseGroup !== old.expenseGroup)
  )
    throw new Error(
      "Cette enveloppe contient une réserve reportée : conservez son type et sa répartition.",
    );
  const allocationType =
    line.allocationType ??
    old?.allocationType ??
    (line.expenseGroup === "HOUSING" ? "PRO_RATA" : "FIFTY_FIFTY");
  const customPercentages =
    allocationType === "CUSTOM"
      ? (line.customPercentages ?? old?.customPercentages)
      : undefined;
  const month = options?.month ?? s.budget.id;
  const scope = options?.scope ?? "FROM_MONTH";
  checkAmountMonth(s, month, scope);
  const amountPlan = options || (old && line.plannedCents !== old.plannedCents)
    ? planLineAmount(old, line.plannedCents, month, scope)
    : old?.amountPlan;
  const plannedCents = amountForMonth({ plannedCents: line.plannedCents, amountPlan }, s.budget.id);
  const updated: BudgetLine = {
    ...line,
    amountPlan,
    plannedCents,
    name: line.name.trim(),
    allocationType,
    customPercentages,
    shares: sharesFor(
      plannedCents,
      allocationType,
      s.budget.members,
      customPercentages,
    ),
    openingShares: old?.openingShares ?? zeroShares(s.members),
    settled: old?.settled ?? false,
  };
  return withBudget(s, {
    ...s.budget,
    lines: old
      ? s.budget.lines.map((l) => (l.id === line.id ? updated : l))
      : [...s.budget.lines, updated],
  });
}
export function saveLineAmount(
  s: AppState,
  lineId: string,
  amountCents: number,
  month: string,
  scope: AmountScope,
) {
  active(s);
  checkAmountMonth(s, month, scope);
  const line = s.budget.lines.find((entry) => entry.id === lineId);
  if (!line) throw new Error("Cette enveloppe n’existe pas.");
  return saveLine(s, { ...line, plannedCents: amountCents }, { month, scope });
}
export function removeLineAmount(
  s: AppState,
  lineId: string,
  month: string,
  scope: AmountScope,
) {
  active(s);
  checkAmountMonth(s, month, scope);
  const line = s.budget.lines.find((entry) => entry.id === lineId);
  if (!line) throw new Error("Cette enveloppe n’existe pas.");
  if (!line.amountPlan) return s;
  const amountPlan: AmountPlan = {
    ...line.amountPlan,
    changes: line.amountPlan.changes.filter((change) => scope !== "FROM_MONTH" || change.fromMonth !== month),
    exceptions: line.amountPlan.exceptions.filter((exception) => scope !== "MONTH" || exception.month !== month),
  };
  const plannedCents = amountForMonth({ ...line, amountPlan }, s.budget.id);
  return withBudget(s, {
    ...s.budget,
    lines: s.budget.lines.map((entry) => entry.id === lineId ? {
      ...entry,
      amountPlan,
      plannedCents,
      shares: sharesFor(plannedCents, entry.allocationType, s.budget.members, entry.customPercentages),
    } : entry),
  });
}
export function removeLine(s: AppState, id: string) {
  active(s);
  if (
    s.budget.expenses.some((e) => e.lineId === id) ||
    s.budget.lines
      .find((l) => l.id === id)
      ?.openingShares.some((x) => x.amountCents)
  )
    throw new Error(
      "Une enveloppe avec des dépenses ou une réserve ne peut pas être supprimée.",
    );
  return withBudget(s, {
    ...s.budget,
    lines: s.budget.lines.filter((l) => l.id !== id),
  });
}
export function saveExpense(s: AppState, expense: Expense, settled: boolean) {
  active(s);
  if (expense.date > today())
    throw new Error(
      "Enregistrez une dépense uniquement après son paiement réel.",
    );
  const previous = s.budget.expenses.find((e) => e.id === expense.id);
  return withBudget(s, {
    ...s.budget,
    expenses: previous
      ? s.budget.expenses.map((e) => (e.id === expense.id ? expense : e))
      : [...s.budget.expenses, expense],
    lines: s.budget.lines.map((l) =>
      l.id === expense.lineId && l.kind === "FIXED"
        ? { ...l, settled }
        : previous &&
            previous.lineId !== expense.lineId &&
            l.id === previous.lineId
          ? { ...l, settled: false }
          : l,
    ),
  });
}
export function removeExpense(s: AppState, id: string) {
  active(s);
  const lineId = s.budget.expenses.find((e) => e.id === id)?.lineId;
  return withBudget(s, {
    ...s.budget,
    expenses: s.budget.expenses.filter((e) => e.id !== id),
    lines: s.budget.lines.map((l) =>
      l.id === lineId ? { ...l, settled: false } : l,
    ),
  });
}
export function savePayment(s: AppState, payment: Payment) {
  active(s);
  if (payment.date > today())
    throw new Error(
      "Enregistrez un versement uniquement après sa réception réelle.",
    );
  return withBudget(s, {
    ...s.budget,
    payments: s.budget.payments.some((p) => p.id === payment.id)
      ? s.budget.payments.map((p) => (p.id === payment.id ? payment : p))
      : [...s.budget.payments, payment],
  });
}
export function removePayment(s: AppState, id: string) {
  active(s);
  return withBudget(s, {
    ...s.budget,
    payments: s.budget.payments.filter((p) => p.id !== id),
  });
}
export function setSettled(s: AppState, lineId: string, settled: boolean) {
  active(s);
  return withBudget(s, {
    ...s.budget,
    lines: s.budget.lines.map((l) => (l.id === lineId ? { ...l, settled } : l)),
  });
}
export function configureHousehold(
  s: AppState,
  names: string[],
  incomes: number[],
  effectiveFrom: string,
  startMonth?: string,
) {
  monthSchema.parse(effectiveFrom);
  if (incomes.reduce((a, b) => a + b, 0) <= 0)
    throw new Error("Renseignez au moins un salaire positif.");
  const members = s.members.map((m, i) => ({
    ...m,
    name: names[i].trim(),
    incomeCents: incomes[i],
  }));
  let result = {
    ...s,
    members,
    configured: true,
    incomeHistory: [
      ...(s.configured
        ? s.incomeHistory.filter((h) => h.effectiveFrom !== effectiveFrom)
        : []),
      ...members.map((m) => ({
        memberId: m.id,
        amountCents: m.incomeCents,
        effectiveFrom,
      })),
    ],
  };
  if (!s.configured && startMonth) {
    monthSchema.parse(startMonth);
    result = {
      ...result,
      budget: {
        ...result.budget,
        id: startMonth,
        label: monthLabel(startMonth),
      },
    };
  }
  if (result.budget.status === "ACTIVE") {
    const monthlyMembers = membersForMonth(result, result.budget.id);
    result = {
      ...result,
      budget: {
        ...result.budget,
        members: monthlyMembers,
        lines: result.budget.lines.map((l) => ({
          ...l,
          shares: sharesFor(
            l.plannedCents,
            l.allocationType,
            monthlyMembers,
            l.customPercentages,
          ),
        })),
      },
    };
  }
  return validateState(result);
}
export function closeMonth(s: AppState) {
  return withBudget(s, closeBudget(s.budget));
}
export function startNextMonth(s: AppState) {
  if (s.budget.status !== "CLOSED")
    throw new Error("Clôturez le mois en cours avant de préparer le suivant.");
  const month = nextMonth(s.budget.id);
  const members = membersForMonth(s, month);
  const summary = budgetSummary(s.budget);
  return validateState({
    ...s,
    archivedBudgets: [...s.archivedBudgets, s.budget],
    budget: {
      id: month,
      label: monthLabel(month),
      status: "ACTIVE",
      members,
      lines: s.budget.lines.map((l) => ({
        ...l,
        plannedCents: amountForMonth(l, month),
        settled: false,
        shares: sharesFor(
          amountForMonth(l, month),
          l.allocationType,
          members,
          l.customPercentages,
        ),
        openingShares: s.budget.members.map((m, i) => ({
          memberId: m.id,
          amountCents: summary.lines.find((x) => x.id === l.id)!.reservedShares[
            i
          ],
        })),
      })),
      expenses: [],
      payments: [],
      refunds: [],
      closedPotCents: 0,
    },
  });
}
export function savePotExpense(s: AppState, expense: PotExpense) {
  if (expense.date > today())
    throw new Error(
      "Enregistrez une dépense du pot commun après son paiement réel.",
    );
  return validateState({
    ...s,
    potExpenses: s.potExpenses.some((e) => e.id === expense.id)
      ? s.potExpenses.map((e) => (e.id === expense.id ? expense : e))
      : [...s.potExpenses, expense],
  });
}
export function removePotExpense(s: AppState, id: string) {
  return validateState({
    ...s,
    potExpenses: s.potExpenses.filter((e) => e.id !== id),
  });
}
export function resetState(s: AppState) {
  const clean = initialState(s.budget.id);
  return validateState({
    ...clean,
    configured: s.configured,
    revision: s.revision,
    members: s.members,
    incomeHistory: s.incomeHistory,
    budget: {
      ...clean.budget,
      members: membersForMonth(s, s.budget.id),
      lines: s.budget.lines.map((l) => ({
        ...l,
        shares: sharesFor(
          l.plannedCents,
          l.allocationType,
          membersForMonth(s, s.budget.id),
          l.customPercentages,
        ),
        openingShares: zeroShares(s.members),
        settled: false,
      })),
    },
  });
}

export function saveMonthlyIncomes(
  s: AppState,
  incomes: number[],
  month: string,
) {
  monthSchema.parse(month);
  if (month === s.budget.id && s.budget.status === "CLOSED")
    throw new Error("Ce mois est clôturé. Ses salaires sont verrouillés.");
  if (month !== s.budget.id && month !== nextMonth(s.budget.id))
    throw new Error(
      "Choisissez le mois en cours ou le mois suivant pour saisir les salaires.",
    );
  if (
    incomes.length !== s.members.length ||
    incomes.some(
      (income) =>
        !Number.isSafeInteger(income) || income < 0 || income > 1_000_000_000,
    )
  )
    throw new Error("Renseignez un salaire valide pour chaque personne.");
  return configureHousehold(
    s,
    s.members.map((member) => member.name),
    incomes,
    month,
  );
}

export function confirmMonthlyIncomes(s: AppState, incomes: number[]) {
  if (s.budget.status !== "CLOSED")
    throw new Error("Clôturez le mois en cours avant de préparer le suivant.");
  return startNextMonth(
    saveMonthlyIncomes(s, incomes, nextMonth(s.budget.id)),
  );
}

export function resetEverything(s: AppState) {
  const clean = initialState();
  const members = clean.members.map((m, index) => ({
    ...m,
    name: `Personne ${index + 1}`,
  }));
  return validateState({
    ...clean,
    revision: s.revision,
    members,
    budget: { ...clean.budget, members },
  });
}
