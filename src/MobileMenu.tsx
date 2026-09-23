import { useEffect, useRef, useState, ReactNode } from "react";
import { Menu, X } from "lucide-react";

export function MobileMenu({
  children,
  home,
}: {
  children: (close: () => void) => ReactNode;
  home: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const panel = dialog.current!;
    panel.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 761px)");
    const resize = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", resize);
    return () => {
      panel.close();
      document.body.style.overflow = previous;
      desktop.removeEventListener("change", resize);
    };
  }, [open]);
  return (
    <div className="mobile-topbar">
      <button
        className="mobile-brand"
        onClick={home}
        aria-label="BUDG — accueil"
      >
        <img src="/assets/budg-logo.png" alt="" /> <strong>BUDG</strong>
      </button>
      <button
        className="mobile-menu-toggle"
        aria-label="Ouvrir le menu"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen(true)}
      >
        <Menu size={24} />
      </button>
      <dialog
        ref={dialog}
        id="mobile-navigation"
        className="mobile-drawer"
        aria-labelledby="mobile-menu-title"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              setOpen(false);
          }
        }}
      >
        <div className="mobile-drawer-heading">
          <h2 id="mobile-menu-title">Votre espace</h2>
          <button
            className="mobile-menu-toggle"
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
          >
            <X size={24} />
          </button>
        </div>
        <nav aria-label="Navigation mobile">
          {children(() => setOpen(false))}
        </nav>
        <p className="mobile-menu-note">À deux, simplement.</p>
      </dialog>
    </div>
  );
}
