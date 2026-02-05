"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { UploadType, UploadContext } from "./uploadTypes";
import { apiFetch } from "@/lib/api/client";

export type UploadItemStatus = "QUEUED" | "UPLOADING" | "UPLOADED" | "COMPLETED" | "FAILED" | "CANCELED";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  progress: number; // 0..100
  error?: string;

  // server session
  uploadId?: string;
  key?: string;
  bucket?: string;
  etag?: string;

  // server results (from /complete)
  completedMeta?: Record<string, any>;
  parsedStatus?: string | null;
  parsed?: Record<string, any> | null;

  createdAt: number;
};

function id() {
  return Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

type InitResponse = {
  ok: boolean;
  upload: {
    id: string;
    bucket?: string;
    key?: string;
    method: "PUT" | "DUPLICATE";
    url?: string;
    headers?: Record<string, string>;
    expiresInSeconds?: number;
  };
};

export function useUploadController(args: { type: UploadType; ctx?: UploadContext; meta?: Record<string, any> }) {
  const { type, ctx } = args;

  const [items, setItems] = useState<UploadItem[]>([]);
  const xhrs = useRef<Record<string, XMLHttpRequest>>({});

  const hasActiveUploads = useMemo(() => {
    return items.some((i) => i.status === "QUEUED" || i.status === "UPLOADING");
  }, [items]);

  const requireBusinessId = () => {
    const businessId = ctx?.businessId?.trim();
    if (!businessId) throw new Error("Missing businessId for upload");
    return businessId;
  };

  const initOne = useCallback(
    async (file: File) => {
      const businessId = requireBusinessId();
      const accountId = ctx?.accountId?.trim() || null;

      const body = {
        type,
        accountId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        meta: args?.meta ?? {},
      };

      try {
        const res = (await apiFetch(`/v1/businesses/${businessId}/uploads/init`, {
          method: "POST",
          body: JSON.stringify(body),
        })) as InitResponse;

        if (!res?.ok) throw new Error("Init failed");
        return res.upload;
      } catch (e: any) {
        // apiFetch throws: "API 409: { ...json... }"
        const msg = String(e?.message ?? "");
        if (msg.startsWith("API 409:")) {
          const raw = msg.replace(/^API 409:\s*/, "").trim();
          const payload = (() => {
            try { return JSON.parse(raw); } catch { return null; }
          })();

          if (payload?.code === "DUPLICATE_UPLOAD" && payload?.upload_id) {
            return { id: String(payload.upload_id), method: "DUPLICATE" as const };
          }
        }

        throw e;
      }
    },
    [ctx?.accountId, ctx?.businessId, type],
  );

  const completeOne = useCallback(
    async (uploadId: string) => {
      const businessId = requireBusinessId();

      const res = await apiFetch(`/v1/businesses/${businessId}/uploads/complete`, {
        method: "POST",
        body: JSON.stringify({ uploadId }),
      });

      return res;
    },
    [ctx?.businessId],
  );

  const uploadPutWithProgress = useCallback(
    (localId: string, url: string, file: File, headers?: Record<string, string>) => {
      return new Promise<{ etag?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrs.current[localId] = xhr;

        xhr.open("PUT", url, true);

        // Apply any signed headers
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            try {
              xhr.setRequestHeader(k, v);
            } catch {}
          }
        }

        xhr.upload.onprogress = (evt) => {
          if (!evt.lengthComputable) return;
          const pct = Math.max(1, Math.min(95, Math.round((evt.loaded / evt.total) * 95)));
          setItems((prev) => prev.map((i) => (i.id === localId && i.status === "UPLOADING" ? { ...i, progress: pct } : i)));
        };

        xhr.onload = () => {
          const ok = xhr.status >= 200 && xhr.status < 300;
          if (!ok) {
            reject(new Error(`Upload failed: ${xhr.status}`));
            return;
          }
          const etag = xhr.getResponseHeader("etag") || xhr.getResponseHeader("ETag") || undefined;
          resolve({ etag });
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.onabort = () => reject(new Error("aborted"));

        xhr.send(file);
      });
    },
    [],
  );

  const startUpload = useCallback(
  async (localId: string, file: File) => {
      setItems((prev) => prev.map((i) => (i.id === localId ? { ...i, status: "UPLOADING", progress: 1 } : i)));

      try {
        const init = await initOne(file);

        // Duplicate upload guard: reuse the existing upload record instead of failing
        if ((init as any).method === "DUPLICATE") {
          const businessId = requireBusinessId();
          const accountId = ctx?.accountId?.trim() || null;

          // Fetch recent uploads for this type and pick the matching id
          const qs = new URLSearchParams();
          qs.set("type", type);
          if (accountId) qs.set("accountId", accountId);
          qs.set("limit", "50");

          const listRes: any = await apiFetch(`/v1/businesses/${businessId}/uploads?${qs.toString()}`, { method: "GET" });
          const items = Array.isArray(listRes?.items) ? listRes.items : [];
          const hit = items.find((u: any) => String(u?.id) === String(init.id)) ?? null;

          setItems((prev) =>
            prev.map((i) =>
              i.id === localId
                ? {
                    ...i,
                    uploadId: String(init.id),
                    status: "COMPLETED",
                    progress: 100,
                    completedMeta: hit?.meta ?? null,
                    parsedStatus: hit?.meta?.parsed_status ?? null,
                    parsed: hit?.meta?.parsed ?? null,
                  }
                : i
            )
          );

          delete xhrs.current[localId];
          return;
        }

        setItems((prev) =>
          prev.map((i) =>
            i.id === localId
              ? { ...i, uploadId: init.id, bucket: init.bucket, key: init.key, progress: Math.max(i.progress, 2) }
              : i,
          ),
        );

        const putRes = await uploadPutWithProgress(localId, init.url as string, file, init.headers);

        setItems((prev) =>
  prev.map((i) =>
    i.id === localId ? { ...i, status: "UPLOADED", progress: 96, etag: putRes.etag } : i,
  ),
);

// Mark uploaded (so history shows UPLOADED even if complete fails later)
try {
  const businessId = requireBusinessId();
  await apiFetch(`/v1/businesses/${businessId}/uploads/mark-uploaded`, {
    method: "POST",
    body: JSON.stringify({ uploadId: init.id, etag: putRes.etag }),
  });
} catch {
  // Non-fatal; continue to complete
}

const completeRes: any = await completeOne(init.id);

        setItems((prev) =>
          prev.map((i) =>
            i.id === localId
              ? {
                  ...i,
                  status: "COMPLETED",
                  progress: 100,
                  completedMeta: completeRes?.upload?.meta ?? null,
                  parsedStatus: completeRes?.upload?.meta?.parsed_status ?? null,
                  parsed: completeRes?.upload?.meta?.parsed ?? null,
                }
              : i,
          ),
        );

        delete xhrs.current[localId];
      } catch (e: any) {
        const msg = e?.message || "Upload failed";
        setItems((prev) => prev.map((i) => (i.id === localId ? { ...i, status: "FAILED", error: msg } : i)));
        delete xhrs.current[localId];
      }
    },
    [completeOne, initOne, uploadPutWithProgress],
  );

  const enqueueAndStart = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const newItems: UploadItem[] = list.map((file) => ({
        id: id(),
        file,
        status: "QUEUED",
        progress: 0,
        createdAt: Date.now(),
      }));

      setItems((prev) => [...newItems, ...prev]);

      // Start async immediately (instant-fast)
      window.setTimeout(() => {
        newItems.forEach((i) => startUpload(i.id, i.file));
      }, 0);
    },
    [startUpload],
  );

  const cancel = useCallback((localId: string) => {
    const xhr = xhrs.current[localId];
    if (xhr) {
      try {
        xhr.abort();
      } catch {}
      delete xhrs.current[localId];
    }
    setItems((prev) => prev.map((i) => (i.id === localId ? { ...i, status: "CANCELED" } : i)));
  }, []);

  const remove = useCallback((localId: string) => {
    const xhr = xhrs.current[localId];
    if (xhr) {
      try {
        xhr.abort();
      } catch {}
      delete xhrs.current[localId];
    }
    setItems((prev) => prev.filter((i) => i.id !== localId));
  }, []);

  const clearAll = useCallback(() => {
    Object.values(xhrs.current).forEach((xhr) => {
      try {
        xhr.abort();
      } catch {}
    });
    xhrs.current = {};
    setItems([]);
  }, []);

  const retry = useCallback(
    (localId: string) => {
      setItems((prev) =>
        prev.map((i) => (i.id === localId ? { ...i, status: "QUEUED", progress: 0, error: undefined } : i)),
      );
      const found = items.find((i) => i.id === localId);
      if (!found) return;
      window.setTimeout(() => startUpload(localId, found.file), 0);
    },
    [startUpload, items],
  );

  return {
    type,
    items,
    hasActiveUploads,
    enqueueAndStart,
    cancel,
    remove,
    retry,
    clearAll,
  };
}
