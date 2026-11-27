import { useState } from "react";
import { Sprout, ReceiptText, ShoppingBag } from "lucide-react";
import { Budget, ScheduledExpense, budgetSummary, envelopeMonthFinished, euro, keepsReserve, today } from "./domain";
import type { Actions } from "./screens";
import { EnvelopeUsage } from "./EnvelopeUsage";
import { EnvelopePopup } from "./EnvelopePopup";
import "./envelope-disclosure.css";

export type EnvelopeLine = ReturnType<typeof budgetSummary>["lines"][number];
export function envelopePresentation(line: EnvelopeLine, budget: Budget) {
  const late = line.kind === "FIXED" && !keepsReserve(line) && line.capacity > 0 && !line.settled && line.dueDay &&
    `${budget.id}-${String(Math.min(line.dueDay, new Date(Number(budget.id.slice(0, 4)), Number(budget.id.slice(5)), 0).getDate())).padStart(2, "0")}` < today();
  const finished = !!line.billClosure || envelopeMonthFinished(line);
  const label = envelopeMonthFinished(line) ? "Terminé pour ce mois" : line.billClosure ? line.kind === "FIXED" ? "Facture clôturée" : "Budget clôturé" : keepsReserve(line)
    ? line.kind === "FIXED" ? "Report conservé" : "Réserve"
    : line.kind === "VARIABLE" ? "À consommer"
    : line.settled ? "Facture réglée" : line.capacity === 0 ? "Rien à financer ce mois" : late ? "Échéance dépassée" : "Facture à régler";
  const tone = finished ? "green" : keepsReserve(line) ? "blue" : line.settled ? "green" : late ? "amber" : "";
  const Icon = keepsReserve(line) ? Sprout : line.kind === "FIXED" ? ReceiptText : ShoppingBag;
  return { finished, label, tone, Icon };
}
export function EnvelopeCard({ budget, line, actions, readOnly, compact, potAvailableCents, scheduledExpenses = [] }: {
  scheduledExpenses?: ScheduledExpense[];
  budget: Budget; line: EnvelopeLine; actions: Actions; readOnly: boolean; compact: boolean; potAvailableCents: number;
}) {
  const [open, setOpen] = useState(false);
  const { finished, label, tone, Icon } = envelopePresentation(line, budget);
  const pendingCents = scheduledExpenses.filter((entry) => entry.month === budget.id && entry.lineId === line.id).reduce((sum, entry) => sum + entry.amountCents, 0);
  const pending = pendingCents > 0;
  return <article className={`panel envelope envelope-${line.kind.toLowerCase()}${finished ? " envelope-closed" : pending ? " envelope-scheduled" : ""}`}>
    <button type="button" className="envelope-card-trigger" aria-haspopup="dialog"
      aria-label={`Ouvrir l’enveloppe · ${line.name}`} onClick={() => setOpen(true)}>
      <span className="section-head">
        <span className="envelope-title"><span className="envelope-symbol"><Icon size={19} aria-hidden="true" /></span><span className="envelope-name">{line.name}</span></span>
        <span className={`badge ${finished ? tone : pending ? "blue" : tone}`}>{finished ? "Clôturé" : pending ? "Paiement prévu" : label}</span>
      </span>
      <span className="envelope-amount"><strong className={line.available < 0 ? "text-red" : undefined}>{euro(line.available)}</strong>
        <span className="envelope-amount-caption">{budget.status === "CLOSED" ? "solde de l’enveloppe à la clôture" : "financés, encore disponibles"}</span>
        <span className="envelope-amount-caption-mobile">{budget.status === "CLOSED" ? "À la clôture" : "Disponible"}</span></span>
      <EnvelopeUsage name={line.name} spentCents={line.spent} capacityCents={line.capacity} scheduledCents={pendingCents} showLabels={false} />
    </button>
    {open && <EnvelopePopup budget={budget} line={line} actions={actions} readOnly={readOnly} compact={compact}
      potAvailableCents={potAvailableCents} scheduledExpenses={scheduledExpenses} close={() => setOpen(false)} presentation={{ label, tone, Icon }} />}
  </article>;
}
