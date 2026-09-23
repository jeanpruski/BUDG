import { describe, expect, it } from "vitest";
import {
  AppState,
  accountBalance,
  budgetSummary,
  closeBudget,
  parseMoney,
  potSummary,
  sharesFor,
  splitAmount,
  validateState,
} from "./domain";
import {
  closeMonth,
  configureHousehold,
  confirmMonthlyIncomes,
  initialState,
  savePotExpense,
  removePotExpense,
  removeExpense,
  removeLine,
  removePayment,
  resetState,
  resetEverything,
  saveExpense,
  saveLine,
  savePayment,
  setSettled,
  startNextMonth,
} from "./store";

function setup(): AppState {
  const s = configureHousehold(
    initialState("2026-08"),
    ["Jean", "Miruna"],
    [300000, 200000],
    "2026-08",
  );
  return { ...s, budget: { ...s.budget, lines: [] } };
}
function line(
  s: AppState,
  id: string,
  amount: number,
  group: "HOUSING" | "DAILY_LIFE" = "DAILY_LIFE",
  kind: "FIXED" | "VARIABLE" | "RESERVE" = "VARIABLE",
) {
  return saveLine(s, {
    id,
    name: id,
    plannedCents: amount,
    expenseGroup: group,
    kind,
  });
}
function payment(s: AppState, memberId: string, amount: number) {
  return savePayment(s, {
    id: `p-${memberId}-${s.budget.payments.length}`,
    memberId,
    amountCents: amount,
    date: `${s.budget.id}-01`,
    note: "",
  });
}
function spend(s: AppState, id: string, amount: number, settled = false) {
  return saveExpense(
    s,
    {
      id: `e-${s.budget.expenses.length}`,
      lineId: id,
      amountCents: amount,
      date: `${s.budget.id}-02`,
      description: "Achat",
    },
    settled,
  );
}
function paid(s: AppState) {
  for (const member of budgetSummary(s.budget).balances)
    if (member.remaining) s = payment(s, member.id, member.remaining);
  return s;
}
describe("calculs et validation des montants", () => {
  it("conserve chaque centime et départage de façon stable", () =>
    expect(splitAmount(100, [1, 1, 1], ["a", "b", "c"])).toEqual([34, 33, 33]));
  it("rejette NaN, Infinity, les nombres négatifs et les identifiants dupliqués", () => {
    for (const weights of [
      [NaN, 1],
      [Infinity, 1],
      [-1, 1],
      [0, 0],
    ])
      expect(() => splitAmount(100, weights, ["a", "b"])).toThrow();
    expect(() => splitAmount(1, [1, 1], ["a", "a"])).toThrow();
  });
  it("accepte zéro sans revenu mais refuse un prorata positif sans revenu", () => {
    expect(splitAmount(0, [0, 0], ["a", "b"])).toEqual([0, 0]);
    expect(() => sharesFor(100, "PRO_RATA", initialState().members)).toThrow();
  });
  it("lit correctement les euros français sans accepter un montant ambigu", () => {
    expect(parseMoney("1 234,56")).toBe(123456);
    for (const value of [
      "abc",
      "NaN",
      "Infinity",
      "-10",
      "1.234",
      "1e3",
      "",
      "0",
      "0,001",
    ])
      expect(() => parseMoney(value)).toThrow();
    expect(parseMoney("0", true)).toBe(0);
  });
  it("ne crée aucune opération fictive au démarrage", () => {
    const s = initialState("2026-09");
    expect(s.budget.id).toBe("2026-09");
    expect(s.budget.payments).toEqual([]);
    expect(s.budget.expenses).toEqual([]);
    expect(accountBalance(s)).toBe(0);
  });
});
describe("enveloppes réellement financées", () => {
  it("ne confond jamais prévu, reçu et dépensé", () => {
    let s = line(setup(), "courses", 50000);
    expect(budgetSummary(s.budget).lines[0].available).toBe(0);
    s = payment(s, "jean", 25000);
    expect(budgetSummary(s.budget).lines[0].available).toBe(25000);
    s = payment(s, "miruna", 25000);
    s = spend(s, "courses", 8640);
    expect(budgetSummary(s.budget).lines[0].available).toBe(41360);
    expect(accountBalance(s)).toBe(41360);
  });
  it("répartit les versements partiels sans créer de centimes", () => {
    let s = line(line(setup(), "appart", 100000, "HOUSING"), "courses", 50000);
    s = payment(s, "jean", 30001);
    s = payment(s, "miruna", 10001);
    const summary = budgetSummary(s.budget);
    expect(summary.lines.reduce((n, l) => n + l.funded, 0)).toBe(40002);
    expect(summary.missingCents).toBe(109998);
  });
  it("signale les dépassements et demande les compléments à chacun", () => {
    let s = paid(line(setup(), "courses", 50000));
    s = spend(s, "courses", 56000);
    expect(budgetSummary(s.budget).balances.map((m) => m.remaining)).toEqual([
      3000, 3000,
    ]);
    expect(() => closeMonth(s)).toThrow(/versements/i);
    s = paid(s);
    expect(budgetSummary(s.budget).lines[0].available).toBe(0);
    expect(closeMonth(s).budget.closedPotCents).toBe(0);
  });
  it("corrige une dépense sans l’ajouter deux fois", () => {
    let s = paid(line(setup(), "courses", 50000));
    s = spend(s, "courses", 10000);
    s = saveExpense(s, { ...s.budget.expenses[0], amountCents: 5000 }, false);
    expect(s.budget.expenses).toHaveLength(1);
    expect(accountBalance(s)).toBe(45000);
    s = removeExpense(s, s.budget.expenses[0].id);
    expect(accountBalance(s)).toBe(50000);
  });
  it("corrige et supprime un versement", () => {
    let s = payment(line(setup(), "courses", 50000), "jean", 20000);
    s = savePayment(s, { ...s.budget.payments[0], amountCents: 25000 });
    expect(budgetSummary(s.budget).paid.jean).toBe(25000);
    expect(s.budget.payments).toHaveLength(1);
    expect(
      removePayment(s, s.budget.payments[0].id).budget.payments,
    ).toHaveLength(0);
  });
  it("ne supprime pas une enveloppe contenant des dépenses", () => {
    const s = spend(line(setup(), "courses", 50000), "courses", 1000);
    expect(() => removeLine(s, "courses")).toThrow();
  });
});
describe("clôture et pot commun", () => {
  it("garde toutes les économies sur le compte et dans le pot commun", () => {
    let s = paid(
      line(line(setup(), "appart", 100000, "HOUSING"), "courses", 50000),
    );
    s = spend(spend(s, "appart", 80000), "courses", 42000);
    expect(potSummary(s).availableCents).toBe(0);
    const before = accountBalance(s);
    s = closeMonth(s);
    expect(s.budget.refunds).toEqual([]);
    expect(s.budget.closedPotCents).toBe(28000);
    expect(potSummary(s).availableCents).toBe(28000);
    expect(accountBalance(s)).toBe(before);
  });
  it("conserve aussi un versement supérieur à la contribution dans le pot commun", () => {
    let s = paid(line(setup(), "courses", 50000));
    s = spend(payment(s, "jean", 10000), "courses", 42000);
    expect(closeMonth(s).budget.closedPotCents).toBe(18000);
  });
  it("la clôture n’alimente le pot qu’une seule fois", () => {
    const s = closeMonth(paid(line(setup(), "courses", 50000)));
    expect(closeBudget(s.budget)).toBe(s.budget);
    expect(closeMonth(s)).toEqual(s);
    expect(potSummary(closeMonth(s)).availableCents).toBe(50000);
  });
  it("bloque toutes les mutations financières après clôture", () => {
    const s = closeMonth(paid(line(setup(), "courses", 50000)));
    expect(() => spend(s, "courses", 1000)).toThrow(/clôturé/);
    expect(() => payment(s, "jean", 1000)).toThrow(/clôturé/);
    expect(() => removeExpense(s, "x")).toThrow(/clôturé/);
    expect(() => removePayment(s, "x")).toThrow(/clôturé/);
    expect(() => line(s, "x", 1000)).toThrow(/clôturé/);
    expect(() => removeLine(s, "courses")).toThrow(/clôturé/);
    expect(() => setSettled(s, "courses", true)).toThrow(/clôturé/);
  });
  it("ne verse pas au pot l’argent d’une facture encore attendue", () => {
    let s = paid(line(setup(), "electricite", 10000, "HOUSING", "FIXED"));
    expect(() => closeMonth(s)).toThrow(/factures/);
    s = spend(s, "electricite", 8000, true);
    expect(closeMonth(s).budget.status).toBe("CLOSED");
  });
});
describe("réserves et passage au mois suivant", () => {
  it("sépare les réserves vacances du pot et conserve les contributions du mois suivant", () => {
    let s = paid(
      line(
        line(setup(), "vacances", 20000, "DAILY_LIFE", "RESERVE"),
        "courses",
        50000,
      ),
    );
    s = spend(s, "courses", 40000);
    s = closeMonth(s);
    expect(s.budget.closedPotCents).toBe(10000);
    s = startNextMonth(s);
    expect(s.budget.id).toBe("2026-09");
    expect(
      budgetSummary(s.budget).lines.find((l) => l.id === "vacances")?.available,
    ).toBe(20000);
    expect(s.budget.payments).toHaveLength(0);
    expect(accountBalance(s)).toBe(30000);
    expect(potSummary(s).availableCents).toBe(10000);
    expect(budgetSummary(s.budget).missingCents).toBe(70000);
    expect(
      budgetSummary(s.budget).lines.find((l) => l.id === "vacances")?.available,
    ).toBe(20000);
  });
  it("préserve la propriété des réserves malgré un changement de salaire", () => {
    let s = closeMonth(
      paid(line(setup(), "taxe", 10000, "HOUSING", "RESERVE")),
    );
    s = configureHousehold(s, ["Jean", "Miruna"], [100000, 300000], "2026-09");
    s = paid(startNextMonth(s));
    const l = s.budget.lines[0];
    expect(l.openingShares.map((x) => x.amountCents)).toEqual([6000, 4000]);
    expect(l.shares.map((x) => x.amountCents)).toEqual([2500, 7500]);
    s = spend(s, "taxe", 10000);
    s = closeMonth(s);
    expect(s.budget.closedPotCents).toBe(0);
    expect(budgetSummary(s.budget).reservedCents).toBe(10000);
  });
  it("empêche de perdre une réserve en supprimant ou transformant son enveloppe", () => {
    const s = startNextMonth(
      closeMonth(
        paid(line(setup(), "vacances", 10000, "DAILY_LIFE", "RESERVE")),
      ),
    );
    expect(() => removeLine(s, "vacances")).toThrow();
    expect(() =>
      line(s, "vacances", 10000, "DAILY_LIFE", "VARIABLE"),
    ).toThrow();
  });
  it("n’ouvre pas le mois suivant avant la clôture", () =>
    expect(() => startNextMonth(setup())).toThrow());
  it("passe correctement de décembre à janvier", () => {
    let s = setup();
    s = {
      ...s,
      budget: { ...s.budget, id: "2025-12", label: "décembre 2025" },
      incomeHistory: s.incomeHistory.map((h) => ({
        ...h,
        effectiveFrom: "2025-12",
      })),
    };
    s = startNextMonth(closeMonth(paid(line(s, "courses", 10000))));
    expect(s.budget.id).toBe("2026-01");
  });
});
describe("revenus et sauvegardes", () => {
  it("démarre un mois antérieur sans conserver de faux revenus futurs", () => {
    let s = configureHousehold(
      initialState("2026-09"),
      ["Jean", "Miruna"],
      [300000, 200000],
      "2026-08",
      "2026-08",
    );
    s = startNextMonth(closeMonth(paid(line(s, "appart", 100000, "HOUSING"))));
    expect(s.budget.members.map((m) => m.incomeCents)).toEqual([
      300000, 200000,
    ]);
  });
  it("applique le salaire programmé au bon mois sans réécrire le mois clôturé", () => {
    let s = line(setup(), "appart", 100000, "HOUSING");
    s = configureHousehold(s, ["Jean", "Miruna"], [400000, 100000], "2026-09");
    expect(s.budget.lines[0].shares.map((x) => x.amountCents)).toEqual([
      60000, 40000,
    ]);
    s = closeMonth(paid(s));
    const closed = s.budget;
    s = startNextMonth(s);
    expect(s.budget.lines[0].shares.map((x) => x.amountCents)).toEqual([
      80000, 20000,
    ]);
    expect(s.archivedBudgets[0]).toEqual(closed);
  });
  it("une correction ancienne ne supplante pas un salaire plus récent", () => {
    let s = line(setup(), "appart", 100000, "HOUSING");
    s = configureHousehold(s, ["Jean", "Miruna"], [100000, 400000], "2026-07");
    expect(s.budget.lines[0].shares.map((x) => x.amountCents)).toEqual([
      60000, 40000,
    ]);
  });
  it("la réinitialisation conserve les revenus et enveloppes personnalisés", () => {
    const s = paid(line(setup(), "special", 12345));
    const clean = resetState(s);
    expect(clean.budget.lines).toEqual(s.budget.lines);
    expect(clean.members).toEqual(s.members);
    expect(clean.incomeHistory).toEqual(s.incomeHistory);
    expect(clean.budget.payments).toEqual([]);
    expect(clean.budget.id).toBe("2026-08");
  });
  it("rejette un JSON incomplet, un montant invalide et une dépense orpheline", () => {
    expect(() => validateState({})).toThrow();
    const s = spend(line(setup(), "courses", 50000), "courses", 10000);
    expect(() =>
      validateState({
        ...s,
        budget: {
          ...s.budget,
          expenses: [{ ...s.budget.expenses[0], amountCents: NaN }],
        },
      }),
    ).toThrow();
    expect(() =>
      validateState({ ...s, budget: { ...s.budget, lines: [] } }),
    ).toThrow();
    expect(() =>
      saveExpense(s, { ...s.budget.expenses[0], date: "2026-09-01" }, false),
    ).toThrow();
    expect(() =>
      saveExpense(s, { ...s.budget.expenses[0], date: "2026-02-31" }, false),
    ).toThrow();
  });
  it("rejette une clôture ou une répartition falsifiée", () => {
    const s = closeMonth(paid(line(setup(), "courses", 50000)));
    expect(() =>
      validateState({
        ...s,
        budget: {
          ...s.budget,
          closedPotCents: 1,
        },
      }),
    ).toThrow();
    expect(() =>
      validateState({
        ...s,
        budget: {
          ...s.budget,
          lines: s.budget.lines.map((l) => ({ ...l, plannedCents: 42 })),
        },
      }),
    ).toThrow();
  });
  it("conserve le solde sur deux mois avec réserves et pot commun", () => {
    let s = paid(
      line(
        line(setup(), "courses", 50001),
        "reserve",
        12345,
        "HOUSING",
        "RESERVE",
      ),
    );
    s = closeMonth(spend(s, "courses", 43219));
    expect(accountBalance(s)).toBe(12345 + 6782);
    expect(potSummary(s).availableCents).toBe(6782);
    s = paid(startNextMonth(s));
    s = spend(spend(s, "reserve", 6789), "courses", 23001);
    s = closeMonth(s);
    expect(potSummary(s).availableCents).toBe(6782 + 27000);
    expect(accountBalance(s)).toBe(
      budgetSummary(s.budget).reservedCents + potSummary(s).availableCents,
    );
  });
});
describe("dépenses du pot commun", () => {
  const fromPot = (s: AppState, amount = 1234, date = "2026-08-31") =>
    savePotExpense(s, {
      id: "pot-1",
      amountCents: amount,
      date,
      description: "Sortie à deux",
    });
  it("déduit une dépense une seule fois du compte et du pot sans toucher aux contributions", () => {
    let s = closeMonth(paid(line(setup(), "courses", 50000)));
    s = startNextMonth(s);
    const expected = budgetSummary(s.budget).expected;
    s = fromPot(s);
    expect(accountBalance(s)).toBe(48766);
    expect(potSummary(s).availableCents).toBe(48766);
    expect(budgetSummary(s.budget).expected).toEqual(expected);
    expect(s.budget.expenses).toEqual([]);
    s = fromPot(s, 2000);
    expect(s.potExpenses).toHaveLength(1);
    expect(accountBalance(s)).toBe(48000);
    s = removePotExpense(s, "pot-1");
    expect(potSummary(s).availableCents).toBe(50000);
  });
  it("refuse un pot vide, un dépassement et une dépense antérieure à son alimentation", () => {
    expect(() => fromPot(paid(line(setup(), "courses", 50000)))).toThrow();
    const s = closeMonth(paid(line(setup(), "courses", 50000)));
    expect(() => fromPot(s, 50001)).toThrow(/dépasse/);
    expect(() => fromPot(s, 1000, "2026-07-31")).toThrow(/date/);
  });
  it("efface le pot lors d’une réinitialisation en conservant la configuration", () => {
    const s = fromPot(closeMonth(paid(line(setup(), "courses", 50000))));
    const reset = resetState(s);
    expect(potSummary(reset).availableCents).toBe(0);
    expect(reset.potExpenses).toEqual([]);
    expect(reset.budget.lines[0].plannedCents).toBe(50000);
  });
});
describe("migration des sauvegardes précédentes", () => {
  function legacy(paidOn?: string) {
    const s = closeMonth(
      spend(paid(line(setup(), "courses", 50000)), "courses", 42000),
    );
    const { potExpenses, ...old } = s;
    const { closedPotCents, ...budget } = old.budget;
    return {
      ...old,
      version: 3,
      budget: {
        ...budget,
        refunds: [
          { memberId: "jean", amountCents: 4000, paidOn },
          { memberId: "miruna", amountCents: 4000 },
        ],
      },
    };
  }
  it("transforme les remboursements non effectués en pot sans modifier le solde", () => {
    const s = validateState(legacy());
    expect(s.version).toBe(4);
    expect(potSummary(s).availableCents).toBe(8000);
    expect(accountBalance(s)).toBe(8000);
    expect(s.budget.refunds).toEqual([]);
    expect(validateState(s)).toEqual(s);
  });
  it("préserve les virements déjà réellement effectués et ne les remet pas dans le pot", () => {
    const s = validateState(legacy("2026-08-31"));
    expect(potSummary(s).availableCents).toBe(4000);
    expect(accountBalance(s)).toBe(4000);
    expect(s.budget.refunds).toHaveLength(1);
  });
  it("refuse une ancienne clôture incohérente", () => {
    const s = legacy();
    s.budget.refunds[0].amountCents = 100;
    expect(() => validateState(s)).toThrow(/clôture/);
  });
});

