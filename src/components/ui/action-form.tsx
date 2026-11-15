"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Progressive-enhancement form bound to a server action. Shows a toast on success, an inline
 * alert on failure, and marks invalid fields (matched by `name`) for assistive technology.
 */
export function ActionForm({ action, children, className, resetOnSuccess, onSuccess, inlineSuccess, ...rest }: { action: FormAction; children: ReactNode; resetOnSuccess?: boolean; onSuccess?: (state: NonNullable<ActionState>) => void; inlineSuccess?: boolean } & Omit<ComponentProps<"form">, "action" | "children">) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    const form = ref.current;
    form?.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    if (state.ok) {
      if (state.message && !inlineSuccess) toast.success(state.message);
      if (resetOnSuccess) form?.reset();
      onSuccessRef.current?.(state);
    } else if (state.fieldErrors && form) {
      let first: HTMLElement | null = null;
      for (const name of Object.keys(state.fieldErrors)) {
        const el = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
        if (el) {
          el.setAttribute("aria-invalid", "true");
          first ??= el;
        }
      }
      first?.focus();
    }
  }, [state, resetOnSuccess, inlineSuccess]);

  return (
    <form ref={ref} action={formAction} className={className} noValidate={false} {...rest}>
      {state && !state.ok && state.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-[#ffc9c3]">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.message && inlineSuccess ? (
        <p role="status" className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-[#b5efd2]">
          {state.message}
        </p>
      ) : null}
      {children}
    </form>
  );
}

export function SubmitButton({ children, className, confirm, pendingLabel, ...rest }: { confirm?: string; pendingLabel?: string } & ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...rest}
      className={cn("btn btn-gold", className)}
      disabled={pending || rest.disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        rest.onClick?.(e);
      }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
