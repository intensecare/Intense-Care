import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "success";
  size?: "default" | "sm" | "lg" | "icon";
  /** Shows a spinner and disables the button while an action runs. */
  loading?: boolean;
}

/**
 * The one button. Coral = primary, green = success, red = destructive.
 * Default height 44px (touch-friendly); lg = 52px for primary page actions.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", loading, disabled, children, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors select-none cursor-pointer disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] transition-transform";
    const variants = {
      default: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm",
      success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
      destructive: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
      outline: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
      secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
      ghost: "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900",
      link: "text-rose-600 underline-offset-4 hover:underline h-auto px-0",
    };
    const sizes = {
      default: "h-11 px-4 text-sm",
      sm: "h-10 px-3.5 text-sm",
      lg: "h-13 min-h-[52px] px-6 text-base",
      icon: "h-10 w-10",
    };
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], variant === "link" ? "" : sizes[size], className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
