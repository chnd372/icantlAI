import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  ImagePlus,
  Layers,
  Loader2,
  Settings2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OUTPUT_LANGUAGES,
  SOURCE_LANGUAGES,
  resolveLangCode,
} from "@/lib/languages";
import { cn } from "@/lib/utils";

interface ComicOverlay {
  x: number; // left / width
  y: number; // top / height
  w: number; // width / width
  h: number; // height / height
  text: string;
}

interface ComicPage {
  key: string;
  name: string;
  previewUrl: string; // object URL for display
  dataUrl: string; // compressed base64 sent to the server
  width: number; // compressed image width
  height: number; // compressed image height
  status: "ready" | "processing" | "done" | "error";
  ocrText?: string; // raw OCR, saved as soon as stage 1 finishes
  boxes?: ComicOverlay[]; // raw OCR boxes, reading order
  cleanedText?: string; // OCR output after the cleaning pass
  translatedText?: string;
  overlays?: ComicOverlay[]; // translated lines paired with their boxes
  error?: string;
}

interface ProviderOption {
  _id: Id<"aiProviders">;
  name: string;
  modelId: string | null;
  models: string[];
}

interface ComicTranslatorProps {
  providers: ProviderOption[] | undefined;
  selectedProviderId: Id<"aiProviders"> | "";
  onOpenProviders: () => void;
}

const MAX_PAGES = 150;

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/** Downscale a comic page to a JPEG data URL small enough for OCR uploads. */
async function compressImage(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const maxDim = 1600;
  const quality = 0.85;
  let bitmap: ImageBitmap | null = null;
  let width: number;
  let height: number;
  let source: CanvasImageSource;

  if ("createImageBitmap" in window) {
    bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not load image"));
        image.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not supported here.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", quality),
      width: w,
      height: h,
    };
  } finally {
    bitmap?.close();
  }
}

// --- Typeset overlay: draw the translated text back onto the page -----------

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // CJK-style text without spaces: wrap by characters instead.
  if (words.length === 1 && ctx.measureText(words[0]).width > maxWidth) {
    const chars = Array.from(words[0]);
    const lines: string[] = [];
    let current = "";
    for (const ch of chars) {
      const next = current + ch;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawTextInBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const pad = Math.max(2, w * 0.04);
  const maxW = Math.max(10, w - pad * 2);
  const maxH = Math.max(10, h - pad * 2);
  const font = () =>
    `${Math.round(fontSize)}px 'Segoe UI', system-ui, sans-serif`;

  let fontSize = Math.max(8, Math.min(h * 0.7, maxW * 0.6));
  ctx.font = font();
  let lines = wrapLines(ctx, text, maxW);
  let lineH = fontSize * 1.25;
  while (lines.length * lineH > maxH && fontSize > 8) {
    fontSize -= 1;
    ctx.font = font();
    lines = wrapLines(ctx, text, maxW);
    lineH = fontSize * 1.25;
  }

  const totalH = lines.length * lineH;
  let ty = y + (h - totalH) / 2 + fontSize;
  ctx.fillStyle = "#161616";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const line of lines) {
    ctx.fillText(line, x + w / 2, ty);
    ty += lineH;
  }
}

/** Render the page with the translated text typeset over each detected box. */
async function renderOverlayedImage(
  imageUrl: string,
  overlays: ComicOverlay[],
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the page image"));
    image.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not supported here.");
  ctx.drawImage(img, 0, 0);

  for (const o of overlays) {
    const x = o.x * canvas.width;
    const y = o.y * canvas.height;
    const w = o.w * canvas.width;
    const h = o.h * canvas.height;
    // Paper-white panel covers the original text (works best on manga's
    // white bubbles; a first version of "inpainting").
    ctx.fillStyle = "rgba(255, 255, 255, 0.93)";
    ctx.fillRect(x, y, w, h);
    drawTextInBox(ctx, o.text, x, y, w, h);
  }

  return canvas.toDataURL("image/png");
}

