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
      "inline-flex items-center justify-center whitespace-nowrap rounded text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer";

    const variants = {
      default: "bg-black text-white hover:bg-zinc-800 shadow-none border border-black",
      destructive: "bg-zinc-900 text-white hover:bg-black border border-zinc-900",
      outline: "border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-900 shadow-none",
      secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 border border-zinc-200",
      ghost: "hover:bg-zinc-100 text-zinc-700 hover:text-black",
      link: "text-black underline-offset-4 hover:underline p-0 h-auto",
    };

    const sizes = {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded px-3 text-xs",
      lg: "h-10 rounded px-5 text-sm",
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

