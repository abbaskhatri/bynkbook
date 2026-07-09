"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  collapsed?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "full";
  tone?: "default" | "light" | "auto";
  className?: string;
  priority?: boolean;
};

const iconAssets = {
  sm: { src: "/brand/bynkbook-icon-64.png", width: 28, height: 28 },
  md: { src: "/brand/bynkbook-icon-64.png", width: 32, height: 32 },
  lg: { src: "/brand/bynkbook-icon-128.png", width: 40, height: 40 },
} as const;

const fullAssetsDefault = {
  sm: { src: "/brand/bynkbook-logo-horizontal.png", width: 112, height: 24 },
  md: { src: "/brand/bynkbook-logo-horizontal.png", width: 136, height: 30 },
  lg: { src: "/brand/bynkbook-logo-horizontal.png", width: 176, height: 38 },
} as const;

const fullTextSizes = {
  sm: "text-[24px]",
  md: "text-[30px]",
  lg: "text-[38px]",
} as const;

const fullTextGaps = {
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
} as const;

function LightFullLogo({
  size,
  className,
  priority,
}: {
  size: "sm" | "md" | "lg";
  className?: string;
  priority: boolean;
}) {
  const icon = iconAssets[size];

  return (
    <div className={cn("inline-flex shrink-0 items-center", fullTextGaps[size], className)} aria-label="BynkBook">
      <Image
        src={icon.src}
        alt=""
        width={icon.width}
        height={icon.height}
        priority={priority}
        className="h-auto w-auto max-w-full select-none object-contain"
        aria-hidden="true"
      />
      <span className={cn("select-none font-semibold leading-none tracking-tight text-white", fullTextSizes[size])}>
        BynkBook
      </span>
    </div>
  );
}

export function BrandLogo({
  collapsed = false,
  size = "md",
  variant,
  tone = "auto",
  className,
  priority = false,
}: BrandLogoProps) {
  const resolvedVariant = collapsed ? "icon" : (variant ?? "full");

  const asset =
    resolvedVariant === "icon"
      ? iconAssets[size]
      : fullAssetsDefault[size];

  const imageClass = "h-auto w-auto max-w-full select-none object-contain";

  if (resolvedVariant === "full" && tone === "light") {
    return <LightFullLogo size={size} priority={priority} className={className} />;
  }

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center",
        resolvedVariant === "icon" ? "justify-center" : "justify-start",
        className
      )}
    >
      {tone === "auto" && resolvedVariant === "full" ? (
        <>
          <Image
            src={asset.src}
            alt="BynkBook"
            width={asset.width}
            height={asset.height}
            priority={priority}
            className={cn(imageClass, "dark:hidden")}
          />
          <LightFullLogo
            size={size}
            priority={priority}
            className="hidden drop-shadow-[0_1px_0_rgba(0,0,0,0.35)] dark:inline-flex"
          />
        </>
      ) : (
        <Image
          src={asset.src}
          alt="BynkBook"
          width={asset.width}
          height={asset.height}
          priority={priority}
          className={imageClass}
        />
      )}
    </div>
  );
}

export default BrandLogo;
