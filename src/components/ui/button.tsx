import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button vp-motion-fast inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-[transform,background-color,color,border-color,box-shadow,opacity] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/30 not-aria-[haspopup]:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 motion-reduce:transform-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(180deg,#5c6cf0_0%,#4b5ae2_100%)] text-primary-foreground shadow-(--primary-shadow) hover:brightness-110 disabled:shadow-none",
        outline:
          "border-[rgb(30_34_70/0.1)] bg-white/75 text-foreground shadow-[inset_0_1px_0_white,0_1px_2px_rgb(30_34_70/0.07)] hover:bg-white aria-expanded:bg-white",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost:
          "text-muted-foreground hover:bg-foreground/5 hover:text-foreground aria-expanded:bg-foreground/5 aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(120_20_10/0.3)] hover:brightness-110 focus-visible:ring-destructive/30",
        link: "h-auto! rounded-sm px-0! text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-6 gap-1 rounded-md px-2 text-[12px] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
