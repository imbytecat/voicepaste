import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

type ToggleGroupStyle = VariantProps<typeof toggleVariants>;

const ToggleGroupContext = React.createContext<ToggleGroupStyle>({});

function ToggleGroup({
  className,
  variant,
  size,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props & ToggleGroupStyle) {
  const contextValue = React.useMemo(
    () => ({ size, variant }),
    [size, variant]
  );

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      orientation={orientation}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-1 rounded-lg data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={contextValue}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & ToggleGroupStyle) {
  const context = React.useContext(ToggleGroupContext);
  const resolvedVariant = context.variant ?? variant;
  const resolvedSize = context.size ?? size;

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      className={cn(
        "shrink-0 focus:z-10 focus-visible:z-10",
        toggleVariants({
          variant: resolvedVariant,
          size: resolvedSize,
        }),
        className,
        "text-xs"
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
