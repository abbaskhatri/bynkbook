"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  collapsed?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "full";
  tone?: "default" | "light";
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

const fullAssetsLight = {
  sm: { src: "/brand/bynkbook-logo-horizontal-white.png", width: 112, height: 24 },
  md: { src: "/brand/bynkbook-logo-horizontal-white.png", width: 136, height: 30 },
  lg: { src: "/brand/bynkbook-logo-horizontal-white.png", width: 176, height: 38 },
} as const;

export function BrandLogo({
  collapsed = false,
  size = "md",
  variant,
  tone = "default",
  className,
  priority = false,
}: BrandLogoProps) {
  const resolvedVariant = collapsed ? "icon" : (variant ?? "full");

  const asset =
    resolvedVariant === "icon"
      ? iconAssets[size]
      : tone === "light"
        ? fullAssetsLight[size]
        : fullAssetsDefault[size];

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center",
        resolvedVariant === "icon" ? "justify-center" : "justify-start",
        className
      )}
    >
      <Image
        src={asset.src}
        alt="BynkBook"
        width={asset.width}
        height={asset.height}
        priority={priority}
        className="h-auto w-auto max-w-full select-none object-contain"
      />
    </div>
  );
}

export default BrandLogo;