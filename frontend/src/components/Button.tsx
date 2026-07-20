import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent hover:bg-accent-hover text-white shadow-[0_1px_0_rgba(255,255,255,.08)_inset] hover:-translate-y-px",
  secondary:
    "bg-surface hover:bg-surface-hover text-text border border-border hover:border-border-strong",
  ghost: "text-text-muted hover:text-text hover:bg-surface-hover",
  danger: "bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", disabled, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 active:scale-[.98] active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
