import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "vp-motion-control flex field-sizing-content min-h-20 w-full rounded-[12px] border border-input bg-card px-3 py-2.5 text-[13px] leading-6 text-foreground shadow-(--control-shadow) transition-[background-color,border-color,color,box-shadow,opacity] outline-none placeholder:text-muted-foreground hover:border-primary/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
