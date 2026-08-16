import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Check, KeyRound, Loader2 } from "lucide-react";

import { ProvidersPanel } from "@/components/ProvidersDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";

/**
 * The Settings tab — every configuration in one place: custom AI providers
 * and the OCR.space key used by the comic translator.
 */
export function SettingsTab() {
  const status = useQuery(api.settings.getOcrSpaceKeyStatus);
  const saveOcrKey = useMutation(api.settings.saveOcrSpaceApiKey);

  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveOcrKey = async () => {
    if (saving) return;
    const key = apiKey.trim();
    if (!key && !status?.hasKey) return;
    setSaving(true);
    try {
      await saveOcrKey({ apiKey: key });
      setApiKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      toast.success(
        key ? "OCR.space key saved — the comic translator can use it now." : "OCR.space key removed.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the key.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-6">
      {/* AI providers */}
      <section className="border border-black/[0.06] bg-card p-5 shadow-sm transition-shadow hover:shadow-md dark:border-white/10 sm:p-6">
        <ProvidersPanel />
      </section>

      {/* OCR.space key */}
      <section className="mt-6 border border-black/[0.06] bg-card p-5 shadow-sm transition-shadow hover:shadow-md dark:border-white/10 sm:p-6">
        <div className="border-b border-border/70 pb-4">
          <h2 className="text-sm font-medium">OCR.space</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            Extract text from comic/manhwa pages with the OCR.space API (free
            tier: up to 1 MB per image and 25,000 requests/month — pages are
            downscaled automatically). Get a free key at{" "}
            <a
              href="https://ocr.space/ocrapi"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              ocr.space/ocrapi
            </a>{" "}
            and paste it below. It is stored privately with your account and
            only sent to the OCR.space API.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setSaved(false);
            }}
            placeholder={
              status?.hasKey
                ? `Stored — key ends in …${status.keySuffix}. Type a new key to replace it.`
                : "Paste your OCR.space API key…"
            }
            className="max-w-md rounded-sm border-border/80 font-mono text-xs shadow-none"
            autoComplete="off"
          />
          <Button
            type="button"
            className="rounded-sm px-5 shadow-none hover:bg-foreground/90 sm:w-auto"
            disabled={
              saving || (!apiKey.trim() && !status?.hasKey)
            }
            onClick={() => void handleSaveOcrKey()}
          >
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : saved ? (
              <Check className="mr-2 size-4" />
            ) : (
              <KeyRound className="mr-2 size-4" />
            )}
            {saving
              ? "Saving…"
              : saved
                ? "Saved"
                : apiKey.trim()
                  ? "Save key"
                  : status?.hasKey
                    ? "Remove key"
                    : "Save key"}
          </Button>
        </div>

        {status?.hasKey && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            A key is already stored (ends in …{status.keySuffix}). Leave the
            field empty and press the button to remove it.
          </p>
        )}
      </section>
    </div>
  );
}
