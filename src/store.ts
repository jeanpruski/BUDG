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
  PotTransfer,
  Share,
  budgetSummary,
  potSummary,
  amountForMonth,
  closeBudget,
  monthLabel,
  monthSchema,
  nextMonth,
  nextPotOrder,
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
    version: 7,
    revision: 0,
    potSequence: 0,
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
        openingPotCents: 0,
        settled: false,
      })),
      expenses: [],
      payments: [],
      potTransfers: [],
      billClosures: [],
      refunds: [],
      closedPotCents: 0,
      closedOrder: 0,
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
  const highest = Math.max(s.potSequence, budget.closedOrder, ...budget.potTransfers.map((entry) => entry.order),
    ...budget.billClosures.flatMap((entry) => [entry.order, entry.reopened?.order ?? 0]));
  return validateState({ ...s, budget, potSequence: highest });
}
function editableLine(s: AppState, lineId: string) {
  if (s.budget.billClosures.some((closure) => closure.lineId === lineId && !closure.reopened))
    throw new Error("Cette facture est clôturée. Rouvrez-la avant de modifier ses opérations ou son financement.");
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
  if (old && s.budget.billClosures.some((closure) => closure.lineId === line.id && !closure.reopened)) {
    const month = options?.month ?? s.budget.id;
    const scope = options?.scope ?? "FROM_MONTH";
    checkAmountMonth(s, month, scope);
    if (month <= s.budget.id) editableLine(s, line.id);
    const amountPlan = planLineAmount(old, line.plannedCents, month, scope);
    return withBudget(s, { ...s.budget, lines: s.budget.lines.map((entry) => entry.id === old.id ? { ...old, amountPlan } : entry) });
  }
  if (
    old &&
    s.budget.expenses.some((e) => e.lineId === old.id) &&
    (old.expenseGroup !== line.expenseGroup || old.kind !== line.kind)
  )
    throw new Error(
      "Cette enveloppe contient des dépenses : son groupe et son type doivent rester inchangés.",
    );
  if (
    old && (old.openingShares.some((x) => x.amountCents > 0) || old.openingPotCents > 0) &&
    (line.kind !== "RESERVE" || line.expenseGroup !== old.expenseGroup)
  )
    throw new Error(
      "Cette enveloppe contient une réserve reportée : conservez son type et sa répartition.",
    );
  if (old && s.budget.potTransfers.some((transfer) => transfer.lineId === old.id) &&
      (line.kind !== old.kind || line.expenseGroup !== old.expenseGroup))
    throw new Error("Cette enveloppe reçoit de l’argent du pot commun : conservez son groupe et son type.");
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
    openingPotCents: old?.openingPotCents ?? 0,
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
  const closed = s.budget.billClosures.some((closure) => closure.lineId === lineId && !closure.reopened);
  if (closed && plannedCents !== line.plannedCents) editableLine(s, lineId);
  return withBudget(s, {
    ...s.budget,
    lines: s.budget.lines.map((entry) => entry.id === lineId ? {
      ...entry,
      amountPlan,
      plannedCents,
      shares: closed ? entry.shares : sharesFor(plannedCents, entry.allocationType, s.budget.members, entry.customPercentages),
    } : entry),
  });
}
export function removeLine(s: AppState, id: string) {
  active(s);
  if (
    s.budget.expenses.some((e) => e.lineId === id) ||
    s.budget.billClosures.some((closure) => closure.lineId === id) ||
    s.budget.potTransfers.some((transfer) => transfer.lineId === id) ||
    (s.budget.lines.find((line) => line.id === id)?.openingPotCents ?? 0) > 0 ||
    s.budget.lines
      .find((l) => l.id === id)
      ?.openingShares.some((x) => x.amountCents)
  )
    throw new Error(
      "Une enveloppe avec des opérations, une clôture de facture ou une réserve ne peut pas être supprimée.",
    );
  return withBudget(s, {
    ...s.budget,
    lines: s.budget.lines.filter((l) => l.id !== id),
  });
}
export function saveExpense(s: AppState, expense: Expense, settled: boolean) {
  active(s);
  editableLine(s, expense.lineId);
  const oldLineId = s.budget.expenses.find((entry) => entry.id === expense.id)?.lineId;
  if (oldLineId) editableLine(s, oldLineId);
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
  if (lineId) editableLine(s, lineId);
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
  editableLine(s, lineId);
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
        lines: result.budget.lines.map((l) => result.budget.billClosures.some((closure) => closure.lineId === l.id && !closure.reopened) ? l : ({
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
function billDate(s: AppState) {
  const month = s.budget.id;
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const date = [today(), `${month}-${lastDay}`].sort()[0];
  if (date.slice(0, 7) !== month) throw new Error("Clôturez la facture uniquement après son règlement réel dans le mois concerné.");
  return date;
}
export function closeBill(s: AppState, lineId: string) {
  active(s);
  const line = budgetSummary(s.budget).lines.find((entry) => entry.id === lineId);
  if (!line || line.kind !== "FIXED") throw new Error("Seule une facture du mois en cours peut être clôturée.");
  if (line.billClosure) return s;
  if (line.funded < Math.max(line.capacity, line.spent) || line.available < 0 ||
      line.fundedShares.some((share) => share.amountCents < (line.shares.find((entry) => entry.memberId === share.memberId)?.amountCents ?? 0)))
    throw new Error("Financez entièrement cette facture et son éventuel dépassement avant de la clôturer.");
  const closure = {
    id: uid(), lineId, date: billDate(s), amountCents: line.available,
    plannedCents: line.plannedCents,
    plannedShares: line.shares.map((share) => ({ ...share })),
    fundingShares: line.fundedShares.map((share) => ({ ...share })),
    order: nextPotOrder(s),
  };
  return withBudget(s, {
    ...s.budget,
    billClosures: [...s.budget.billClosures, closure],
    lines: s.budget.lines.map((entry) => entry.id === lineId ? { ...entry, settled: true } : entry),
  });
}
export function reopenBill(s: AppState, lineId: string) {
  active(s);
  const closure = s.budget.billClosures.find((entry) => entry.lineId === lineId && !entry.reopened);
  if (!closure) throw new Error("Cette facture n’est pas clôturée.");
  if (potSummary(s).availableCents < closure.amountCents)
    throw new Error("Le pot commun doit pouvoir rendre la totalité du surplus libéré avant de rouvrir cette facture.");
  const reopened = { date: billDate(s), order: nextPotOrder(s) };
  return withBudget(s, {
    ...s.budget,
    billClosures: s.budget.billClosures.map((entry) => entry.id === closure.id ? { ...entry, reopened } : entry),
    lines: s.budget.lines.map((entry) => entry.id === lineId ? {
      ...entry, settled: false,
      shares: sharesFor(entry.plannedCents, entry.allocationType, s.budget.members, entry.customPercentages),
    } : entry),
  });
}
export function closeMonth(s: AppState) {
  if (s.budget.status === "CLOSED") return s;
  return withBudget(s, closeBudget(s.budget, nextPotOrder(s)));
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
        openingPotCents: summary.lines.find((entry) => entry.id === l.id)!.reservedPotCents,
      })),
      expenses: [],
      payments: [],
      potTransfers: [],
      billClosures: [],
      refunds: [],
      closedPotCents: 0,
      closedOrder: 0,
    },
  });
}
export function savePotExpense(s: AppState, input: Omit<PotExpense, "order"> & { order?: number }) {
  const previous = s.potExpenses.find((entry) => entry.id === input.id);
  const expense: PotExpense = { ...input, order: previous?.order ?? nextPotOrder(s) };
  if (expense.date > today())
    throw new Error(
      "Enregistrez une dépense du pot commun après son paiement réel.",
    );
  return validateState({
    ...s,
    potSequence: Math.max(s.potSequence, expense.order),
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
export function savePotTransfer(s: AppState, input: Omit<PotTransfer, "order"> & { order?: number }) {
  active(s);
  editableLine(s, input.lineId);
  const old = s.budget.potTransfers.find((entry) => entry.id === input.id);
  if (old) editableLine(s, old.lineId);
  const transfer: PotTransfer = { ...input, order: old?.order ?? nextPotOrder(s) };
  if (transfer.date > today())
    throw new Error("Enregistrez un transfert uniquement à sa date réelle, pas dans le futur.");
  const previous = s.budget.potTransfers.find((entry) => entry.id === transfer.id);
  const remainingPot = potSummary(s).availableCents + (previous?.amountCents ?? 0);
  if (transfer.amountCents > remainingPot)
    throw new Error("Le montant dépasse le pot commun disponible.");
  // Editing a transfer must obey the same cancellation rule for the amount removed.
  if (previous && (previous.lineId !== transfer.lineId || transfer.amountCents < previous.amountCents)) {
    const removed = previous.lineId === transfer.lineId ? previous.amountCents - transfer.amountCents : previous.amountCents;
    const line = budgetSummary(s.budget).lines.find((entry) => entry.id === previous.lineId);
    if (!line || line.available < removed)
      throw new Error("Cet argent a déjà été dépensé dans l’enveloppe ; ce transfert ne peut plus être réduit ou déplacé.");
  }
  return withBudget(s, {
    ...s.budget,
    potTransfers: previous
      ? s.budget.potTransfers.map((entry) => entry.id === transfer.id ? transfer : entry)
      : [...s.budget.potTransfers, transfer],
  });
}
export function removePotTransfer(s: AppState, id: string) {
  active(s);
  const transfer = s.budget.potTransfers.find((entry) => entry.id === id);
  if (!transfer) throw new Error("Ce transfert n’existe pas.");
  editableLine(s, transfer.lineId);
  const line = budgetSummary(s.budget).lines.find((entry) => entry.id === transfer.lineId);
  if (!line || line.available < transfer.amountCents)
    throw new Error("Cet argent a déjà été dépensé dans l’enveloppe ; ce transfert ne peut plus être annulé.");
  return withBudget(s, { ...s.budget, potTransfers: s.budget.potTransfers.filter((entry) => entry.id !== id) });
}
export function resetState(s: AppState) {
  const clean = initialState(s.budget.id);
  return validateState({
    ...clean,
    configured: s.configured,
    revision: s.revision,
    potSequence: s.potSequence,
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
        openingPotCents: 0,
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
    potSequence: s.potSequence,
    members,
    budget: { ...clean.budget, members },
  });
}
