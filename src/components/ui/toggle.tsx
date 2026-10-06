"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "group/toggle vp-motion-control inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent text-[12px] font-medium whitespace-nowrap text-muted-foreground transition-[transform,background-color,color,border-color,box-shadow,opacity] outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:border-border aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-[inset_0_1px_0_white,0_0_0_0.5px_rgb(30_34_70/0.08),0_2px_6px_-1px_rgb(30_34_70/0.18)] data-[state=on]:border-border data-[state=on]:bg-white data-[state=on]:text-foreground data-[state=on]:shadow-[inset_0_1px_0_white,0_0_0_0.5px_rgb(30_34_70/0.08),0_2px_6px_-1px_rgb(30_34_70/0.18)] motion-reduce:transform-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-card/40 hover:bg-card",
      },
      size: {
        default:
          "h-7 min-w-7 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "h-6 min-w-6 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 min-w-8 px-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
