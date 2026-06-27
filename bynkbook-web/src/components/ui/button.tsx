import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { AppTooltip } from "@/components/ui/tooltip"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.16)_inset] hover:bg-primary/90 dark:shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:border dark:border-bb-status-danger-border dark:bg-bb-status-danger-bg dark:text-bb-status-danger-fg dark:focus-visible:ring-destructive/40",
        outline:
          "border border-bb-border bg-bb-surface-card shadow-xs hover:bg-bb-table-row-hover hover:text-accent-foreground dark:bg-bb-surface-card dark:border-bb-border dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] dark:hover:bg-bb-table-row-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
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
  title,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
}) {
  const Comp = asChild ? Slot : "button"
  const tooltipContent = typeof title === "string" && title.trim() ? title : undefined

  const button = (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-label={props["aria-label"] ?? (size?.toString().startsWith("icon") ? tooltipContent : undefined)}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )

  return tooltipContent ? <AppTooltip content={tooltipContent}>{button}</AppTooltip> : button
}

export { Button, buttonVariants }
