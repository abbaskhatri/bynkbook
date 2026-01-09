"use client";

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  inlineAfterTitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const { title, subtitle, inlineAfterTitle, right } = props;

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          {inlineAfterTitle ? <div className="pt-[1px]">{inlineAfterTitle}</div> : null}
        </div>
        {subtitle ? <p className="text-sm text-muted-foreground mt-1">{subtitle}</p> : null}
      </div>

      {right ? <div className="flex items-center gap-3">{right}</div> : null}
    </div>
  );
}
