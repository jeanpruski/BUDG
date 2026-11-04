import { describe, expect, it } from "vitest";
import { budgetSummary, validateState, type AppState } from "../src/domain";
import { closeBill, closeMonth, configureHousehold, initialState, reopenBill, saveExpense, saveLine, savePayment, savePotExpense, savePotTransfer, setSettled, startNextMonth } from "../src/store";
import { parseServerSnapshot, type ServerSnapshot } from "./jobs";
import { monthlyReportData, renderMonthlyReport } from "./monthlyReport";

function setup() {
  const state = configureHousehold(initialState("2026-08"), ["Camille", "Alex"], [300000, 200000], "2026-08");
  return { ...state, budget: { ...state.budget, lines: [] } };
}
function envelope(state: AppState, id: string, amount: number, group: "HOUSING" | "DAILY_LIFE", kind: "FIXED" | "VARIABLE" | "RESERVE" = "VARIABLE") {
  return saveLine(state, { id, name: id, plannedCents: amount, expenseGroup: group, kind });
}
function fund(state: AppState) {
  for (const member of budgetSummary(state.budget).balances) if (member.remaining) state = savePayment(state, {
    id: `payment-${state.budget.payments.length}`, memberId: member.id, amountCents: member.remaining,
    date: `${state.budget.id}-01`, note: "Virement reçu",
  });
  return state;
}
function expense(state: AppState, lineId: string, amountCents: number) {
  return saveExpense(state, { id: `expense-${state.budget.expenses.length}`, lineId, amountCents, date: `${state.budget.id}-02`, description: "Paiement enregistré" }, true);
}
function snapshot(state: AppState, month = state.budget.id): ServerSnapshot {
  return { format: "BUDG_SERVER_BACKUP", version: 1, kind: "monthly", month, createdAt: "2026-09-01T10:00:00Z", timeZone: "Europe/Paris", state: { ...state, revision: 20 }, audit: [] };
}
function history() {
  let state = envelope(setup(), "Logement", 100000, "HOUSING", "FIXED");
  state = envelope(state, "Taxe foncière", 20000, "HOUSING", "RESERVE");
  state = envelope(state, "Courses", 40000, "DAILY_LIFE");
  state = envelope(state, "Vacances", 20000, "DAILY_LIFE", "RESERVE");
  state = fund(state);
  state = expense(state, "Logement", 75000);
  state = expense(state, "Taxe foncière", 5000);
  state = expense(state, "Courses", 12345);
  state = closeMonth(state);
  state = savePotExpense(state, { id: "pot-august", amountCents: 5000, date: "2026-08-31", description: "Achat du pot" });
  state = startNextMonth(state);
  state = savePayment(state, { id: "future-payment", memberId: "jean", amountCents: 500000, date: "2026-09-01", note: "Hors du mois ciblé" });
  state = expense(state, "Courses", 1234);
  state = savePotExpense(state, { id: "pot-september", amountCents: 2000, date: "2026-09-01", description: "Hors du mois ciblé" });
  return snapshot(state, "2026-08");
}
function withTransfer() {
  const previous = closeMonth(fund(envelope(setup(), "Courses", 100000, "DAILY_LIFE")));
  let current = envelope(startNextMonth(previous), "Vacances", 60000, "DAILY_LIFE", "RESERVE");
  current = savePotTransfer(current, { id: "top-up", lineId: "Vacances", amountCents: 20000, date: "2026-09-02", note: "Renfort ponctuel" });
  return current;
}
function withClosedBill() {
  const state = expense(fund(envelope(setup(), "Électricité", 10000, "HOUSING", "FIXED")), "Électricité", 8000);
  return closeBill(state, "Électricité");
}

