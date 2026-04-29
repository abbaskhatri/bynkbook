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
    <div className={["flex items-center justify-between", className].filter(Boolean).join(" ")}>
      <div className="min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          {icon ? (
            <div className="h-8 w-8 rounded-lg border border-primary/20 bg-primary/10 text-primary inline-flex items-center justify-center shrink-0">
              {icon}
            </div>
          ) : null}
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {afterTitle ? <div className="shrink-0">{afterTitle}</div> : null}
        </div>

        {subtitle ? (
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>

      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
