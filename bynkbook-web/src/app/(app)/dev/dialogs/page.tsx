"use client";

import { useMemo, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { AppSidePanel } from "@/components/primitives/AppSidePanel";
import { Button } from "@/components/ui/button";
import { UploadPanel } from "@/components/uploads/UploadPanel";

function LongContent() {
  const lines = useMemo(() => {
    return Array.from({ length: 80 }).map((_, i) => ({
      id: i + 1,
      text:
        i % 7 === 0
          ? "This is a long line to validate scrolling behavior. Header and footer should remain fixed."
          : "Lorem ipsum content for scroll validation.",
    }));
  }, []);

  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-700">
        Scroll this body area. The header and footer must remain visible.
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="text-xs text-slate-600 space-y-1">
          {lines.map((l) => (
            <div key={l.id}>
              <span className="text-slate-500">{String(l.id).padStart(2, "0")}.</span> {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DevDialogsPage() {
  const [openDialog, setOpenDialog] = useState(false);
  const [openPanel, setOpenPanel] = useState(false);
  const [disableOverlayClose, setDisableOverlayClose] = useState(false);
  const [openUpload, setOpenUpload] = useState(false);
  const [uploadType, setUploadType] = useState<"RECEIPT" | "INVOICE" | "BANK_STATEMENT">("RECEIPT");


  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <div className="text-lg font-semibold text-slate-900">Dev: Dialogs</div>
        <div className="text-sm text-slate-600">
          Validate AppDialog / AppSidePanel: fixed header/footer, body-only scroll, ESC close, overlay close rules.
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button type="button" onClick={() => setOpenDialog(true)}>
          Open Dialog
        </Button>

        <Button type="button" variant="outline" onClick={() => setOpenPanel(true)}>
          Open Side Panel
        </Button>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" onClick={() => { setUploadType("RECEIPT"); setOpenUpload(true); }}>
                Open Upload Receipt
            </Button>
            <Button type="button" variant="outline" onClick={() => { setUploadType("INVOICE"); setOpenUpload(true); }}>
                Open Upload Invoice
            </Button>
            <Button type="button" variant="outline" onClick={() => { setUploadType("BANK_STATEMENT"); setOpenUpload(true); }}>
                 Open Upload Bank Statement
            </Button>
        </div>


        <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={disableOverlayClose}
            onChange={(e) => setDisableOverlayClose(e.target.checked)}
          />
          disableOverlayClose
        </label>
      </div>

      <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">Expected behavior</div>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 space-y-1">
          <li>Press ESC: closes only when onClose exists (it does here).</li>
          <li>Click overlay: closes unless disableOverlayClose is checked.</li>
          <li>Header and footer stay visible; only the body scrolls.</li>
        </ul>
      </div>

      <AppDialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title="Test Dialog"
        size="lg"
        disableOverlayClose={disableOverlayClose}
        footer={
          <div className="flex items-center justify-end">
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)}>
              Close
            </Button>
          </div>
        }
      >
        <LongContent />
      </AppDialog>

      <AppSidePanel
        open={openPanel}
        onClose={() => setOpenPanel(false)}
        title="Test Side Panel"
        size="md"
        disableOverlayClose={disableOverlayClose}
        footer={
          <div className="flex items-center justify-end">
            <Button type="button" variant="outline" onClick={() => setOpenPanel(false)}>
              Close
            </Button>
          </div>
        }
      >
        <LongContent />
      </AppSidePanel>

      <UploadPanel
  open={openUpload}
  onClose={() => setOpenUpload(false)}
  type={uploadType}
/>
    </div>
  );
}
