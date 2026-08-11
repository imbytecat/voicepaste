import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      nativeButton
      render={
        <button
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          type="button"
        />
      }
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent bg-clip-padding p-0.5 transition-[background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 active:scale-[0.96] data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block rounded-full bg-[#fffdf9] shadow-[0_2px_5px_rgba(47,58,49,0.24)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 data-checked:group-data-[size=default]/switch:translate-x-5 data-checked:group-data-[size=sm]/switch:translate-x-4 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
