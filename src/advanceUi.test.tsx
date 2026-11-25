import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentForm } from "./forms";
import { FutureBudgetPanel } from "./FutureBudgetPanel";
import { AdvanceUseForm } from "./AdvanceUseForm";
import { Dashboard } from "./Overview";
import { Transactions, type Actions } from "./screens";
import { budgetSummary, euro } from "./domain";
import { closeMonth, configureHousehold, initialState, saveAdvancePayment, saveLine, savePayment, startNextMonth, useAdvance } from "./store";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T12:00:00+01:00")); });
afterEach(() => vi.useRealTimers());
function setup() {
  let s = configureHousehold(initialState("2026-11"), ["Camille", "Alex"], [300000, 200000], "2026-11");
  s = { ...s, budget: { ...s.budget, lines: [] } };
  s = saveLine(s, { id: "daily", name: "Courses", expenseGroup: "DAILY_LIFE", kind: "VARIABLE", plannedCents: 100000 });
  for (const member of budgetSummary(s.budget).balances) s = savePayment(s, { id: member.id, memberId: member.id, amountCents: member.remaining, date: "2026-11-01", note: "" });
  return saveAdvancePayment(s, { id: "early", memberId: "jean", amountCents: 50000, date: "2026-11-05", receivedMonth: "2026-11", month: "2026-12", note: "Salaire reçu tôt" });
}
const callbacks = { add: vi.fn(), edit: vi.fn(), use: vi.fn(), remove: vi.fn(), returnUse: vi.fn() };
describe("interface des avances", () => {
  it("permet de choisir le mois sans imposer le 25 comme date minimum", () => {
    const s = setup();
    const html = renderToStaticMarkup(<PaymentForm state={s} defaultMonth="2026-12" busy={false} submit={vi.fn()} />);
    expect(html).toContain('value="2026-12" selected=""');
    expect(html).toContain('min="2026-11-01"');
    expect(html).not.toContain('min="2026-11-25"');
    expect(html).toContain("réservé");
    expect(html).toContain("Qui a versé");
  });
  it("montre la prévision et les avances aux lecteurs sans action d’édition", () => {
    const s = useAdvance(setup(), { id: "use", advanceId: "early", amountCents: 5000, date: "2026-11-10", note: "Imprévu" });
    const html = renderToStaticMarkup(<FutureBudgetPanel state={s} {...callbacks} readOnly />);
    expect(html).toContain("Prévision du mois prochain");
    expect(html).toContain("Salaires habituels repris");
    expect(html).toContain(euro(50000));
    expect(html).toContain(euro(45000));
    expect(html).toContain(euro(5000));
    expect(html).toContain("Complément à verser");
    expect(html).not.toContain("<button");
    const editor = renderToStaticMarkup(<FutureBudgetPanel state={s} {...callbacks} />);
    expect(editor).toContain("Utiliser une partie");
    expect(editor).toContain("Rendre à l’avance");
    expect(editor).toContain("Modifier l’avance");
  });
  it("présente les deux soldes et distingue les destinations d’une utilisation", () => {
    const s = setup();
    const html = renderToStaticMarkup(<Dashboard state={s} />);
    expect(html).toContain("Solde réel du compte commun");
    expect(html).toContain("Solde hors avances");
    expect(html).toContain(euro(150000));
    expect(html).toContain(euro(100000));
    const form = renderToStaticMarkup(<AdvanceUseForm state={s} advanceId="early" busy={false} submit={vi.fn()} />);
    expect(form).toContain("Pot commun");
    expect(form).toContain("Courses");
    expect(form).toContain('min="2026-11-05"');
    expect(form).toContain("complément de Camille");
  });
  it("conserve les avances précédentes et protège les versements déjà repris", () => {
    const s = startNextMonth(closeMonth(setup()));
    const html = renderToStaticMarkup(<FutureBudgetPanel state={s} {...callbacks} />);
    expect(html).toContain("Historique des avances précédentes");
    expect(html).toContain("Salaire reçu tôt");
    const transactions = renderToStaticMarkup(<Transactions budget={s.budget} actions={{} as Actions} mode="payments" />);
    expect(transactions).toContain("Avance affectée à");
    expect(transactions).not.toContain("Modifier l’opération");
    expect(transactions).not.toContain("Supprimer l’opération");
  });
});
