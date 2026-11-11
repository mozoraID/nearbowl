"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastInput = {
  tone: "ok" | "err";
  title: string;
  detail?: string;
  href?: string;
};

type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current, { ...toast, id }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 9000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toaster" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <p className="toast-title">{toast.title}</p>
            {toast.detail ? <p className="toast-detail">{toast.detail}</p> : null}
            {toast.href ? (
              <a href={toast.href} target="_blank" rel="noreferrer">
                View on NearBlocks
              </a>
            ) : null}
            <button type="button" className="toast-x" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