describe("confirmation mensuelle des salaires", () => {
  it("recalcule le logement et conserve le 50/50 sans modifier les archives", () => {
    const closed = closeMonth(
      paid(line(line(setup(), "appart", 100000, "HOUSING"), "courses", 50000)),
    );
    const next = confirmMonthlyIncomes(closed, [400000, 100000]);
    expect(next.budget.members.map((m) => m.incomeCents)).toEqual([
      400000, 100000,
    ]);
    expect(next.budget.lines[0].shares.map((s) => s.amountCents)).toEqual([
      80000, 20000,
    ]);
    expect(next.budget.lines[1].shares.map((s) => s.amountCents)).toEqual([
      25000, 25000,
    ]);
    expect(next.archivedBudgets[0]).toEqual(closed.budget);
    expect(next.budget.payments).toEqual([]);
  });
  it("permet de confirmer les anciens salaires à la place d’un changement programmé", () => {
    const scheduled = configureHousehold(
      setup(),
      ["Jean", "Miruna"],
      [400000, 100000],
      "2026-09",
    );
    const next = confirmMonthlyIncomes(
      closeMonth(paid(line(scheduled, "appart", 100000, "HOUSING"))),
      [300000, 200000],
    );
    expect(next.budget.lines[0].shares.map((s) => s.amountCents)).toEqual([
      60000, 40000,
    ]);
    expect(
      next.incomeHistory
        .filter((h) => h.effectiveFrom === "2026-09")
        .map((h) => h.amountCents),
    ).toEqual([300000, 200000]);
  });
  it("refuse des revenus invalides et un mois non clôturé", () => {
    const closed = closeMonth(paid(line(setup(), "courses", 50000)));
    expect(() => confirmMonthlyIncomes(closed, [0, 0])).toThrow();
    expect(() => confirmMonthlyIncomes(closed, [-100, 200000])).toThrow();
    expect(() => confirmMonthlyIncomes(setup(), [300000, 200000])).toThrow();
  });
});

