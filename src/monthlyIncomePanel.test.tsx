import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MonthlyIncomePanel } from "./MonthlyIncomePanel";
import { AppState, euro } from "./domain";
import { closeMonth, configureHousehold, initialState, saveLine, savePayment } from "./store";

const state = configureHousehold(
  initialState("2026-08"), ["Jean", "Miruna"], [300000, 200000], "2026-08",
);
const render = (value: AppState, readOnly = false) => renderToStaticMarkup(
  <MonthlyIncomePanel state={value} readOnly={readOnly} edit={vi.fn()} prepare={vi.fn()} />,
);

describe("accès aux salaires du mois", () => {
  it("affiche les salaires du budget ouvert et les deux accès de modification", () => {
    const html = render(state);
    expect(html).toContain("Salaires du mois");
    expect(html).toContain("août 2026");
    expect(html).toContain(euro(300000));
    expect(html).toContain(euro(200000));
    expect(html).toContain("Modifier les salaires");
    expect(html).toContain("Préparer les salaires pour septembre 2026");
    expect(html).not.toContain("Salaires préparés pour");
  });
  it("laisse consulter les salaires et la préparation sans bouton au lecteur", () => {
    const prepared = configureHousehold(state, ["Jean", "Miruna"], [301234, 202345], "2026-09");
    const html = render(prepared, true);
    expect(html).not.toContain("<button");
    expect(html).toContain("Salaires préparés pour septembre 2026");
    expect(html).toContain(euro(301234));
    expect(html).toContain(euro(202345));
    // Le profil contient déjà les prochains revenus ; l’encart courant garde ceux du mois ouvert.
    expect(html).toContain(euro(300000));
    expect(html).toContain(euro(200000));
  });
  it("verrouille le mois clôturé tout en permettant de préparer le suivant", () => {
    let funded = saveLine(state, { ...state.budget.lines.find((line) => line.id === "courses")!, plannedCents: 10000 });
    for (const member of funded.budget.members) {
      funded = savePayment(funded, {
        id: `paid-${member.id}`, memberId: member.id, amountCents: 5000,
        date: "2026-08-01", note: "Contribution reçue",
      });
    }
    const closed = closeMonth(funded);
    const html = render(closed);
    expect(html).toContain("Ce mois est clôturé");
    expect(html).not.toContain("Modifier les salaires");
    expect(html).toContain("Préparer les salaires pour septembre 2026");
    expect(render(closed, true)).not.toContain("<button");
  });
  it("ne présente comme préparé que le mois suivant explicitement renseigné", () => {
    const later = configureHousehold(state, ["Jean", "Miruna"], [350000, 250000], "2026-10");
    expect(render(later)).not.toContain("Salaires préparés pour");
    const same = configureHousehold(state, ["Jean", "Miruna"], [300000, 200000], "2026-09");
    expect(render(same)).toContain("Salaires préparés pour septembre 2026");
  });
});
