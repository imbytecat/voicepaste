import {
  Check,
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { BRAND_LOGOS } from "@/components/settings/brands";
import type { Brand } from "@/components/settings/brands";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatShortcut, formatShortcutLabel } from "@/shortcut";

/*
 * Settings design kit. Every settings surface composes these pieces so the
 * app keeps one rhythm: a group label, a softly elevated card, rows of
 * "title / one-line hint ... control".
 */

export type Tone = "info" | "success" | "warning" | "error";
export type Message = {
  kind: "success" | "error" | "info";
  text: string;
} | null;

const TONE_STYLE: Record<Tone, { className: string; icon: LucideIcon }> = {
  error: {
    className: "bg-destructive/6 text-destructive ring-1 ring-destructive/12",
    icon: CircleAlert,
  },
  info: {
    className: "bg-accent text-accent-foreground ring-1 ring-primary/10",
    icon: Info,
  },
  success: {
    className: "bg-success/7 text-success ring-1 ring-success/12",
    icon: CheckCircle2,
  },
  warning: {
    className: "bg-warning/8 text-warning ring-1 ring-warning/15",
    icon: TriangleAlert,
  },
};

/**
 * Section hues. Tiles are clear glass with a tinted glyph; `filled` lights the
 * tile up in its hue to mark the current or selected item.
 */
export const TILE_HUES = {
  amber: { fill: "from-[#ffc552] to-[#ec9206]", glyph: "text-[#c27c00]" },
  blue: { fill: "from-[#5cbaff] to-[#1877e0]", glyph: "text-[#1f7ad6]" },
  graphite: { fill: "from-[#959cad] to-[#596071]", glyph: "text-[#5d6476]" },
  green: { fill: "from-[#52d687] to-[#13994d]", glyph: "text-[#17924c]" },
  indigo: { fill: "from-[#7d8bff] to-[#4553dc]", glyph: "text-[#4d5ae0]" },
  rose: { fill: "from-[#ff86a3] to-[#e03a63]", glyph: "text-[#d8436a]" },
  violet: { fill: "from-[#bb97ff] to-[#7a4fe0]", glyph: "text-[#7b52dd]" },
} as const;
export type TileHue = keyof typeof TILE_HUES;

export function IconTile({
  icon: Icon,
  hue,
  size = "md",
  filled = false,
}: {
  icon: LucideIcon;
  hue: TileHue;
  size?: "sm" | "md" | "lg";
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "vp-motion-control grid shrink-0 place-items-center transition-[color,background-color,box-shadow]",
        filled
          ? `bg-linear-to-b text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-1px_1px_rgb(0_0_0/0.08),0_2px_6px_-1px_rgb(30_34_70/0.3)] ${TILE_HUES[hue].fill}`
          : `vp-glass-strong ${TILE_HUES[hue].glyph}`,
        size === "sm" && "size-6 rounded-[7px] [&_svg]:size-3.5",
        size === "md" && "size-8 rounded-[9px] [&_svg]:size-4.5",
        size === "lg" && "size-11 rounded-[13px] [&_svg]:size-5.5"
      )}
    >
      <Icon strokeWidth={filled ? 2 : 1.85} />
    </span>
  );
}

