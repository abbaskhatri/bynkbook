import React from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;

  // Optional icon tile left of title
  icon?: React.ReactNode;

  // Optional inline slot next to title (e.g., account capsule)
  afterTitle?: React.ReactNode;
};

export function PageHeader(props: PageHeaderProps) {
  const { title, subtitle, right, className, afterTitle, icon } = props;

  return (
    <div className={["flex flex-col gap-2 md:flex-row md:items-center md:justify-between", className].filter(Boolean).join(" ")}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {icon ? (
            <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] dark:shadow-[0_1px_0_rgba(255,255,255,0.10)_inset]">
              {icon}
            </div>
          ) : null}
          <h1 className="truncate text-lg font-semibold text-foreground md:text-xl">{title}</h1>
          {afterTitle ? <div className="shrink-0">{afterTitle}</div> : null}
        </div>

        {subtitle ? (
          <div className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>

      {right ? <div className="min-w-0 shrink-0 self-start md:self-auto">{right}</div> : null}
    </div>
  );
}
