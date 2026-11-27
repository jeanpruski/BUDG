import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvelopeUsage } from "./EnvelopeUsage";
import { EnvelopeCard } from "./EnvelopeCard";
import { EnvelopeMonthClosing } from "./EnvelopeMonthClosing";
import { BillClosing } from "./BillClosing";
import { budgetSummary, euro } from "./domain";
import { configureHousehold, initialState, saveExpense, saveLine, saveScheduledExpense } from "./store";
import type { Actions } from "./screens";

describe("barre des paiements réels et prévus", () => {
  it("réserve deux segments proportionnels distincts sans présenter les prévisions comme payées", () => {
    const html = renderToStaticMarkup(<EnvelopeUsage name="Courses" spentCents={4000} scheduledCents={3500} capacityCents={10000} />);
    expect(html).toContain('class="envelope-usage-paid" style="width:40%"');
    expect(html).toContain('class="envelope-usage-planned" style="width:35%"');
    expect(html).toContain('aria-valuenow="7500"');
    expect(html).toContain(`${euro(2500)} restants`);
    expect(html).toContain(`${euro(4000)} payés`);
    expect(html).toContain(`${euro(3500)} prévus`);
  });
  it("borne les segments à 100 % et rend explicite un dépassement annoncé", () => {
    const html = renderToStaticMarkup(<EnvelopeUsage name="Courses" spentCents={4000} scheduledCents={9000} capacityCents={10000} />);
    expect(html).toContain('class="envelope-usage-planned" style="width:60%"');
    expect(html).toContain('aria-valuenow="10000"');
    expect(html).toContain(`Dépassement prévu : ${euro(3000)}`);
    const empty = renderToStaticMarkup(<EnvelopeUsage name="Courses" spentCents={0} capacityCents={0} />);
    expect(empty).not.toMatch(/NaN|Infinity/);
    expect(empty).not.toContain("prévu</span>");
  });
  it("exclut les prévisions du mois suivant et des autres enveloppes de la carte", () => {
    let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
    s = { ...s, budget: { ...s.budget, lines: [] } };
    for (const id of ["bill", "other"]) s = saveLine(s, { id, name: id, kind: "FIXED", expenseGroup: "HOUSING", plannedCents: 10000 });
    s = saveExpense(s, { id: "paid", lineId: "bill", amountCents: 4000, date: "2026-11-01", description: "" }, false);
    for (const [id, lineId, date, amountCents] of [["now", "bill", "2026-11-29", 3500], ["next", "bill", "2026-12-05", 5000], ["other", "other", "2026-11-29", 6000]] as const)
      s = saveScheduledExpense(s, { id, lineId, date, amountCents, description: "" });
    const html = renderToStaticMarkup(<EnvelopeCard budget={s.budget} line={budgetSummary(s.budget).lines[0]} scheduledExpenses={s.scheduledExpenses} actions={{} as Actions} readOnly compact={false} potAvailableCents={0} />);
    expect(html).toContain('class="envelope-usage-planned" style="width:35%"');
    expect(html).toContain(`${euro(3500)} prévus`);
    expect(html).not.toContain(euro(5000));
    expect(html).not.toContain(euro(6000));
  });
  it("propose le pot pour les factures et les budgets courants, et le report pour les réserves", () => {
    let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
    s = { ...s, budget: { ...s.budget, lines: [] } };
    for (const kind of ["FIXED", "VARIABLE", "RESERVE"] as const) s = saveLine(s, { id: kind, name: kind, kind, expenseGroup: "HOUSING", plannedCents: 10000 });
    const actions = { closeBill: () => {}, finishEnvelopeMonth: () => {} } as unknown as Actions;
    for (const line of budgetSummary(s.budget).lines) {
      const reserve = renderToStaticMarkup(<EnvelopeMonthClosing budget={s.budget} line={line} actions={actions} />);
      const pot = renderToStaticMarkup(<BillClosing budget={s.budget} line={line} actions={actions} potAvailableCents={0} />);
      if (line.kind === "RESERVE") { expect(reserve).toContain("Le solde reste dans cette enveloppe"); expect(pot).toBe(""); }
      else { expect(reserve).toBe(""); expect(pot).toContain("Le reste sera transféré au pot commun"); }
    }
  });
});
