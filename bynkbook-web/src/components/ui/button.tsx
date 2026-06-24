import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.16)_inset,0_8px_18px_rgba(5,150,105,0.18)] hover:bg-primary/90 hover:-translate-y-px dark:shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_10px_24px_rgba(52,211,153,0.16)]",
        destructive:
          "bg-destructive text-white shadow-[0_8px_18px_rgba(220,38,38,0.16)] hover:bg-destructive/90 hover:-translate-y-px focus-visible:ring-destructive/20 dark:border dark:border-bb-status-danger-border dark:bg-bb-status-danger-bg dark:text-bb-status-danger-fg dark:focus-visible:ring-destructive/40",
        outline:
          "border border-bb-border bg-bb-surface-card shadow-xs hover:bg-bb-table-row-hover hover:text-accent-foreground dark:bg-bb-surface-card dark:border-bb-border dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] dark:hover:bg-bb-table-row-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:-translate-y-px",
        ghost:
          "hover:bg-bb-table-row-hover hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5 has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-8",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
