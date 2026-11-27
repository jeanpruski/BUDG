import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, CalendarDays, CheckCircle2, Pencil, Plus, Trash2, X, type LucideIcon } from "lucide-react";
import { Budget, ScheduledExpense, allocationLabel, euro, keepsReserve } from "./domain";
import type { Actions } from "./screens";
import type { EnvelopeLine } from "./EnvelopeCard";
import { EnvelopeUsage } from "./EnvelopeUsage";
import { EnvelopeExpenses } from "./EnvelopeExpenses";
import { ScheduledExpenses } from "./ScheduledExpenses";
import { EnvelopePotTransfers } from "./EnvelopePotTransfers";
import { EnvelopeMonthClosing } from "./EnvelopeMonthClosing";
import { BillClosing } from "./BillClosing";
import "./envelope-popup.css";

export function EnvelopePopup({ budget, line, actions, readOnly, compact, potAvailableCents, scheduledExpenses = [], close, presentation }: {
  scheduledExpenses?: ScheduledExpense[];
  budget: Budget; line: EnvelopeLine; actions: Actions; readOnly: boolean; compact: boolean; potAvailableCents: number;
  close: () => void; presentation: { label: string; tone: string; Icon: LucideIcon };
}) {
  const ref = useRef<HTMLDialogElement>(null), timer = useRef<ReturnType<typeof setTimeout>>();
  const titleId = useId();
  const [leaving, setLeaving] = useState(false);
  const { Icon } = presentation;
  const editable = !readOnly && budget.status === "ACTIVE";
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer.current); dialog.close(); document.body.style.overflow = previous;
      if (opener?.isConnected && !document.querySelector("dialog:modal")) opener.focus({ preventScroll: true });
    };
  }, []);
  function dismiss() {
    if (leaving) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { close(); return; }
    setLeaving(true);
    timer.current = setTimeout(close, 180);
  }
  const missing = Math.max(0, line.capacity - line.funded);
  const currentPlans = scheduledExpenses.filter((entry) => entry.month === budget.id && entry.lineId === line.id);
  const pendingCents = currentPlans.reduce((sum, entry) => sum + entry.amountCents, 0);
  return createPortal(<dialog ref={ref} className={`envelope-popup${leaving ? " is-leaving" : ""}`}
    aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss();
    }}>
    <header className="envelope-popup-header">
      <div className="envelope-popup-title"><span className="envelope-popup-symbol"><Icon size={24} aria-hidden="true" /></span>
        <div><span className="envelope-popup-eyebrow">{budget.label} · {line.expenseGroup === "HOUSING" ? "Appartement" : "Vie quotidienne"}</span><h2 id={titleId}>{line.name}</h2></div>
      </div>
      <button type="button" className="envelope-popup-close" aria-label="Fermer la fiche" onClick={dismiss}><X size={22} aria-hidden="true" /></button>
    </header>
    <div className="envelope-popup-content">
      <section className="envelope-popup-hero" aria-label="Disponible et utilisation">
        <div className="envelope-popup-hero-top"><span>{budget.status === "CLOSED" ? "Solde de l’enveloppe à la clôture" : "Disponible dans l’enveloppe"}</span><span className="envelope-popup-status">{presentation.label}</span></div>
        <strong className={`envelope-popup-balance${line.available < 0 ? " is-negative" : ""}`}>{euro(line.available)}</strong>
        <EnvelopeUsage name={line.name} spentCents={line.spent} capacityCents={line.capacity} scheduledCents={pendingCents} />
      </section>
      <div className="envelope-popup-columns">
        <div className="envelope-popup-main">
          <section className="envelope-popup-section">
            <h3>Les chiffres du mois</h3>
            <dl className="envelope-popup-metrics">
              <div><dt>Provision du mois</dt><dd>{euro(line.plannedCents)}</dd></div>
              <div><dt>Total financé</dt><dd>{euro(line.funded)}</dd></div>
              {keepsReserve(line) && <div><dt>Report des mois précédents</dt><dd>{euro(line.opening)}</dd></div>}
              <div><dt>Déjà payé</dt><dd>{euro(line.spent)}</dd></div>
              {pendingCents > 0 && <><div><dt>Paiements prévus</dt><dd>{euro(pendingCents)}</dd></div><div className={line.available - pendingCents < 0 ? "is-warning" : undefined}><dt>Après paiements prévus</dt><dd>{euro(line.available - pendingCents)}</dd></div></>}
              {line.potAddedCents > 0 && <div><dt>Ajouté depuis le pot</dt><dd>{euro(line.potAddedCents)}</dd></div>}
              {missing > 0 && <div className="is-warning"><dt>Encore à financer</dt><dd>{euro(missing)}</dd></div>}
              {line.remaining < 0 && <div className="is-warning"><dt>Dépassement du budget</dt><dd>{euro(-line.remaining)}</dd></div>}
            </dl>
            {keepsReserve(line) && <p className="envelope-popup-reserve-note"><CheckCircle2 size={17} aria-hidden="true" />Le solde reste dans cette enveloppe. La prochaine provision reste due en totalité.</p>}
          </section>
          {!compact && <section className="envelope-popup-section envelope-popup-ledger">
            <ScheduledExpenses budget={budget} payments={scheduledExpenses} actions={actions} readOnly={readOnly} />
            <EnvelopeExpenses budget={budget} line={line} actions={actions} readOnly={readOnly} defaultOpen />
            <EnvelopePotTransfers budget={budget} line={line} actions={actions} readOnly={readOnly} defaultOpen />
          </section>}
        </div>
        <aside className="envelope-popup-side">
          {editable && <section className="envelope-popup-section envelope-popup-actions">
            <h3>Gérer cette enveloppe</h3>
            {!line.billClosure && <button type="button" className="primary" onClick={() => actions.expense(line.id)}><Plus size={17} aria-hidden="true" />{line.kind === "FIXED" ? "Saisir un paiement" : "Ajouter une dépense"}</button>}
            {!compact && actions.amount && <button type="button" className="secondary" onClick={() => actions.amount?.(line)}><CalendarDays size={17} aria-hidden="true" />Montants par mois</button>}
            {!compact && !line.billClosure && actions.potTransfer && <button type="button" className="secondary" disabled={potAvailableCents <= 0} onClick={() => actions.potTransfer?.(line.id)}><ArrowDownLeft size={17} aria-hidden="true" />Alimenter depuis le pot</button>}
            {!compact && !line.billClosure && <div className="envelope-popup-edit-actions">
              <button type="button" className="text-button" onClick={() => actions.line(line)}><Pencil size={15} aria-hidden="true" />Modifier</button>
              <button type="button" className="text-button danger" onClick={() => actions.removeLine(line.id)}><Trash2 size={15} aria-hidden="true" />Supprimer</button>
            </div>}
            {!compact && <EnvelopeMonthClosing budget={budget} line={line} actions={actions} pendingCount={currentPlans.length} />}
            {!compact && <BillClosing budget={budget} line={line} actions={actions} potAvailableCents={potAvailableCents} pendingCount={currentPlans.length} />}
          </section>}
          {!editable && !compact && <section className="envelope-popup-section"><h3>Suivi de l’enveloppe</h3>
            <EnvelopeMonthClosing budget={budget} line={line} actions={actions} readOnly />
            <BillClosing budget={budget} line={line} actions={actions} readOnly potAvailableCents={potAvailableCents} />
            <p className="envelope-popup-note">{readOnly ? "Votre compte permet de consulter cette enveloppe et ses paiements." : "Ce mois est clôturé. Les montants et les paiements sont conservés."}</p>
          </section>}
          <section className="envelope-popup-section envelope-popup-sharing"><h3>Répartition</h3><p>{allocationLabel(line)}</p>
            <dl>{budget.members.map(member => <div key={member.id}><dt>{member.name}{line.allocationType === "CUSTOM" && <small> · {line.customPercentages?.find(share => share.memberId === member.id)?.percent} %</small>}</dt><dd>{euro(line.shares.find(share => share.memberId === member.id)?.amountCents ?? 0)}</dd></div>)}</dl>
            {line.dueDay && line.kind === "FIXED" && <p className="envelope-popup-note">Échéance habituelle : le {line.dueDay} du mois.</p>}
            {line.amountPlan && (line.amountPlan.changes.some(entry => entry.fromMonth > budget.id) || line.amountPlan.exceptions.some(entry => entry.month >= budget.id)) && <p className="envelope-popup-note">Des montants spécifiques sont programmés par mois.</p>}
          </section>
        </aside>
      </div>
    </div>
  </dialog>, document.body);
}
