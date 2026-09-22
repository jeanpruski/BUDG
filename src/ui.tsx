import { FormEvent, ReactNode, useEffect, useId, useRef } from "react";
import { CircleDollarSign, LucideIcon, X } from "lucide-react";
import { EmptyGraphic, Spinner } from "./visuals";

export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="dialog-body">
        <div className="section-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fermer"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Field({
  label,
  name,
  value,
  type = "text",
  required = true,
  min,
  max,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={min}
        max={max}
        maxLength={type === "text" ? 200 : undefined}
        placeholder={placeholder}
        inputMode={
          name.includes("amount") || name.includes("income")
            ? "decimal"
            : undefined
        }
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Form({
  children,
  submit,
  busy,
  button = "Enregistrer",
}: {
  children: ReactNode;
  submit: (data: FormData) => void;
  busy: boolean;
  button?: string;
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit(new FormData(e.currentTarget));
  }
  return (
    <form onSubmit={onSubmit} aria-busy={busy}>
      <fieldset disabled={busy}>
        {children}
        <button className="primary" type="submit">
          {busy && <Spinner />}
          {busy ? "Enregistrement…" : button}
        </button>
      </fieldset>
    </form>
  );
}
export function Metric({
  label,
  value,
  detail,
  tone = "",
  icon: Icon = CircleDollarSign,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-heading">
        <span className="metric-icon">
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span>{label}</span>
      </div>
      <strong key={value} className="metric-value">
        {value}
      </strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <EmptyGraphic />
      <p>{children}</p>
    </div>
  );
}
export const displayDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR");
