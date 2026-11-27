import { euro } from "./domain";
import "./envelope-usage.css";

export function EnvelopeUsage({ name, spentCents, capacityCents, scheduledCents = 0, showLabels = true }: {
  name: string; spentCents: number; capacityCents: number; scheduledCents?: number; showLabels?: boolean;
}) {
  const maximum = Math.max(1, capacityCents);
  const paid = Math.min(maximum, Math.max(0, spentCents));
  const planned = Math.min(maximum - paid, Math.max(0, scheduledCents));
  const remaining = capacityCents - spentCents - scheduledCents;
  const description = `${euro(spentCents)} payés, ${euro(scheduledCents)} prévus, ${remaining < 0 ? `${euro(-remaining)} de dépassement` : `${euro(remaining)} restants`} sur ${euro(capacityCents)} de budget`;
  return <span className="envelope-usage-block">
    <span className="envelope-usage-track" role="meter" aria-label={`Utilisation de ${name}`}
      aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={paid + planned} aria-valuetext={description} title={description}>
      <span className="envelope-usage-paid" style={{ width: `${paid / maximum * 100}%` }} />
      <span className="envelope-usage-planned" style={{ width: `${planned / maximum * 100}%` }} />
    </span>
    <span className="envelope-usage">
      <span className="envelope-usage-paid-label">{euro(spentCents)}{showLabels && " payés"}</span>
      {scheduledCents > 0 && <span className="envelope-usage-planned-label">{euro(scheduledCents)}{showLabels && " prévus"}</span>}
      <span>{showLabels && "Budget "}{euro(capacityCents)}</span>
    </span>
    {scheduledCents > 0 && remaining < 0 && <span className="envelope-usage-warning">Dépassement prévu : {euro(-remaining)}</span>}
  </span>;
}