describe("comptes rendus mensuels par email", () => {
  it("calcule le mois archivé et le solde de fin de mois sans intégrer les opérations suivantes", () => {
    const data = monthlyReportData(history());
    expect(data.month).toBe("2026-08");
    expect(data.closed).toBe(true);
    expect(data.spentCents).toBe(97345);
    expect(data.receivedCents).toBe(180000);
    expect(data.categories.map((category) => category.cents)).toEqual([80000, 12345, 5000]);
    expect(data.accountBalanceCents).toBe(82655);
    expect(data.reserveBalanceCents).toBe(35000);
    expect(data.potBalanceCents).toBe(47655);
    expect(data.operations).toHaveLength(6);
    expect(data.operations.some((operation) => operation.description.includes("Hors du mois ciblé"))).toBe(false);
  });
  it("distingue les prévisions impayées des réserves financées et des dépenses réelles", async () => {
    const raw = snapshot(envelope(envelope(setup(), "Logement", 100000, "HOUSING"), "Vacances", 20000, "DAILY_LIFE", "RESERVE"));
    const data = monthlyReportData(raw);
    expect(data.summary.plannedCents).toBe(120000);
    expect(data.summary.missingCents).toBe(120000);
    expect(data.summary.reservedCents).toBe(20000);
    expect(data.spentCents).toBe(0);
    expect(data.receivedCents).toBe(0);
    expect(data.reserveBalanceCents).toBe(0);
    const report = await renderMonthlyReport(raw, "monthly");
    expect(report.html).toContain("Aucune dépense enregistrée");
    expect(report.html).toContain("Bilan provisoire");
    expect(report.html).not.toMatch(/NaN|Infinity/);
    expect(report.text).toContain("clôture manuelle à venir");
  });
  it("joint une sauvegarde importable et une archive serveur restaurable avec le journal complet", async () => {
    const raw = history();
    raw.audit = [{ id: "1", created_at: "2026-08-03T12:00:00.000Z", actor_user_id: "11111111-1111-4111-8111-111111111111", actor_email: "camille@example.test", actor_display_name: "Camille", entity_type: "expense", entity_id: "expense-0", entity_month: "2026-08", action: "added", revision: "1", before_data: null, after_data: { id: "expense-0", lineId: "Logement", amountCents: 75000, date: "2026-08-02", description: "Paiement enregistré" } }];
    const report = await renderMonthlyReport(raw, "closed");
    const budget = report.attachments.find((attachment) => attachment.filename === "budget-2026-08.json")!;
    const server = report.attachments.find((attachment) => attachment.filename === "archive-serveur-2026-08.json")!;
    expect(validateState(JSON.parse(budget.content.toString()))).toEqual(validateState(raw.state));
    expect(parseServerSnapshot(JSON.parse(server.content.toString()))).toEqual(parseServerSnapshot(raw));
    expect(report.subject).toBe("BUDG · Clôture · août 2026");
    expect(report.text).toContain("tout le budget et son historique");
    expect(report.html).toContain("l’ensemble du budget et de son historique");
  });
  it("génère un PDF paginé et une image PNG intégrée sans dépendance à un service externe", async () => {
    const report = await renderMonthlyReport(history(), "monthly");
    const pdf = report.attachments.find((attachment) => attachment.contentType === "application/pdf")!;
    const png = report.attachments.find((attachment) => attachment.contentType === "image/png")!;
    expect(pdf.content.subarray(0, 8).toString()).toMatch(/^%PDF-1\./);
    expect((pdf.content.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
    expect(png.content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(report.html).toContain(`src="cid:${png.cid}"`);
    expect(report.html).not.toMatch(/src=["']https?:\/\//i);
  });
  it("échappe les noms libres dans le HTML et garde les données sources intactes", async () => {
    const dangerous = '<img src=x onerror="alert(1)"> &';
    const state = configureHousehold(initialState("2026-08"), [dangerous, "Alex"], [300000, 200000], "2026-08");
    const raw = snapshot(state);
    const original = JSON.stringify(raw);
    const report = await renderMonthlyReport(raw, "monthly");
    expect(report.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;");
    expect(report.html).not.toContain(dangerous);
    expect(JSON.stringify(raw)).toBe(original);
    const saved = JSON.parse(report.attachments.find((attachment) => attachment.filename.startsWith("budget-"))!.content.toString());
    expect(saved.members[0].name).toBe(dangerous);
  });
  it("ne produit pas de faux bilan de clôture ni de rapport pour un mois absent", async () => {
    await expect(renderMonthlyReport(snapshot(setup()), "closed")).rejects.toThrow(/clôturé/);
    await expect(renderMonthlyReport({ ...history(), month: "2026-07" }, "monthly")).rejects.toThrow(/absent/);
  });
  it("pagine toutes les enveloppes au lieu de perdre la fin du tableau", async () => {
    let state = setup();
    for (let index = 0; index < 40; index++) state = envelope(state, `Enveloppe ${index + 1}`, index + 1, "DAILY_LIFE");
    const report = await renderMonthlyReport(snapshot(state), "monthly");
    const pdf = report.attachments.find((attachment) => attachment.contentType === "application/pdf")!;
    expect((pdf.content.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
    const budget = JSON.parse(report.attachments.find((attachment) => attachment.filename.startsWith("budget-"))!.content.toString());
    expect(budget.budget.lines).toHaveLength(40);
  });
  it("rattache un ancien remboursement à sa date réelle, sans l’anticiper dans le solde du mois précédent", () => {
    const august = closeMonth(expense(fund(envelope(setup(), "Courses", 50000, "DAILY_LIFE")), "Courses", 42000));
    const withRefund = { ...august, budget: { ...august.budget, refunds: [{ memberId: "jean", amountCents: 4000, paidOn: "2026-09-01" }] } };
    withRefund.budget.closedPotCents = budgetSummary(withRefund.budget).surplusCents;
    const september = startNextMonth(validateState(withRefund));
    const previous = monthlyReportData(snapshot(september, "2026-08"));
    const current = monthlyReportData(snapshot(september, "2026-09"));
    expect(previous.accountBalanceCents).toBe(8000);
    expect(previous.refundsCents).toBe(0);
    expect(current.accountBalanceCents).toBe(4000);
    expect(current.refundsCents).toBe(4000);
    expect(current.operations).toMatchObject([{ type: "Ancien remboursement", date: "2026-09-01", amountCents: 4000 }]);
  });
  it("identifie un transfert interne sans le compter comme une dépense ou un versement et conserve les provisions", async () => {
    const raw = snapshot(withTransfer());
    const data = monthlyReportData(raw);
    expect(data.spentCents).toBe(0);
    expect(data.receivedCents).toBe(0);
    expect(data.accountBalanceCents).toBe(100000);
    expect(data.potBalanceCents).toBe(80000);
    expect(data.reserveBalanceCents).toBe(20000);
    expect(data.communalReserveCents).toBe(20000);
    expect(data.potTransferredCents).toBe(20000);
    expect(data.summary.plannedCents).toBe(160000);
    expect(data.summary.missingCents).toBe(160000);
    expect(data.operations).toMatchObject([{ type: "Transfert interne", amountCents: 20000, internal: true, description: "Pot commun vers Vacances · Renfort ponctuel" }]);
    const report = await renderMonthlyReport(raw, "monthly");
    expect(report.text).toContain("Transferts internes du pot vers les enveloppes");
    expect(report.text).toContain("ne sont ni des dépenses ni de nouveaux versements");
    expect(report.html).toContain("Ils ne changent pas le solde bancaire");
    const saved = JSON.parse(report.attachments.find((attachment) => attachment.filename.startsWith("budget-"))!.content.toString());
    expect(validateState(saved)).toEqual(raw.state);
    expect(saved.budget.potTransfers).toEqual(raw.state.budget.potTransfers);
  });
  it("n’anticipe pas les transferts du mois suivant dans le pot et conserve la provenance des réserves", () => {
    const closed = closeMonth(expense(fund(withTransfer()), "Vacances", 65000));
    let next = startNextMonth(closed);
    next = savePotTransfer(next, { id: "future-top-up", lineId: "Vacances", amountCents: 5000, date: "2026-10-02", note: "Renfort du mois suivant" });
    const data = monthlyReportData(snapshot(next, "2026-09"));
    expect(data.spentCents).toBe(65000);
    expect(data.receivedCents).toBe(160000);
    expect(data.reserveBalanceCents).toBe(15000);
    expect(data.communalReserveCents).toBe(15000);
    expect(data.potBalanceCents).toBe(180000);
    expect(data.accountBalanceCents).toBe(195000);
    expect(data.potTransferredCents).toBe(20000);
    expect(data.operations.some((operation) => operation.description.includes("mois suivant"))).toBe(false);
  });
  it("ne présente jamais davantage de réserve issue du pot que d’argent effectivement disponible pendant un mois impayé", () => {
    const raw = snapshot(expense(withTransfer(), "Vacances", 10000));
    const data = monthlyReportData(raw);
    expect(data.receivedCents).toBe(0);
    expect(data.reserveBalanceCents).toBe(10000);
    expect(data.communalReserveCents).toBe(10000);
    expect(data.summary.reservedCents).toBe(70000);
  });
  it("rend toujours un ancien instantané V5 sans modifier sa source et joint son budget migré", async () => {
    const legacy = JSON.parse(JSON.stringify(history()));
    legacy.state.version = 5;
    delete legacy.state.potSequence;
    for (const budget of [legacy.state.budget, ...legacy.state.archivedBudgets]) {
      delete budget.potTransfers;
      delete budget.billClosures;
      delete budget.closedOrder;
      for (const line of budget.lines) delete line.openingPotCents;
    }
    for (const expense of legacy.state.potExpenses) delete expense.order;
    const before = JSON.stringify(legacy);
    const report = await renderMonthlyReport(legacy, "monthly");
    const state = validateState(JSON.parse(report.attachments.find((attachment) => attachment.filename.startsWith("budget-"))!.content.toString()));
    expect(state.version).toBe(7);
    expect(state.budget.potTransfers).toEqual([]);
    expect(state.budget.lines.every((line) => line.openingPotCents === 0)).toBe(true);
    expect(monthlyReportData(legacy).potBalanceCents).toBe(47655);
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it("compte immédiatement le surplus d’une facture dans le pot sans créer une dépense ou un versement", async () => {
    const raw = snapshot(withClosedBill());
    const data = monthlyReportData(raw);
    expect(data.closed).toBe(false);
    expect(data.billReleasedCents).toBe(2000);
    expect(data.billReopenedCents).toBe(0);
    expect(data.potBalanceCents).toBe(2000);
    expect(data.spentCents).toBe(8000);
    expect(data.receivedCents).toBe(10000);
    expect(data.accountBalanceCents).toBe(2000);
    expect(data.operations.filter((operation) => operation.internal)).toMatchObject([{ type: "Facture clôturée", amountCents: 2000 }]);
    const report = await renderMonthlyReport(raw, "monthly");
    expect(report.html).toContain("Surplus de factures libéré ce mois");
    expect(report.text).toContain("Surplus de factures libéré vers le pot ce mois");
    const saved = validateState(JSON.parse(report.attachments.find((attachment) => attachment.filename.startsWith("budget-"))!.content.toString()));
    expect(saved.budget.billClosures).toEqual(raw.state.budget.billClosures);
  });
  it("ne crédite pas de nouveau les factures déjà clôturées lors de la clôture mensuelle", () => {
    const state = closeMonth(withClosedBill());
    expect(state.budget.closedPotCents).toBe(0);
    const data = monthlyReportData(snapshot(state));
    expect(data.billReleasedCents).toBe(2000);
    expect(data.potBalanceCents).toBe(2000);
    expect(data.accountBalanceCents).toBe(2000);
    expect(data.spentCents).toBe(8000);
  });
  it("montre le débit inverse d’une réouverture et le complément mensuel sans supprimer la trace du crédit initial", async () => {
    const state = reopenBill(withClosedBill(), "Électricité");
    const data = monthlyReportData(snapshot(state));
    expect(data.billReleasedCents).toBe(2000);
    expect(data.billReopenedCents).toBe(2000);
    expect(data.potBalanceCents).toBe(0);
    expect(data.accountBalanceCents).toBe(2000);
    expect(data.operations.filter((operation) => operation.internal).map((operation) => operation.type)).toEqual(expect.arrayContaining(["Facture clôturée", "Facture rouverte"]));
    expect(data.operations.filter((operation) => operation.internal).map((operation) => operation.type)).toEqual(["Facture rouverte", "Facture clôturée"]);
    const final = closeMonth(setSettled(state, "Électricité", true));
    expect(final.budget.closedPotCents).toBe(2000);
    const closed = monthlyReportData(snapshot(final));
    expect(closed.potBalanceCents).toBe(2000);
    expect(closed.billReleasedCents).toBe(closed.billReopenedCents);
    const report = await renderMonthlyReport(snapshot(final), "closed");
    expect(report.html).toContain("Surplus ajouté à la clôture mensuelle");
    expect(report.text).toContain("Surplus repris du pot lors des réouvertures");
  });
  it("exclut les crédits anticipés du mois suivant du bilan d’un mois archivé", () => {
    const august = closeMonth(withClosedBill());
    const september = closeBill(expense(fund(startNextMonth(august)), "Électricité", 8000), "Électricité");
    const data = monthlyReportData(snapshot(september, "2026-08"));
    expect(data.billReleasedCents).toBe(2000);
    expect(data.potBalanceCents).toBe(2000);
    expect(data.accountBalanceCents).toBe(2000);
    expect(data.operations.filter((operation) => operation.internal)).toHaveLength(1);
  });
});
