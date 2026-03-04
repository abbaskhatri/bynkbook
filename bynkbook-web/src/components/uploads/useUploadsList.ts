"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";

export type UploadListItem = {
  id: string;
  business_id: string;
  account_id: string | null;
  upload_type: string;
  original_filename: string;
  content_type: string;
  size_bytes: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  meta: any;
};

export function useUploadsList(args: {
  businessId: string;
  accountId?: string;
  type?: string; // supports "RECEIPT,INVOICE" (comma-separated)
  vendorId?: string;
  limit?: number;
}) {
  const { businessId, accountId, type, vendorId, limit = 10 } = args;

  const [items, setItems] = useState<UploadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myReq = ++reqIdRef.current;

    async function run() {
      if (!businessId) return;
      setLoading(true);
      setError(null);

      try {
        const qs = new URLSearchParams();
        qs.set("limit", String(limit));
        if (type) qs.set("type", type);
        if (accountId) qs.set("accountId", accountId);
        if (vendorId) qs.set("vendorId", vendorId);

        const res = await apiFetch(`/v1/businesses/${businessId}/uploads?${qs.toString()}`, { method: "GET" });
        if (!res?.ok) throw new Error(res?.error || "Failed to load uploads");

        if (!cancelled && myReq === reqIdRef.current) setItems(res.items ?? []);
      } catch (e: any) {
        if (!cancelled && myReq === reqIdRef.current) setError(e?.message || "Failed to load uploads");
      } finally {
        if (!cancelled && myReq === reqIdRef.current) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [businessId, accountId, type, vendorId, limit]);

  async function refetch() {
    // Force a new request id so stale in-flight cannot win.
    reqIdRef.current += 1;
    const myReq = reqIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(limit));
      if (type) qs.set("type", type);
      if (accountId) qs.set("accountId", accountId);
      if (vendorId) qs.set("vendorId", vendorId);

      const res = await apiFetch(`/v1/businesses/${businessId}/uploads?${qs.toString()}`, { method: "GET" });
      if (!res?.ok) throw new Error(res?.error || "Failed to load uploads");

      if (myReq === reqIdRef.current) setItems(res.items ?? []);
    } catch (e: any) {
      if (myReq === reqIdRef.current) setError(e?.message || "Failed to load uploads");
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }

  return { items, loading, error, refetch };
}