it("réinitialise tout le foyer et revient au démarrage sans anciens revenus", () => {
  const previous = {
    ...configureHousehold(
      setup(),
      ["Alice", "Bob"],
      [450000, 220000],
      "2027-01",
    ),
    revision: 12,
  };
  const clean = resetEverything(previous);
  expect(clean.configured).toBe(false);
  expect(clean.revision).toBe(12);
  expect(clean.members.map((m) => m.incomeCents)).toEqual([0, 0]);
  expect(clean.members.map((m) => m.name)).toEqual([
    "Personne 1",
    "Personne 2",
  ]);
  expect(clean.incomeHistory.every((h) => h.amountCents === 0)).toBe(true);
  expect(clean.incomeHistory).toHaveLength(2);
  expect(clean.budget.lines.every((l) => l.plannedCents === 0)).toBe(true);
  expect(clean.budget.payments).toEqual([]);
  expect(clean.budget.expenses).toEqual([]);
  expect(clean.archivedBudgets).toEqual([]);
  expect(clean.potExpenses).toEqual([]);
  expect(previous.members[0].incomeCents).toBe(450000);
});

describe("répartition au choix par enveloppe", () => {
  const custom = [
    { memberId: "jean", percent: 70 },
    { memberId: "miruna", percent: 30 },
  ];
  it("autorise 50/50 pour le logement et le prorata pour le quotidien", () => {
    let s = line(
      line(setup(), "logement", 100000, "HOUSING"),
      "courses",
      50000,
    );
    s = saveLine(s, { ...s.budget.lines[0], allocationType: "FIFTY_FIFTY" });
    s = saveLine(s, { ...s.budget.lines[1], allocationType: "PRO_RATA" });
    expect(
      s.budget.lines.map((l) => l.shares.map((p) => p.amountCents)),
    ).toEqual([
      [50000, 50000],
      [30000, 20000],
    ]);
  });
  it("préserve le manuel malgré un changement de salaire et le passage de mois", () => {
    let s = line(setup(), "courses", 10001);
    s = saveLine(s, {
      ...s.budget.lines[0],
      allocationType: "CUSTOM",
      customPercentages: custom,
    });
    expect(s.budget.lines[0].shares.map((p) => p.amountCents)).toEqual([
      7001, 3000,
    ]);
    s = configureHousehold(s, ["Jean", "Miruna"], [100000, 400000], "2026-08");
    expect(s.budget.lines[0].shares.map((p) => p.amountCents)).toEqual([
      7001, 3000,
    ]);
    s = startNextMonth(closeMonth(paid(s)));
    expect(s.budget.lines[0].customPercentages).toEqual(custom);
    expect(s.budget.lines[0].shares.map((p) => p.amountCents)).toEqual([
      7001, 3000,
    ]);
    expect(validateState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("répartit les achats non prévus selon le manuel, même à budget zéro", () => {
    let s = line(setup(), "courses", 0);
    s = saveLine(s, {
      ...s.budget.lines[0],
      allocationType: "CUSTOM",
      customPercentages: custom,
    });
    s = saveExpense(
      s,
      {
        id: "achat",
        lineId: "courses",
        date: "2026-08-01",
        amountCents: 10000,
        description: "Achat",
      },
      false,
    );
    expect(budgetSummary(s.budget).lines[0].costs).toEqual([7000, 3000]);
  });
  it("garde la propriété des réserves déjà reportées lors d’un nouveau choix", () => {
    let s = line(setup(), "projet", 10000, "DAILY_LIFE", "RESERVE");
    s = startNextMonth(closeMonth(paid(s)));
    const opening = s.budget.lines[0].openingShares;
    s = saveLine(s, {
      ...s.budget.lines[0],
      allocationType: "CUSTOM",
      customPercentages: custom,
    });
    expect(s.budget.lines[0].openingShares).toEqual(opening);
    expect(s.budget.lines[0].shares.map((p) => p.amountCents)).toEqual([
      7000, 3000,
    ]);
  });
  it("refuse un total invalide et les personnes dupliquées, accepte 100/0", () => {
    const s = line(setup(), "courses", 10000);
    for (const parts of [
      [
        { memberId: "jean", percent: 60 },
        { memberId: "miruna", percent: 60 },
      ],
      [
        { memberId: "jean", percent: 50 },
        { memberId: "jean", percent: 50 },
      ],
    ])
      expect(() =>
        saveLine(s, {
          ...s.budget.lines[0],
          allocationType: "CUSTOM",
          customPercentages: parts,
        }),
      ).toThrow();
    const result = saveLine(s, {
      ...s.budget.lines[0],
      allocationType: "CUSTOM",
      customPercentages: [
        { memberId: "jean", percent: 100 },
        { memberId: "miruna", percent: 0 },
      ],
    });
    expect(result.budget.lines[0].shares.map((p) => p.amountCents)).toEqual([
      10000, 0,
    ]);
  });
});
