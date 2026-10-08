import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** The one text input: 44px tall, 16px text on phones (no iOS zoom). */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-xl border border-zinc-300 bg-white px-3.5 text-sm text-zinc-900 transition-colors placeholder:text-zinc-400 focus-visible:outline-none focus-visible:border-rose-500 focus-visible:ring-2 focus-visible:ring-rose-100 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500 file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

/** Label + control + helper / error text, consistently spaced. */
function Field({ label, required, hint, error, children, className, htmlFor }: { label: string; required?: boolean; hint?: string; error?: string | null; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-800">
        {label}
        {required && <span className="text-rose-600 ml-0.5" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="text-xs font-medium text-red-700" role="alert">{error}</p> : hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export { Input, Field };
