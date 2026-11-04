import PDFDocument from "pdfkit";
import { Resvg } from "@resvg/resvg-js";
import { budgetSummary, euro, monthLabel } from "../src/domain";
import { parseServerSnapshot, type ServerSnapshot } from "./jobs";

export type ReportEvent = "monthly" | "closed";
export type ReportAttachment = { filename: string; content: Buffer; contentType: string; cid?: string };
export type MonthlyReport = { subject: string; text: string; html: string; attachments: ReportAttachment[] };

const colors = { forest: "#245947", sage: "#94ad87", gold: "#c6a566", ink: "#203b31", muted: "#657467", ivory: "#f5f7ef", line: "#e1e8dc" };
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const pdfText = (value: string) => value.replace(/[\u00a0\u202f]/g, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const money = (value: number) => pdfText(euro(value));
const shortDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

export function monthlyReportData(raw: ServerSnapshot) {
  const snapshot = parseServerSnapshot(raw);
  const budgets = [snapshot.state.budget, ...snapshot.state.archivedBudgets];
  const budget = budgets.find((value) => value.id === snapshot.month)!;
  const summary = budgetSummary(budget);
  const potExpenses = snapshot.state.potExpenses.filter((expense) => expense.date.slice(0, 7) === snapshot.month);
  const throughMonth = budgets.filter((value) => value.id <= snapshot.month);
  const potThroughMonth = snapshot.state.potExpenses.filter((expense) => expense.date.slice(0, 7) <= snapshot.month);
  const allRefunds = budgets.flatMap((value) => value.refunds.filter((refund) => refund.paidOn).map((refund) => ({ ...refund, name: value.members.find((member) => member.id === refund.memberId)!.name })));
  const monthlyRefunds = allRefunds.filter((refund) => refund.paidOn!.slice(0, 7) === snapshot.month);
  const categories = [
    { label: "Appartement", color: colors.forest, cents: total(summary.lines.filter((line) => line.expenseGroup === "HOUSING").map((line) => line.spent)) },
    { label: "Vie quotidienne", color: colors.sage, cents: total(summary.lines.filter((line) => line.expenseGroup === "DAILY_LIFE").map((line) => line.spent)) },
    { label: "Achats du pot commun", color: colors.gold, cents: total(potExpenses.map((expense) => expense.amountCents)) },
  ];
  const operations = [
    ...budget.payments.map((payment) => ({ id: payment.id, date: payment.date, type: "Versement", description: `${budget.members.find((member) => member.id === payment.memberId)!.name}${payment.note ? ` · ${payment.note}` : ""}`, amountCents: payment.amountCents, incoming: true, internal: false })),
    ...budget.expenses.map((expense) => ({ id: expense.id, date: expense.date, type: "Dépense", description: `${budget.lines.find((line) => line.id === expense.lineId)!.name}${expense.description ? ` · ${expense.description}` : ""}`, amountCents: expense.amountCents, incoming: false, internal: false })),
    ...potExpenses.map((expense) => ({ id: expense.id, date: expense.date, type: "Pot commun", description: expense.description, amountCents: expense.amountCents, incoming: false, internal: false })),
    ...monthlyRefunds.map((refund) => ({ id: `refund-${refund.memberId}-${refund.paidOn}`, date: refund.paidOn!, type: "Ancien remboursement", description: refund.name, amountCents: refund.amountCents, incoming: false, internal: false })),
    ...budget.potTransfers.map((transfer) => ({ id: `transfer-${transfer.id}`, date: transfer.date, type: "Transfert interne", description: `Pot commun vers ${budget.lines.find((line) => line.id === transfer.lineId)!.name}${transfer.note ? ` · ${transfer.note}` : ""}`, amountCents: transfer.amountCents, incoming: false, internal: true })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const reserveLines = summary.lines.filter((line) => line.kind === "RESERVE");
  const reserveBalanceCents = total(reserveLines.map((line) => line.available));
  const communalReserveCents = Math.min(Math.max(0, reserveBalanceCents), total(reserveLines.map((line) =>
    Math.min(line.reservedPotCents, Math.max(0, line.available)),
  )));
  return {
    snapshot, budget, summary, categories, operations,
    month: snapshot.month,
    label: monthLabel(snapshot.month),
    closed: budget.status === "CLOSED",
    spentCents: total(categories.map((category) => category.cents)),
    receivedCents: total(budget.payments.map((payment) => payment.amountCents)),
    refundsCents: total(monthlyRefunds.map((refund) => refund.amountCents)),
    accountBalanceCents: total(throughMonth.map((value) => total(value.payments.map((payment) => payment.amountCents)) - total(value.expenses.map((expense) => expense.amountCents)))) - total(allRefunds.filter((refund) => refund.paidOn!.slice(0, 7) <= snapshot.month).map((refund) => refund.amountCents)) - total(potThroughMonth.map((expense) => expense.amountCents)),
    reserveBalanceCents,
    communalReserveCents,
    potTransferredCents: summary.potTransferredCents,
    potBalanceCents: total(throughMonth.filter((value) => value.status === "CLOSED").map((value) => value.closedPotCents)) - total(potThroughMonth.map((expense) => expense.amountCents)) - total(throughMonth.flatMap((value) => value.potTransfers.map((transfer) => transfer.amountCents))),
  };
}
type ReportData = ReturnType<typeof monthlyReportData>;

function chartPng(data: ReportData) {
  const size = 440, center = size / 2, radius = 154, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = data.categories.filter((category) => category.cents > 0).map((category) => {
    const length = circumference * category.cents / data.spentCents;
    const circle = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${category.color}" stroke-width="58" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"/>`;
    offset += length;
    return circle;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="440" viewBox="0 0 440 440"><rect width="440" height="440" fill="#ffffff"/><circle cx="220" cy="220" r="154" fill="none" stroke="#e9eee5" stroke-width="58"/><g transform="rotate(-90 220 220)">${segments}</g></svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
}

function htmlReport(data: ReportData, event: ReportEvent, cid: string) {
  const status = data.closed ? "Mois clôturé" : "Bilan provisoire · clôture manuelle à venir";
  const date = new Date(data.snapshot.createdAt).toLocaleString("fr-FR", { timeZone: data.snapshot.timeZone, dateStyle: "long", timeStyle: "short" });
  const row = (label: string, value: string) => `<tr><td style="padding:10px 0;color:${colors.muted};border-bottom:1px solid ${colors.line}">${escapeHtml(label)}</td><td align="right" style="padding:10px 0;font-weight:bold;border-bottom:1px solid ${colors.line};white-space:nowrap">${escapeHtml(value)}</td></tr>`;
  const categories = data.categories.map((category) => `<tr><td style="padding:9px 0;color:${colors.muted}"><span style="color:${category.color};font-size:18px">●</span> ${escapeHtml(category.label)}</td><td align="right" style="font-weight:bold;white-space:nowrap">${escapeHtml(euro(category.cents))}</td></tr>`).join("");
  const members = data.summary.balances.map((member) => `<tr><td style="padding:11px 7px;border-bottom:1px solid ${colors.line}">${escapeHtml(member.name)}</td><td align="right" style="padding:11px 7px;border-bottom:1px solid ${colors.line}">${escapeHtml(euro(member.expected))}</td><td align="right" style="padding:11px 7px;border-bottom:1px solid ${colors.line}">${escapeHtml(euro(member.paid))}</td><td align="right" style="padding:11px 7px;border-bottom:1px solid ${colors.line}">${escapeHtml(euro(member.remaining))}</td></tr>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BUDG · ${escapeHtml(data.label)}</title></head><body style="margin:0;padding:20px 10px;background:${colors.ivory};font-family:Arial,Helvetica,sans-serif;color:${colors.ink}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid ${colors.line};border-radius:18px;overflow:hidden"><tr><td style="padding:30px 28px;background:${colors.forest};color:#fff"><div style="font-size:23px;font-weight:bold;letter-spacing:1px">BUDG</div><p style="font-size:12px;color:#d4e2cf;letter-spacing:2px;margin:24px 0 8px">VOTRE BUDGET, AU CLAIR</p><h1 style="font-size:30px;line-height:1.2;font-weight:normal;margin:0 0 14px">${escapeHtml(data.label)}</h1><div style="font-size:12px;color:#e3ecdf">${escapeHtml(status)}</div></td></tr><tr><td style="padding:24px 28px"><p style="font-size:14px;line-height:1.6;margin:0 0 20px">${event === "closed" ? "Votre mois est clôturé. Voici les montants enregistrés et une copie complète de votre budget." : "Voici le récapitulatif du mois précédent et une copie complète de votre budget."} ${data.closed ? "Les chiffres du mois sont figés à la clôture." : "Ce point de situation sera suivi d’un nouveau bilan lors de votre clôture manuelle."}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">${row("Dépenses enregistrées du mois", euro(data.spentCents))}${row("Versements réellement reçus", euro(data.receivedCents))}${data.refundsCents ? row("Anciens remboursements exécutés", euro(data.refundsCents)) : ""}${row("Solde du compte à la fin du mois", euro(data.accountBalanceCents))}${row("Budget prévu pour les enveloppes", euro(data.summary.plannedCents))}</table><h2 style="font-size:18px;margin:28px 0 12px">Où est passé l’argent ?</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="38%" style="vertical-align:middle"><img src="cid:${cid}" alt="Répartition des dépenses, détaillée dans le tableau voisin" width="180" style="display:block;width:100%;max-width:180px;height:auto"></td><td style="padding-left:14px;vertical-align:middle"><table width="100%" cellspacing="0" cellpadding="0" style="font-size:12px">${categories}</table></td></tr></table>${data.spentCents === 0 ? `<p style="font-size:13px;color:${colors.muted}">Aucune dépense enregistrée pour ce mois. Les montants prévus ne sont pas comptés comme des paiements.</p>` : ""}<h2 style="font-size:18px;margin:28px 0 12px">Les contributions de chacun</h2><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px"><tr style="color:${colors.muted};font-size:10px"><th align="left" style="padding:8px 7px">Personne</th><th align="right" style="padding:8px 7px">Prévu</th><th align="right" style="padding:8px 7px">Reçu</th><th align="right" style="padding:8px 7px">Reste</th></tr>${members}</table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;margin-top:18px">${row("Solde financé des réserves", euro(data.reserveBalanceCents))}${row("Dont réserves issues du pot", euro(data.communalReserveCents))}${row("Pot commun à la fin du mois", euro(data.potBalanceCents))}${row("Transferts internes du pot vers les enveloppes", euro(data.potTransferredCents))}${data.closed ? row("Surplus du mois affecté au pot", euro(data.budget.closedPotCents)) : ""}</table>${data.potTransferredCents ? `<p style="font-size:11px;line-height:1.6;color:${colors.muted}">Les transferts du pot sont des réaffectations internes. Ils ne changent pas le solde bancaire et ne sont ni des dépenses ni de nouveaux versements.</p>` : ""}<div style="margin-top:24px;padding:18px;background:${colors.ivory};border-radius:10px"><h2 style="font-size:16px;margin:0 0 10px">Vos pièces jointes</h2><p style="font-size:12px;line-height:1.7;margin:0"><strong>bilan-${data.month}.pdf</strong> : le compte rendu à conserver ou imprimer.<br><strong>budget-${data.month}.json</strong> : la sauvegarde à importer dans BUDG.<br><strong>archive-serveur-${data.month}.json</strong> : la copie complète avec le journal, pour une restauration serveur.</p></div><p style="font-size:11px;line-height:1.6;color:${colors.muted};margin:20px 0 0">Le rapport porte uniquement sur ${escapeHtml(data.label)}. Les sauvegardes JSON contiennent l’ensemble du budget et de son historique, dans l’état enregistré le ${escapeHtml(date)} (${escapeHtml(data.snapshot.timeZone)}), révision ${data.snapshot.state.revision}. Aucun virement bancaire n’est effectué par cet email.</p></td></tr></table><p style="color:${colors.muted};font-size:11px">BUDG · Un mois de plus, les comptes au clair.</p></td></tr></table></body></html>`;
}

function createPdf(data: ReportData, png: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: { Title: `BUDG · ${data.label}`, Author: "BUDG", Subject: "Bilan du budget partagé" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    const pageWidth = 595.28, contentWidth = pageWidth - 84;
    function text(value: string, x: number, y: number, width: number, size = 10, color = colors.ink, bold = false, align: "left" | "right" | "center" = "left", height?: number) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color).text(pdfText(value), x, y, { width, align, lineGap: 2, ...(height ? { height, ellipsis: true } : {}) });
    }
    function background() { doc.rect(0, 0, pageWidth, 842).fill("#ffffff"); }
    function rule(y: number) { doc.moveTo(42, y).lineTo(pageWidth - 42, y).lineWidth(0.5).stroke(colors.line); }
    function title(section: string, subtitle?: string) {
      background(); text("BUDG", 42, 36, 110, 21, colors.forest, true); text(data.label.toUpperCase(), 190, 44, 363, 9, colors.muted, true, "right");
      text(section, 42, 94, contentWidth, 25, colors.ink, true); if (subtitle) text(subtitle, 42, 130, contentWidth, 10, colors.muted); rule(subtitle ? 158 : 140);
    }
    function newPage(section: string, subtitle?: string) { doc.addPage(); title(section, subtitle); }
    function fittedMoney(amount: number, x: number, y: number, width: number, start = 22) {
      const value = money(amount); let size = start;
      while (size > 11 && doc.font("Helvetica-Bold").fontSize(size).widthOfString(value) > width) size--;
      text(value, x, y, width, size, colors.forest, true);
    }
    title(`Votre bilan · ${data.label}`, data.closed ? "Mois clôturé · paiements enregistrés et bilan définitif" : "Point de situation provisoire · la clôture reste manuelle");
    const metrics = [["DÉPENSES RÉELLES", data.spentCents], ["VERSEMENTS REÇUS", data.receivedCents], ["SOLDE DU COMPTE", data.accountBalanceCents]] as const;
    const cardWidth = (contentWidth - 20) / 3;
    metrics.forEach(([label, amount], i) => {
      const x = 42 + i * (cardWidth + 10);
      doc.roundedRect(x, 181, cardWidth, 79, 9).fill(colors.ivory);
      text(label, x + 12, 194, cardWidth - 24, 8, colors.muted, true);
      fittedMoney(amount, x + 12, 218, cardWidth - 24);
    });
    text("Où est passé l’argent ?", 42, 288, contentWidth, 17, colors.ink, true);
    doc.image(png, 42, 318, { width: 196, height: 196 });
    text("TOTAL DÉPENSÉ", 76, 387, 128, 8, colors.muted, true, "center");
    let centerSize = 18;
    while (centerSize > 10 && doc.font("Helvetica-Bold").fontSize(centerSize).widthOfString(money(data.spentCents)) > 124) centerSize--;
    text(money(data.spentCents), 76, 405, 128, centerSize, colors.forest, true, "center");
    data.categories.forEach((category, i) => {
      const y = 338 + i * 49;
      doc.circle(271, y + 8, 4).fill(category.color);
      text(category.label, 284, y, 225, 10, colors.muted);
      text(money(category.cents), 284, y + 17, 225, 13, colors.forest, true);
    });
    if (!data.spentCents) text("Aucune dépense enregistrée : les prévisions restent distinctes des paiements réels.", 42, 516, contentWidth, 10, colors.muted);
    if (data.refundsCents) text(`Anciens remboursements exécutés ce mois : ${money(data.refundsCents)}.`, 42, 536, contentWidth, 9, colors.muted);
    text("Les contributions de chacun", 42, 557, contentWidth, 17, colors.ink, true);
    ["Personne", "Prévu", "Reçu", "Reste à verser"].forEach((label, i) => text(label, [42, 237, 342, 447][i], 588, [180, 95, 95, 106][i], 8, colors.muted, true, i ? "right" : "left"));
    data.summary.balances.forEach((member, i) => {
      const y = 611 + i * 40;
      text(member.name, 42, y, 180, 11, colors.ink, true, "left", 31);
      [member.expected, member.paid, member.remaining].forEach((amount, j) => text(money(amount), [237, 342, 447][j], y, [95, 95, 106][j], 10, colors.ink, false, "right")); rule(y + 31);
    });
    text(`Prévu pour les enveloppes : ${money(data.summary.plannedCents)} · Solde financé des réserves : ${money(data.reserveBalanceCents)}`, 42, 704, contentWidth, 9, colors.muted);
    text(`Pot commun à la fin du mois : ${money(data.potBalanceCents)}${data.closed ? ` · Surplus du mois affecté au pot : ${money(data.budget.closedPotCents)}` : ""}`, 42, 729, contentWidth, 9, colors.muted);
    if (data.potTransferredCents || data.communalReserveCents)
      text(`Transferts du pot : ${money(data.potTransferredCents)} · Réserves issues du pot : ${money(data.communalReserveCents)}`, 42, 748, contentWidth, 9, colors.muted);

    newPage("Vos enveloppes", "Le prévu n’est pas une dépense. Le solde financé tient compte des versements reçus.");
    const positions = [42, 245, 323, 401, 479], widths = [191, 70, 70, 70, 74];
    function envelopeHeaders() { ["Enveloppe", "Prévu", "Dépensé", "Financé", "Solde financé"].forEach((label, i) => text(label, positions[i], 177, widths[i], 8, colors.muted, true, i ? "right" : "left")); }
    envelopeHeaders();
    let y = 207;
    for (const line of data.summary.lines) {
      const nameHeight = doc.font("Helvetica-Bold").fontSize(9).heightOfString(pdfText(line.name), { width: widths[0] });
      const sources = [
        line.opening ? `Report : ${money(line.opening)}` : "",
        line.openingPotCents ? `dont ${money(line.openingPotCents)} issus du pot` : "",
        line.potAddedCents ? `Pot ce mois : ${money(line.potAddedCents)}` : "",
      ].filter(Boolean).join(" · ");
      const sourceHeight = sources ? doc.font("Helvetica").fontSize(8).heightOfString(sources, { width: widths[0] }) + 4 : 0;
      const rowHeight = Math.max(32, nameHeight + sourceHeight + 12);
      if (y + rowHeight > 687) {
        newPage("Vos enveloppes · suite", "Toutes les enveloppes du mois sont incluses dans ce tableau.");
        envelopeHeaders(); y = 207;
      }
      text(line.name, positions[0], y, widths[0], 9, colors.ink, true);
      if (sources) text(sources, positions[0], y + nameHeight + 4, widths[0], 8, colors.muted);
      [line.plannedCents, line.spent, line.funded, line.available].forEach((amount, i) => text(money(amount), positions[i + 1], y, widths[i + 1], 9, amount < 0 ? "#a44732" : colors.ink, false, "right"));
      rule(y + rowHeight - 8); y += rowHeight;
    }
    text("Repères pour lire ce bilan", 42, 711, contentWidth, 12, colors.ink, true);
    text("Financé = versements reçus, réserves reportées et transferts du pot. Les transferts internes ne sont ni des dépenses ni de nouveaux versements. Une prévision impayée n’est pas de l’argent disponible.", 42, 733, contentWidth, 9, colors.muted);

    if (data.operations.length) {
      newPage("Les opérations du mois", "Aperçu des 15 opérations les plus récentes · les sauvegardes conservent le détail complet.");
      text("Date / opération", 42, 177, 420, 8, colors.muted, true); text("Montant", 455, 177, 98, 8, colors.muted, true, "right");
      data.operations.slice(0, 15).forEach((operation, i) => {
        const y = 205 + i * 31;
        text(`${shortDate(operation.date)} · ${operation.type}`, 42, y, 400, 8, colors.muted);
        text(operation.description, 42, y + 11, 400, 9, colors.ink, false, "left", 13);
        text(`${operation.internal ? "" : operation.incoming ? "+" : "−"}${money(operation.amountCents)}`, 455, y + 9, 98, 10, operation.incoming ? colors.forest : colors.ink, true, "right"); rule(y + 26);
      });
      const visible = Math.min(15, data.operations.length);
      text(`${visible} opérations affichées sur ${data.operations.length} pour ${data.label}.`, 42, 695, contentWidth, 10, colors.muted);
      text("La copie serveur joint aussi le journal des ajouts, corrections et suppressions. Les anciennes traces restent dans le journal même si une opération a été corrigée.", 42, 721, contentWidth, 9, colors.muted);
    }
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      rule(770);
      text(`BUDG · ${data.label} · Révision ${data.snapshot.state.revision}`, 42, 780, 390, 8, colors.muted);
      text(`${page + 1} / ${range.count}`, 467, 780, 86, 8, colors.muted, false, "right");
    }
    doc.end();
  });
}

export async function renderMonthlyReport(raw: ServerSnapshot, event: ReportEvent): Promise<MonthlyReport> {
  if (event !== "monthly" && event !== "closed") throw new Error("Type de compte rendu invalide.");
  const data = monthlyReportData(raw);
  if (event === "closed" && !data.closed) throw new Error("Le bilan de clôture exige un mois clôturé.");
  const png = chartPng(data);
  const cid = `budg-spending-${data.month}@budg`;
  const pdf = await createPdf(data, png);
  const status = data.closed ? "Mois clôturé" : "Bilan provisoire ; clôture manuelle à venir";
  const subject = `BUDG · ${event === "closed" ? "Clôture" : "Récapitulatif"} · ${data.label}`;
  const text = [
    `${subject}\n${status}`,
    `Dépenses enregistrées : ${euro(data.spentCents)}\nVersements réellement reçus : ${euro(data.receivedCents)}\nSolde du compte à la fin du mois : ${euro(data.accountBalanceCents)}\nBudget prévu pour les enveloppes : ${euro(data.summary.plannedCents)}`,
    "Répartition des dépenses :\n" + data.categories.map((category) => `${category.label} : ${euro(category.cents)}`).join("\n"),
    "Contributions :\n" + data.summary.balances.map((member) => `${member.name} : prévu ${euro(member.expected)}, reçu ${euro(member.paid)}, reste à verser ${euro(member.remaining)}`).join("\n"),
    `Solde financé des réserves : ${euro(data.reserveBalanceCents)}\nDont réserves issues du pot : ${euro(data.communalReserveCents)}\nPot commun à la fin du mois : ${euro(data.potBalanceCents)}\nTransferts internes du pot vers les enveloppes : ${euro(data.potTransferredCents)}. Ces transferts ne sont ni des dépenses ni de nouveaux versements.`,
    ...(data.refundsCents ? [`Anciens remboursements exécutés ce mois : ${euro(data.refundsCents)}`] : []),
    `Pièces jointes : bilan-${data.month}.pdf pour la lecture ; budget-${data.month}.json à importer dans BUDG ; archive-serveur-${data.month}.json pour une restauration serveur avec le journal.`,
    `Le rapport porte uniquement sur ${data.label}. Les sauvegardes JSON contiennent tout le budget et son historique à la révision ${data.snapshot.state.revision}, enregistrée le ${new Date(data.snapshot.createdAt).toISOString()}. Aucun virement bancaire n’est effectué par cet email.`,
  ].join("\n\n");
  return {
    subject, text, html: htmlReport(data, event, cid),
    attachments: [
      { filename: `bilan-${data.month}.pdf`, content: pdf, contentType: "application/pdf" },
      { filename: `budget-${data.month}.json`, content: Buffer.from(JSON.stringify(data.snapshot.state, null, 2) + "\n"), contentType: "application/json" },
      { filename: `archive-serveur-${data.month}.json`, content: Buffer.from(JSON.stringify(data.snapshot, null, 2) + "\n"), contentType: "application/json" },
      { filename: `depenses-${data.month}.png`, content: png, contentType: "image/png", cid },
    ],
  };
}
