import { ReactNode, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export function MobileDetails({ children, label, name }: {
  children: ReactNode;
  label: string;
  name: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <div className={`mobile-details${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="mobile-details-toggle"
        aria-label={`${label} · ${name}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{label}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className="mobile-details-content" id={contentId}>{children}</div>
    </div>
  );
}
