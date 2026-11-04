import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvelopeExpenses } from "./EnvelopeExpenses";
import { configureHousehold, initialState } from "./store";
import type { Actions } from "./screens";

const actions: Actions = {
  expense: vi.fn(), payment: vi.fn(), line: vi.fn(), removeLine: vi.fn(),
  removeExpense: vi.fn(), removePayment: vi.fn(), settle: vi.fn(), close: vi.fn(),
  next: vi.fn(), potExpense: vi.fn(), removePotExpense: vi.fn(),
};
const base = configureHousehold(initialState("2026-08"), ["Camille", "Alex"], [300000, 200000], "2026-08").budget;
const line = base.lines.find((entry) => entry.id === "courses")!;
const budget = {
  ...base,
  expenses: [
    { id: "early", lineId: line.id, date: "2026-08-01", amountCents: 1234, description: "Premier achat" },
    { id: "other", lineId: "credit", date: "2026-08-03", amountCents: 20000, description: "Autre enveloppe" },
    { id: "later", lineId: line.id, date: "2026-08-02", amountCents: 2345, description: "Dernier achat" },
  ],
};

describe("dépenses dans une enveloppe", () => {
  it("présente uniquement les dépenses de l’enveloppe, récentes d’abord, sans modifier leur ordre enregistré", () => {
    const before = structuredClone(budget);
    const html = renderToStaticMarkup(<EnvelopeExpenses budget={budget} line={line} actions={actions} />);
    expect(html).toContain("Premier achat");
    expect(html).toContain("Dernier achat");
    expect(html).not.toContain("Autre enveloppe");
    expect(html.indexOf(">Dernier achat<")).toBeLessThan(html.indexOf(">Premier achat<"));
    expect(html).toContain("Voir les dépenses · Courses (2)");
    expect(html).toContain('aria-label="Modifier la dépense');
    expect(html).toContain('aria-label="Supprimer la dépense');
    expect(html).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/);
    expect(budget).toEqual(before);
  });

  it.each(["viewer", "closed"])("conserve les paiements consultables sans correction pour %s", (mode) => {
    const html = renderToStaticMarkup(<EnvelopeExpenses
      budget={{ ...budget, status: mode === "closed" ? "CLOSED" : "ACTIVE" }}
      line={line}
      actions={actions}
      readOnly={mode === "viewer"}
    />);
    expect(html).toContain("Dernier achat");
    expect(html).toContain("Voir les dépenses");
    expect(html).not.toContain("<button");
  });

  it("explique une liste vide et conserve un libellé pour un paiement sans description", () => {
    const empty = renderToStaticMarkup(<EnvelopeExpenses budget={{ ...budget, expenses: [] }} line={line} actions={actions} />);
    expect(empty).toContain("Aucune dépense enregistrée dans cette enveloppe");
    const html = renderToStaticMarkup(<EnvelopeExpenses budget={{ ...budget, expenses: [{ ...budget.expenses[0], description: "" }] }} line={line} actions={actions} />);
    expect(html).toContain('aria-label="Modifier la dépense Courses du');
  });
});
