"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { AppDialog as AppDialogComponent } from "./AppDialog";

type AppDialogProps = ComponentProps<typeof AppDialogComponent>;

const DynamicAppDialog = dynamic(
  () => import("./AppDialog").then((module) => module.AppDialog),
  { loading: () => null },
);

export function LazyAppDialog(props: AppDialogProps) {
  if (!props.open) return null;
  return <DynamicAppDialog {...props} />;
}
