import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer";

    /* Brand: coral #ea506c + white are the primary brand pair — every solid
       action is coral, hovering to the deeper #d63c58; red stays destructive-only. */
    const variants = {
      default: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm border border-rose-500",
      destructive: "bg-red-700 text-white hover:bg-red-800 border border-red-700",
      outline: "border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 shadow-none",
      secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200",
      ghost: "hover:bg-slate-100 text-slate-700 hover:text-slate-900",
      link: "text-rose-600 underline-offset-4 hover:underline p-0 h-auto",
    };

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 px-3 text-xs",
      lg: "h-10 px-5 text-sm",
      icon: "h-8 w-8",
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };

