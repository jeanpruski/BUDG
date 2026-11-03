import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvelopeAmountForm } from "./EnvelopeAmountForm";
import { BudgetLine, euro } from "./domain";

const line: BudgetLine = {
  id: "courses",
  name: "Courses",
  plannedCents: 20000,
  expenseGroup: "DAILY_LIFE",
  kind: "VARIABLE",
  allocationType: "FIFTY_FIFTY",
  shares: [{ memberId: "a", amountCents: 10000 }, { memberId: "b", amountCents: 10000 }],
  openingShares: [{ memberId: "a", amountCents: 0 }, { memberId: "b", amountCents: 0 }],
  settled: false,
};
const render = (value: BudgetLine = line, month = "2026-11", busy = false) => renderToStaticMarkup(
  <EnvelopeAmountForm line={value} budgetMonth={month} busy={busy} submit={vi.fn()} remove={vi.fn()} />,
);

describe("programmation du montant d’une enveloppe", () => {
  it("propose par défaut une exception sur le mois courant sans recopier ce montant", () => {
    const html = render();
    expect(html).toContain('name="amountMonth" min="2026-11"');
    expect(html).toContain('value="2026-11"');
    expect(html).toContain('name="amountScope"');
    expect(html).toContain('<option value="MONTH" selected="">Seulement ce mois</option>');
    expect(html).toContain('name="amount"');
    expect(html).toContain('value="200,00"');
    expect(html).toContain("Une exception ne se recopie pas au mois suivant");
    expect(html).toContain("novembre 2026");
    expect(html).toContain("décembre 2026");
    expect(html).toContain("janvier 2027");
    expect(html).not.toContain("Montants déjà programmés");
  });
  it("distingue le montant habituel, une exception et un changement durable au passage d’année", () => {
    const planned: BudgetLine = {
      ...line,
      amountPlan: {
        baseCents: 20000,
        changes: [{ fromMonth: "2026-10", amountCents: 24000 }, { fromMonth: "2027-01", amountCents: 18000 }],
        exceptions: [{ month: "2026-11", amountCents: 12345 }, { month: "2026-12", amountCents: 0 }],
      },
    };
    const html = render(planned);
    expect(html).toContain(`Montant habituel : <strong>${euro(24000)}</strong>`);
    expect(html).toContain('value="123,45"');
    expect(html).toContain(`<dt>novembre 2026</dt><dd>${euro(12345)}</dd>`);
    expect(html).toContain(`<dt>décembre 2026</dt><dd>${euro(0)}</dd>`);
    expect(html).toContain(`<dt>janvier 2027</dt><dd>${euro(18000)}</dd>`);
    expect(html).toContain("Seulement décembre 2026");
    expect(html).toContain("À partir de janvier 2027");
    expect(html).toContain('aria-label="Retirer l’exception de décembre 2026"');
    expect(html).toContain('aria-label="Retirer le montant habituel à partir de janvier 2027"');
    expect(html).not.toContain('aria-label="Retirer le montant habituel à partir de octobre 2026"');
  });
  it("accepte un montant nul avec ses décimales et conserve le montant habituel dans l’aperçu suivant", () => {
    const html = render({
      ...line,
      plannedCents: 0,
      amountPlan: { baseCents: 20000, changes: [], exceptions: [{ month: "2026-12", amountCents: 0 }] },
    }, "2026-12");
    expect(html).toContain('value="0,00"');
    expect(html).toContain(`<dt>décembre 2026</dt><dd>${euro(0)}</dd>`);
    expect(html).toContain(`<dt>janvier 2027</dt><dd>${euro(20000)}</dd>`);
    expect(html).toContain(`<dt>février 2027</dt><dd>${euro(20000)}</dd>`);
  });
  it("désactive saisie, enregistrement et retrait pendant la sauvegarde", () => {
    const html = render({
      ...line,
      amountPlan: { baseCents: 20000, changes: [], exceptions: [{ month: "2026-12", amountCents: 10000 }] },
    }, "2026-11", true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain("Enregistrement…");
    expect(html).toContain('disabled="" aria-label="Retirer l’exception de décembre 2026"');
  });
});
