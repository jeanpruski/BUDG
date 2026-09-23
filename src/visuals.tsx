import { CSSProperties, useEffect, useRef } from "react";
import {
  Check,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <LoaderCircle
      size={small ? 15 : 18}
      className="spinner"
      aria-hidden="true"
    />
  );
}
export function HeroArt({
  variant = "home",
  className = "",
}: {
  variant?: "home" | "pot";
  className?: string;
}) {
  return (
    <div
      className={`hero-art hero-art-${variant} ${className}`}
      aria-hidden="true"
    >
      <span className="art-orbit art-orbit-one" />
      <span className="art-orbit art-orbit-two" />
      <img
        src={`/assets/budg-${variant === "home" ? "home" : "savings"}-illustration.png`}
        alt=""
        width="1536"
        height="1024"
        decoding="async"
      />
      <span className="art-sparkle art-sparkle-one">
        <Sparkles size={22} strokeWidth={1.4} />
      </span>
      <span className="art-sparkle art-sparkle-two">
        <PlusMark />
      </span>
    </div>
  );
}
function PlusMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path
        d="M8 2v12M2 8h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function FundingRing({ percent }: { percent: number }) {
  const progress = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <svg
      className="funding-ring"
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Budget financé à ${progress} %`}
      style={{ "--ring-offset": 100 - progress } as CSSProperties}
    >
      <circle className="ring-track" cx="32" cy="32" r="26" />
      <circle className="ring-value" cx="32" cy="32" r="26" pathLength="100" />
      <text x="32" y="36" textAnchor="middle" aria-hidden="true">
        {progress}%
      </text>
    </svg>
  );
}
export function EmptyGraphic() {
  return (
    <div className="empty-graphic" aria-hidden="true">
      <span className="empty-paper empty-paper-back" />
      <span className="empty-paper">
        <WalletCards size={30} strokeWidth={1.3} />
        <i />
        <i />
      </span>
      <span className="empty-seal">
        <Check size={13} />
      </span>
      <Sparkles size={18} className="empty-sparkle" strokeWidth={1.3} />
    </div>
  );
}
export function Toast({
  message,
  dismiss,
}: {
  message: string;
  dismiss: () => void;
}) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 5500);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-icon">
        <CheckCircle2 size={20} />
      </span>
      <div>
        <strong>C’est enregistré</strong>
        <p>{message}</p>
      </div>
      <button
        className="icon-button"
        aria-label="Fermer la confirmation"
        onClick={dismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export function LoadingScreen() {
  return (
    <div
      className="loading-stage"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="loading-brand">
        <img src="/assets/budg-logo.png" alt="" width="44" height="44" />
        <strong>BUDG</strong>
      </div>
      <div className="loading-skeleton" aria-hidden="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-subtitle" />
        <div className="skeleton skeleton-hero" />
        <div className="skeleton-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton skeleton-card" key={i} />
          ))}
        </div>
      </div>
      <div className="loading-caption">
        <Spinner />
        <span>Ouverture de votre espace…</span>
      </div>
      <p className="loading-reassurance">
        <ShieldCheck size={14} aria-hidden="true" />
        Votre budget reste sur cet appareil.
      </p>
    </div>
  );
}