export function ComicTranslator({
  providers,
  selectedProviderId,
  onOpenProviders,
}: ComicTranslatorProps) {
  const ocrComicPage = useAction(api.comicTranslate.ocrComicPage);
  const translateComicPage = useAction(api.comicTranslate.translateComicPage);

  const [pages, setPages] = useState<ComicPage[]>([]);
  const [ocrMethod, setOcrMethod] = useState<"ocrspace" | "vision">("vision");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("id");
  const [seriesName, setSeriesName] = useState("");
  const [providerId, setProviderId] = useState<Id<"aiProviders"> | "">(
    selectedProviderId,
  );
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rendering, setRendering] = useState(false);
  const runningRef = useRef(false);
  const addingRef = useRef(false);
  const keyRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesCountRef = useRef(0);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  // Default to the provider chosen in the header, when one exists.
  useEffect(() => {
    if (
      !providerId &&
      selectedProviderId &&
      providers?.some((p) => p._id === selectedProviderId)
    ) {
      setProviderId(selectedProviderId);
    }
  }, [providers, selectedProviderId, providerId]);

  const chosenProvider = providers?.find((p) => p._id === providerId);

  const handleFiles = async (fileList: FileList | File[]) => {
    if (addingRef.current || runningRef.current) return;
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) {
      toast.error("Only image files (PNG, JPG, WebP…) can be OCR'd.");
      return;
    }
    if (pages.length + files.length > MAX_PAGES) {
      toast.error(`Keep batches under ${MAX_PAGES} pages at a time.`);
      return;
    }

    filesCountRef.current = files.length;
    addingRef.current = true;
    setAdding(true);
    const loaded: ComicPage[] = [];
    try {
      for (const file of files) {
        const previewUrl = URL.createObjectURL(file);
        try {
          const { dataUrl, width, height } = await compressImage(file);
          loaded.push({
            key: `c-${++keyRef.current}`,
            name: file.name,
            previewUrl,
            dataUrl,
            width,
            height,
            status: "ready",
          });
        } catch {
          URL.revokeObjectURL(previewUrl);
          toast.error(`Could not read ${file.name}.`);
        }
      }
      if (loaded.length > 0) {
        setPages((prev) => [...prev, ...loaded]);
        toast.success(
          `${loaded.length} page${loaded.length === 1 ? "" : "s"} added.`,
        );
      }
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const handleTranslate = async () => {
    if (runningRef.current) return;
    const targets = pages.filter(
      (p) => p.status === "ready" || p.status === "error",
    );
    if (targets.length === 0) {
      toast.error("Add comic pages first.");
      return;
    }
    if (!chosenProvider) {
      toast.error(
        "Pick an AI provider — the translation (and vision OCR) runs through it.",
      );
      return;
    }

    runningRef.current = true;
    setRunning(true);
    try {
      for (const page of targets) {
        setPages((prev) =>
          prev.map((p) =>
            p.key === page.key
              ? { ...p, status: "processing", error: undefined }
              : p,
          ),
        );
        try {
          // Stage 1 — OCR. Skipped when the raw text was already saved (a
          // retry after a translation failure re-runs only stage 2).
          let ocrText = page.ocrText;
          let boxes = page.boxes ?? [];
          if (!ocrText) {
            const ocr = await ocrComicPage({
              imageData: page.dataUrl,
              imageWidth: page.width,
              imageHeight: page.height,
              ocrMethod,
              sourceLang,
              providerId: providerId as Id<"aiProviders">,
            });
            ocrText = ocr.ocrText;
            boxes = ocr.boxes;
            // Save the raw OCR immediately so a later failure never loses it.
            setPages((prev) =>
              prev.map((p) =>
                p.key === page.key
                  ? { ...p, ocrText: ocr.ocrText, boxes: ocr.boxes }
                  : p,
              ),
            );
          }

          // Stage 2 — clean the OCR text, translate it, and pair the lines
          // with the raw OCR boxes (reading order) for typesetting.
          const result = await translateComicPage({
            ocrText,
            boxes,
            sourceLang,
            targetLang,
            providerId: providerId as Id<"aiProviders">,
          });
          setPages((prev) =>
            prev.map((p) =>
              p.key === page.key
                ? {
                    ...p,
                    status: "done",
                    cleanedText: result.cleanedText,
                    translatedText: result.translatedText,
                    overlays: result.overlays,
                  }
                : p,
            ),
          );
        } catch (error) {
          setPages((prev) =>
            prev.map((p) =>
              p.key === page.key
                ? {
                    ...p,
                    status: "error",
                    error:
                      error instanceof Error
                        ? error.message
                        : "This page failed.",
                  }
                : p,
            ),
          );
        }
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const copyText = async (text: string, message: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Could not copy — select the text manually.");
    }
  };

  const downloadText = (text: string, fileName: string) => {
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const pageFileBase = (name: string) =>
    `${baseName(name)} - ${resolveLangCode(targetLang).toUpperCase()}`;

  const donePages = pages.filter(
    (p) => p.status === "done" && p.translatedText,
  );

  const handleCopyAll = () => {
    if (donePages.length === 0) return;
    const combined = donePages
      .map((p) => `${p.name}\n\n${p.translatedText}`)
      .join("\n\n---\n\n");
    void copyText(
      combined,
      `${donePages.length} page${donePages.length === 1 ? "" : "s"} copied.`,
    );
  };

  const handleDownloadAll = () => {
    if (donePages.length === 0) return;
    const combined = donePages
      .map((p) => `--- ${p.name} ---\n\n${p.translatedText}`)
      .join("\n\n");
    const label = seriesName.trim() || "comic";
    downloadText(
      combined,
      `${label} - ${resolveLangCode(targetLang).toUpperCase()}.txt`,
    );
  };

  /** Render one page with the translated text typeset onto it (PNG). */
  const handleDownloadPng = async (p: ComicPage) => {
    if (!p.overlays || p.overlays.length === 0) return;
    try {
      // Use the original uploaded file (previewUrl) so the PNG keeps full
      // resolution — the boxes are normalized 0..1 so they still align.
      const png = await renderOverlayedImage(p.previewUrl, p.overlays);
      const blob = await (await fetch(png)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${pageFileBase(p.name)}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not render the image.",
      );
    }
  };

  const handleDownloadAllPng = async () => {
    const targets = donePages.filter(
      (p) => p.overlays && p.overlays.length > 0,
    );
    if (targets.length === 0) return;
    setRendering(true);
    try {
      for (const p of targets) {
        await handleDownloadPng(p);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      toast.success(
        `Downloading ${targets.length} page${targets.length === 1 ? "" : "s"} with text…`,
      );
    } finally {
      setRendering(false);
    }
  };

  const handleRemovePage = (key: string) => {
    if (runningRef.current) return;
    setPages((prev) => {
      const page = prev.find((p) => p.key === key);
      if (page) URL.revokeObjectURL(page.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  };

  const handleClear = () => {
    if (runningRef.current) return;
    setPages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  };

  const processingCount = pages.filter((p) => p.status === "processing").length;
  const hasWork = pages.some(
    (p) => p.status === "ready" || p.status === "error",
  );

  return (
    <div className="pt-6">
      {/* Pages */}
      <section className="flex flex-col border border-black/[0.06] bg-card shadow-sm transition-shadow hover:shadow-md dark:border-white/10">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
              Comic pages
            </span>
            {pages.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {pages.length} page{pages.length === 1 ? "" : "s"}
              </span>
            )}
            {adding && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Processing images…
              </span>
            )}
          </div>
          {pages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={running || adding}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 size-3.5" />
              Add pages
            </Button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {pages.length === 0 ? (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 px-8 py-14 text-center transition-colors",
              dragOver ? "bg-muted/70" : "hover:bg-muted/40",
            )}
            onClick={(e) => {
              e.preventDefault();
              if (!running && !adding) fileInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!running && !adding) void handleFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex size-10 items-center justify-center rounded-sm border border-border/70 bg-background">
              <ImagePlus className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Drop comic pages here</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {adding
                  ? `Processing ${filesCountRef.current} images…`
                  : `or click to browse · PNG, JPG, WebP · up to ${MAX_PAGES} pages per batch`}
              </p>
            </div>
          </label>
        ) : (
          <ul className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((p) => (
              <li
                key={p.key}
                className="flex flex-col border border-black/[0.06] bg-card shadow-sm dark:border-white/10"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
                  <span className="min-w-0 truncate text-xs font-medium">
                    {p.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.status === "processing" && (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        "text-[10px] font-medium tracking-[0.18em] uppercase",
                        p.status === "done" && "text-foreground",
                        p.status === "error" && "text-destructive",
                        (p.status === "ready" || p.status === "processing") &&
                          "text-muted-foreground",
                      )}
                    >
                      {p.status === "processing"
                        ? "Reading"
                        : p.status === "ready"
                          ? "Ready"
                          : p.status}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${p.name}`}
                      disabled={running}
                      onClick={() => handleRemovePage(p.key)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[120px_1fr]">
                  <img
                    src={p.previewUrl}
                    alt={p.name}
                    loading="lazy"
                    className="h-40 w-full rounded-sm border border-border/70 object-cover sm:h-full sm:max-h-48"
                  />
                  <div className="flex min-w-0 flex-col gap-2">
                    {p.status === "error" && p.error && (
                      <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] leading-4 text-destructive">
                        {p.error}
                      </div>
                    )}
                    {p.ocrText && p.status !== "processing" && (
                      <details className="rounded-sm border border-border/70">
                        <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase select-none hover:text-foreground">
                          OCR text
                        </summary>
                        <pre className="max-h-28 overflow-y-auto border-t border-border/70 px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
                          {p.ocrText}
                        </pre>
                      </details>
                    )}
                    {p.cleanedText && p.status !== "processing" && (
                      <details className="rounded-sm border border-border/70">
                        <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase select-none hover:text-foreground">
                          Cleaned text
                        </summary>
                        <pre className="max-h-28 overflow-y-auto border-t border-border/70 px-2.5 py-2 text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground">
                          {p.cleanedText}
                        </pre>
                      </details>
                    )}
                    {p.status === "done" && p.translatedText ? (
                      <pre className="font-display flex-1 rounded-sm bg-muted/50 px-3 py-2.5 text-[13px] leading-6 whitespace-pre-wrap">
                        {p.translatedText}
                      </pre>
                    ) : p.status === "done" ? (
                      <p className="text-[11px] text-muted-foreground">
                        No translated text for this page.
                      </p>
                    ) : p.status === "processing" ? (
                      <p className="text-[11px] text-muted-foreground">
                        Extracting text and translating…
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Ready to translate.
                      </p>
                    )}
                    {p.status === "done" && p.translatedText && (
                      <div className="mt-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            void copyText(p.translatedText ?? "", "Page copied.")
                          }
                        >
                          <Copy className="mr-1.5 size-3" />
                          Copy
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-sm border-border/80 bg-transparent px-2 text-xs shadow-none"
                          onClick={() =>
                            downloadText(
                              p.translatedText ?? "",
                              `${pageFileBase(p.name)}.txt`,
                            )
                          }
                        >
                          <Download className="mr-1.5 size-3" />
                          .txt
                        </Button>
                        {p.overlays && p.overlays.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-sm border-border/80 bg-transparent px-2 text-xs shadow-none"
                            disabled={rendering}
                            onClick={() => void handleDownloadPng(p)}
                          >
                            <Layers className="mr-1.5 size-3" />
                            PNG + text
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Settings + actions */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-3">
        <div className="flex flex-col gap-1.5 sm:w-auto">
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Series
          </span>
          <Input
            value={seriesName}
            onChange={(e) => setSeriesName(e.target.value)}
            placeholder="Novel / series (optional)"
            className="w-full rounded-sm border-border/80 bg-card text-sm shadow-none sm:max-w-48"
            disabled={running}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:w-auto">
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            OCR engine
          </span>
          <Select
            value={ocrMethod}
            onValueChange={(v) => setOcrMethod(v as "ocrspace" | "vision")}
          >
            <SelectTrigger
              size="sm"
              className="w-full rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-sm">
              <SelectItem value="vision">Vision LLM (AI provider)</SelectItem>
              <SelectItem value="ocrspace">OCR.space API</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 sm:w-auto">
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            AI provider
          </span>
          <div className="flex items-center gap-2">
            <Select
              value={providerId || undefined}
              onValueChange={(v) => setProviderId(v as Id<"aiProviders">)}
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0 rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-44"
              >
                <SelectValue placeholder="No provider" />
              </SelectTrigger>
              <SelectContent className="rounded-sm">
                {providers && providers.length > 0 ? (
                  providers.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                      {p.modelId ? ` · ${p.modelId}` : " · any model"}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    No providers yet — add one with the gear icon.
                  </div>
                )}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Manage AI providers"
              onClick={onOpenProviders}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
          {!providers || providers.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              Translations run through your own provider — add one with the
              gear icon.
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 sm:w-auto">
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Source language
          </span>
          <Select value={sourceLang} onValueChange={setSourceLang}>
            <SelectTrigger
              size="sm"
              className="w-full rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-sm">
              {SOURCE_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 sm:w-auto">
          <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Output language
          </span>
          <Select value={targetLang} onValueChange={setTargetLang}>
            <SelectTrigger
              size="sm"
              className="w-full rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72 rounded-sm">
              {OUTPUT_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 sm:ml-auto sm:flex-row sm:items-center">
          <Button
            type="button"
            className="w-full justify-center rounded-sm px-6 shadow-none hover:bg-foreground/90 sm:w-auto"
            disabled={running || adding || !hasWork || !chosenProvider}
            onClick={() => void handleTranslate()}
          >
            {running ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Translating {processingCount} of {pages.length}…
              </>
            ) : (
              <>
                Translate pages
                <ArrowRight className="ml-2 size-4" />
              </>
            )}
          </Button>
        </div>

        {ocrMethod === "ocrspace" && (
          <p className="text-[11px] leading-5 text-muted-foreground sm:w-full">
            OCR.space free tier handles up to 1 MB per image and 25,000
            requests/month — pages are downscaled automatically. Add your free
            key as{" "}
            <span className="font-medium text-foreground">
              OCR_SPACE_API_KEY
            </span>{" "}
            in the Keys tab; without it, this engine stays disabled.
          </p>
        )}
      </div>

      {/* Batch actions */}
      {donePages.length > 0 && !running && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
          <span className="text-xs text-muted-foreground">
            {donePages.length} page{donePages.length === 1 ? "" : "s"} ready
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-sm px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void handleCopyAll()}
            >
              <Check className="mr-1.5 size-3.5" />
              Copy all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-sm border-border/80 bg-transparent px-3 text-xs shadow-none"
              onClick={handleDownloadAll}
            >
              <Download className="mr-1.5 size-3.5" />
              Download all .txt
            </Button>
            {donePages.some(
              (p) => p.overlays && p.overlays.length > 0,
            ) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-sm border-border/80 bg-transparent px-3 text-xs shadow-none"
                disabled={rendering}
                onClick={() => void handleDownloadAllPng()}
              >
                {rendering ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Layers className="mr-1.5 size-3.5" />
                )}
                Download all PNG
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-sm px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            >
              Clear pages
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
