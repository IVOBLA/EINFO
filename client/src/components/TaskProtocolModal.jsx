import React, { useEffect } from "react";
import ProtokollPage from "../pages/ProtokollPage.jsx";

export default function TaskProtocolModal({ open, mode = "create", editNr = null, payload, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (typeof onClose === "function") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 overflow-hidden">
      <div className="min-h-full flex items-center justify-center p-2 md:p-4">
        <div className="relative w-full max-w-5xl max-h-[calc(100vh-1rem)] md:max-h-[calc(100vh-2rem)] rounded-2xl shadow-2xl bg-white flex flex-col">
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-sm font-medium shadow hover:bg-white"
            title="Meldung schließen"
          >
            ✕
          </button>
          <div className="flex-1 overflow-y-auto overscroll-contain pt-10 md:pt-12 px-2 md:px-4 pb-4">
            <ProtokollPage
              mode={mode}
              editNr={mode === "edit" ? editNr : null}
              onRequestClose={handleClose}
              onSaved={handleClose}
              taskPrefillPayload={mode === "create" ? payload : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