export function Group({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title || description || actions ? (
        <header className="flex min-h-6 items-end justify-between gap-4 px-1.5">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[12px] font-medium tracking-[0.04em] text-muted-foreground">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-[12px] leading-4.5 text-pretty text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-1">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className="vp-glass-strong overflow-hidden rounded-[16px] [&>*]:relative [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:right-0 [&>*+*]:before:left-4 [&>*+*]:before:h-px [&>*+*]:before:bg-[rgb(30_34_70/0.08)] [&>*+*]:before:content-['']">
        {children}
      </div>
    </section>
  );
}

export function ChangedDot() {
  return (
    <span
      className="vp-state-pop inline-block size-1.5 shrink-0 rounded-full bg-brand"
      role="img"
      aria-label="已修改，未保存"
    />
  );
}

export function Row({
  title,
  description,
  changed = false,
  htmlFor,
  stacked = false,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  changed?: boolean;
  htmlFor?: string;
  stacked?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const Title = htmlFor ? "label" : "h3";
  const heading = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Title
          className="text-[13px] leading-5 font-medium text-foreground/90"
          htmlFor={htmlFor}
        >
          {title}
        </Title>
        {changed ? <ChangedDot /> : null}
      </div>
      {description ? (
        <p className="mt-0.5 text-[12px] leading-4.5 text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
  if (stacked)
    return (
      <div className={cn("space-y-3 px-4 py-3.5", className)}>
        {heading}
        {children}
      </div>
    );
  return (
    <div
      className={cn(
        "flex min-h-14 items-center justify-between gap-6 px-4 py-3",
        className
      )}
    >
      {heading}
      {children ? (
        <div className="flex max-w-[60%] shrink-0 items-center justify-end gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Block({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-3.5", className)} {...props} />;
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { className: toneClass, icon: Icon } = TONE_STYLE[tone];
  return (
    <div
      className={cn(
        "vp-feedback-enter flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12px] leading-4.5",
        toneClass,
        className
      )}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 wrap-break-word">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
      {action ? (
        <div className="-my-1 flex shrink-0 items-center gap-1">{action}</div>
      ) : null}
    </div>
  );
}

export function Feedback({
  message,
  className,
}: {
  message: Message;
  className?: string;
}) {
  if (!message) return null;
  return (
    <Notice tone={message.kind} className={className}>
      {message.text}
    </Notice>
  );
}

export function StatusText({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const Icon = TONE_STYLE[tone].icon;
  const color =
    tone === "info"
      ? "text-muted-foreground"
      : tone === "error"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "text-success";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium",
        color,
        className
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A brand's own mark on a clear glass tile; logos keep their own colours. */
export function BrandMark({
  brand,
  size = "md",
}: {
  brand: Brand;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center",
        size === "xs" ? "size-4" : "vp-glass-strong [&_img]:size-[60%]",
        size === "sm" && "size-6 rounded-[7px]",
        size === "md" && "size-8 rounded-[9px]",
        size === "lg" && "size-11 rounded-[13px]"
      )}
    >
      <img
        src={BRAND_LOGOS[brand]}
        alt=""
        draggable={false}
        className={size === "xs" ? "size-4" : undefined}
      />
    </span>
  );
}

export type Choice<Value extends string> = {
  value: Value;
  title: string;
  description: string;
  disabled?: boolean;
} & ({ icon: LucideIcon; hue: TileHue } | { brand: Brand });

/** Radio group rendered as selectable cards: icon tile, title, one-line hint. */
export function ChoiceCards<Value extends string>({
  legend,
  value,
  onValueChange,
  options,
  disabled,
}: {
  legend: string;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly Choice<Value>[];
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="mx-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      <div
        className={cn(
          "grid gap-2.5",
          options.length > 2 ? "grid-cols-3" : "grid-cols-2"
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "vp-motion-control flex cursor-pointer flex-col gap-3 rounded-[16px] p-4 transition-[box-shadow,transform] has-focus-visible:ring-3 has-focus-visible:ring-ring/25 has-enabled:active:scale-[0.99] has-disabled:cursor-not-allowed has-disabled:opacity-50",
                selected
                  ? "vp-glass-strong shadow-[inset_0_1px_0_rgb(255_255_255/0.95),0_0_0_1.5px_var(--primary),0_14px_32px_-14px_rgb(79_95_230/0.55)]"
                  : "vp-glass hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.95),0_0_0_1px_rgb(30_34_70/0.1),0_16px_36px_-16px_rgb(40_46_110/0.3)]"
              )}
            >
              <input
                className="sr-only"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => {
                  onValueChange(option.value);
                }}
              />
              <span className="flex items-start justify-between">
                {"brand" in option ? (
                  <BrandMark brand={option.brand} />
                ) : (
                  <IconTile
                    icon={option.icon}
                    hue={option.hue}
                    filled={selected}
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "vp-motion-fast grid size-5 place-items-center rounded-full transition-[background-color,box-shadow,color]",
                    selected
                      ? "bg-primary text-white shadow-[0_2px_6px_-1px_rgb(79_95_230/0.6)]"
                      : "text-transparent shadow-[inset_0_0_0_1.5px_var(--input)]"
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] leading-5 font-semibold text-foreground">
                  {option.title}
                </span>
                <span className="mt-0.5 block text-[12px] leading-4.5 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Segmented<Value extends string>({
  value,
  onValueChange,
  options,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly { value: Value; label: ReactNode; disabled?: boolean }[];
  className?: string;
  disabled?: boolean;
  "aria-label": string;
}) {
  return (
    <ToggleGroup
      className={cn("w-full", className)}
      value={[value]}
      disabled={disabled}
      onValueChange={(values) => {
        const next = values[0] as Value | undefined;
        if (next) onValueChange(next);
      }}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          className="flex-1"
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Keycap({ shortcut }: { shortcut: string }) {
  return (
    <kbd
      aria-label={formatShortcutLabel(shortcut)}
      className="inline-flex items-center gap-1 font-sans"
    >
      {formatShortcut(shortcut)
        .split(/\+(?=.)/u)
        .map((key, index) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- keys of one shortcut may repeat text but never reorder
            key={index}
            aria-hidden="true"
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-input bg-card px-1.5 font-mono text-[12px] leading-none font-medium text-foreground shadow-[0_1px_0_var(--input),inset_0_-1px_0_rgb(21_23_40/0.04)]"
          >
            {key}
          </span>
        ))}
    </kbd>
  );
}

export function SecretInput({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
  ...props
}: Omit<ComponentProps<"input">, "type" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? "隐藏" : "显示";
  return (
    <div className={cn("relative w-full", className)}>
      <Input
        {...props}
        aria-label={ariaLabel}
        className="pr-9"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        className="absolute top-1/2 right-0.5 -translate-y-1/2"
        onClick={() => {
          setVisible(!visible);
        }}
        aria-label={`${toggleLabel}${ariaLabel ?? ""}`}
        aria-pressed={visible}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-8 text-center",
        className
      )}
    >
      {Icon ? (
        <span className="vp-glass-strong mb-3.5 grid size-12 place-items-center rounded-[14px] text-primary">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-[14px] font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[40ch] text-[12px] leading-4.5 text-balance text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex gap-2">{action}</div> : null}
    </div>
  );
}

export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`vp-motion-layout grid transition-[grid-template-rows] motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
