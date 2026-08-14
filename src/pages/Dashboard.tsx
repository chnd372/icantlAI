import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { countWords, extractTitle, splitChapter } from "@/lib/chapter-split";
import { cn } from "@/lib/utils";

const MODELS = [
  { id: "gpt-4o-mini", label: "Fast", detail: "gpt-4o-mini" },
  { id: "gpt-4o", label: "Balanced", detail: "gpt-4o" },
  { id: "gpt-5", label: "Quality", detail: "gpt-5" },
] as const;

const MAX_FILE_SIZE = 250_000; // characters

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function baseName(fileName: string) {
  return fileName.replace(/\.(txt|md|text)$/i, "");
}

function modelLabel(model: string) {
  return model === "imported" ? "Imported" : model;
}

type Tab = "translate" | "catalog";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const convex = useConvex();

  const [tab, setTab] = useState<Tab>("translate");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [novelName, setNovelName] = useState("");
  const [localSource, setLocalSource] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<Id<"translations"> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<Id<"translations"> | null>(null);

  // Catalog search
  const [query, setQuery] = useState("");
  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importTitle, setImportTitle] = useState("");
  const [importNovel, setImportNovel] = useState("");
  const [importSource, setImportSource] = useState("");
  const [importText, setImportText] = useState("");

  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);

  const createTranslation = useMutation(api.translations.createTranslation);
  const startTranslation = useMutation(api.translations.startTranslation);
  const importChapter = useMutation(api.translations.importChapter);
  const translateSegmentAction = useAction(api.translateSegment.translateSegment);
  const deleteTranslation = useMutation(api.translations.deleteTranslation);

  const translations = useQuery(api.translations.listTranslations);
  const active = useQuery(
    api.translations.getTranslation,
    activeId ? { translationId: activeId } : "skip",
  );

  const displaySource = localSource ?? active?.translation.sourceText ?? null;
  const displayFileName = localFileName ?? active?.translation.fileName ?? null;

  const translatedText = useMemo(() => {
    if (!active) return "";
    return active.segments
      .filter((s) => s.status === "done" && s.translatedText)
      .map((s) => s.translatedText)
      .join("\n\n");
  }, [active]);

  const progress = active
    ? active.translation.segmentCount > 0
      ? active.translation.completedSegments / active.translation.segmentCount
      : 0
    : 0;

  const filtered = useMemo(() => {
    if (!translations) return [];
    const q = query.trim().toLowerCase();
    if (!q) return translations;
    return translations.filter(
      (t) =>
        (t.title ?? "").toLowerCase().includes(q) ||
        (t.novelName ?? "").toLowerCase().includes(q) ||
        t.fileName.toLowerCase().includes(q) ||
        t.sourcePreview.toLowerCase().includes(q) ||
        t.model.toLowerCase().includes(q),
    );
  }, [translations, query]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File is too large — keep chapters under 250 KB.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error("That file is empty.");
        return;
      }
      setLocalSource(text);
      setLocalFileName(file.name);
      setActiveId(null);
      setConfirmDeleteId(null);
    } catch {
      toast.error("Could not read that file. Try a .txt or .md export.");
    }
  }, []);

  const runSegments = useCallback(
    async (
      items: { segmentId: Id<"translationSegments">; sourceText: string }[],
      modelName: string,
    ) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      try {
        for (const item of items) {
          await translateSegmentAction({
            segmentId: item.segmentId,
            sourceText: item.sourceText,
            model: modelName,
          });
        }
        toast.success("Chapter translated and filed in your catalog.");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Translation interrupted: ${error.message}`
            : "Translation interrupted. You can resume from where it stopped.",
        );
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [translateSegmentAction],
  );

  const handleTranslate = async () => {
    if (!displaySource) {
      toast.error("Upload a chapter first.");
      return;
    }
    if (runningRef.current) return;

    const segments = splitChapter(displaySource);
    if (segments.length === 0) {
      toast.error("Nothing to translate — the chapter is empty.");
      return;
    }

    try {
      const id = await createTranslation({
        fileName: displayFileName ?? "chapter.txt",
        title: extractTitle(displaySource) ?? undefined,
        novelName: novelName.trim() || undefined,
        sourceText: displaySource,
        model,
        segments: segments.map((s) => ({ index: s.index, sourceText: s.sourceText })),
      });
      await startTranslation({ translationId: id });
      setActiveId(id);

      const full = await convex.query(api.translations.getTranslation, {
        translationId: id,
      });
      const items =
        full?.segments.map((s) => ({
          segmentId: s._id,
          sourceText: s.sourceText,
        })) ?? [];
      await runSegments(items, model);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the translation.",
      );
    }
  };

  const handleResume = async () => {
    if (!active || runningRef.current) return;
    const pending = active.segments.filter(
      (s) => s.status === "pending" || s.status === "error",
    );
    if (pending.length === 0) return;
    await startTranslation({ translationId: active.translation._id });
    await runSegments(
      pending.map((s) => ({ segmentId: s._id, sourceText: s.sourceText })),
      active.translation.model,
    );
  };

  const handleOpenInTranslator = async (id: Id<"translations">) => {
    if (runningRef.current) return;
    try {
      const full = await convex.query(api.translations.getTranslation, {
        translationId: id,
      });
      if (!full) return;
      setLocalSource(full.translation.sourceText);
      setLocalFileName(full.translation.fileName);
      setNovelName(full.translation.novelName ?? "");
      setActiveId(id);
      setTab("translate");
      setConfirmDeleteId(null);
    } catch {
      toast.error("Could not load that chapter.");
    }
  };

  const handleDelete = async (id: Id<"translations">) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      window.setTimeout(() => {
        setConfirmDeleteId((current) => (current === id ? null : current));
      }, 3000);
      return;
    }
    await deleteTranslation({ translationId: id });
    if (activeId === id) {
      setActiveId(null);
      setLocalSource(null);
      setLocalFileName(null);
    }
    setConfirmDeleteId(null);
    toast.success("Chapter removed from your catalog.");
  };

  const handleCopy = async () => {
    if (!translatedText) return;
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy — select the text manually.");
    }
  };

  const handleDownload = () => {
    if (!translatedText) return;
    const name = displayFileName ? baseName(displayFileName) : "chapter";
    const blob = new Blob([translatedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name} - Indonesian.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const title = importTitle.trim();
    const text = importText.trim();
    if (!title || !text) return;
    try {
      await importChapter({
        fileName: `${title}.txt`,
        title,
        novelName: importNovel.trim() || undefined,
        sourceText: importSource.trim() || undefined,
        translatedText: text,
        model: "imported",
      });
      setImportOpen(false);
      setImportTitle("");
      setImportNovel("");
      setImportSource("");
      setImportText("");
      toast.success("Added to your catalog.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the chapter.");
    }
  };

  const status = active?.translation.status ?? "idle";
  const canTranslate = !!displaySource && !running;
  const hasPending = active
    ? active.segments.some((s) => s.status === "pending" || s.status === "error")
    : false;

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg tracking-tight">
              Novel Translator App
            </span>
            <span className="hidden text-[11px] font-medium tracking-[0.22em] text-muted-foreground uppercase md:inline">
              Personal studio
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger
                size="sm"
                className="w-fit rounded-sm border-border/80 bg-transparent text-xs"
                aria-label="Translation model"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-sm">
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} · {m.detail}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {user?.name && (
              <span className="hidden text-xs text-muted-foreground lg:inline">
                {user.name}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-sm text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="mr-1.5 size-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Tabs */}
        <div className="flex items-center gap-6 border-b border-border/70">
          <button
            type="button"
            onClick={() => setTab("translate")}
            className={cn(
              "-mb-px border-b-2 px-1 pb-3 text-sm transition-colors",
              tab === "translate"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Translate
          </button>
          <button
            type="button"
            onClick={() => setTab("catalog")}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 text-sm transition-colors",
              tab === "catalog"
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Catalog
            {translations && translations.length > 0 && (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {translations.length}
              </span>
            )}
          </button>
        </div>

        {tab === "translate" ? (
          <div className="pt-6">
            {/* Source / Translation panels */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Source */}
              <section className="flex flex-col border border-border/70 bg-card">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                      Source
                    </span>
                    {displaySource && (
                      <span className="text-[11px] text-muted-foreground">
                        {countWords(displaySource).toLocaleString()} words
                      </span>
                    )}
                  </div>
                  {displayFileName && (
                    <span className="max-w-[40%] truncate text-[11px] text-muted-foreground">
                      {displayFileName}
                    </span>
                  )}
                </div>

                {displaySource ? (
                  <div className="flex flex-1 flex-col">
                    <div className="max-h-[52vh] flex-1 overflow-y-auto px-5 py-4">
                      <pre className="font-display text-[15px] leading-7 whitespace-pre-wrap">
                        {displaySource}
                      </pre>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/70 px-5 py-2.5">
                      <span className="text-[11px] text-muted-foreground">
                        {displaySource.length.toLocaleString()} characters
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                        disabled={running}
                        onClick={() => {
                          setLocalSource(null);
                          setLocalFileName(null);
                          setActiveId(null);
                          setNovelName("");
                        }}
                      >
                        <Upload className="mr-1.5 size-3.5" />
                        Replace
                      </Button>
                    </div>
                  </div>
                ) : (
                  <label
                    className={cn(
                      "flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 px-8 py-20 text-center transition-colors",
                      dragOver ? "bg-muted/70" : "hover:bg-muted/40",
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleFile(file);
                    }}
                  >
                    <input
                      type="file"
                      accept=".txt,.md,.text,text/plain,text/markdown"
                      className="hidden"
                      disabled={running}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex size-10 items-center justify-center rounded-sm border border-border/70 bg-background">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Drop a chapter file here</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        or click to browse · .txt or .md · under 250 KB
                      </p>
                    </div>
                  </label>
                )}
              </section>

              {/* Translation */}
              <section className="flex flex-col border border-border/70 bg-card">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                      Translation
                    </span>
                    {active && (
                      <span className="text-[11px] text-muted-foreground">
                        {modelLabel(active.translation.model)}
                      </span>
                    )}
                  </div>
                  {active && (
                    <span
                      className={cn(
                        "text-[11px] font-medium tracking-wide",
                        status === "done" && "text-foreground",
                        (status === "translating" || status === "draft") &&
                          "text-muted-foreground",
                        status === "error" && "text-destructive",
                      )}
                    >
                      {status === "translating" &&
                        `${active.translation.completedSegments} of ${active.translation.segmentCount} segments`}
                      {status === "done" && "Done"}
                      {status === "draft" && "Ready"}
                      {status === "error" && "Interrupted"}
                    </span>
                  )}
                </div>

                {!active ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-20 text-center">
                    <p className="text-sm font-medium">The translation will appear here</p>
                    <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                      Upload a chapter, then press{" "}
                      <span className="font-medium text-foreground">
                        Translate chapter
                      </span>
                      . It comes through segment by segment.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col">
                    {active.translation.error && (
                      <div className="mx-5 mt-4 border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive">
                        {active.translation.error}
                      </div>
                    )}

                    <div className="max-h-[52vh] flex-1 overflow-y-auto px-5 py-4">
                      {translatedText ? (
                        <div className="font-display text-[15px] leading-7 whitespace-pre-wrap">
                          {translatedText}
                          {status === "translating" && (
                            <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-foreground/70 align-middle" />
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3 pt-1">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div
                              key={i}
                              className="h-4 animate-pulse rounded-sm bg-muted"
                              style={{ width: `${88 - (i % 4) * 12}%` }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="border-t border-border/70">
                      <div className="h-[2px] w-full bg-muted">
                        <div
                          className="h-full bg-foreground transition-[width] duration-500"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs"
                          disabled={!translatedText}
                          onClick={handleCopy}
                        >
                          {copied ? (
                            <>
                              <Check className="mr-1.5 size-3.5" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="mr-1.5 size-3.5" /> Copy
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs"
                          disabled={!translatedText}
                          onClick={handleDownload}
                        >
                          <Download className="mr-1.5 size-3.5" /> Download .txt
                        </Button>
                        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
                          {countWords(translatedText).toLocaleString()} words · Indonesian
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Action bar */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Input
                value={novelName}
                onChange={(e) => setNovelName(e.target.value)}
                placeholder="Novel / series (optional)"
                className="w-full max-w-56 rounded-sm border-border/80 bg-card text-sm shadow-none"
                disabled={running}
              />
              <Button
                type="button"
                className="rounded-sm px-6 shadow-none hover:bg-foreground/90"
                disabled={!canTranslate}
                onClick={handleTranslate}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Translating…
                  </>
                ) : (
                  <>
                    Translate chapter
                    <ArrowRight className="ml-2 size-4" />
                  </>
                )}
              </Button>
              {hasPending && !running && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm border-border/80 bg-transparent shadow-none"
                  onClick={handleResume}
                >
                  <RefreshCw className="mr-2 size-3.5" />
                  Resume
                </Button>
              )}
              {!running && active && status === "done" && (
                <p className="text-xs text-muted-foreground">
                  Filed under{" "}
                  <span className="font-medium text-foreground">
                    {active.translation.novelName ?? active.translation.title ?? "Catalog"}
                  </span>
                  . Find it in the catalog tab.
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Catalog */
          <div className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-sm">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your catalog…"
                  className="rounded-sm border-border/80 bg-card pl-9 text-sm shadow-none"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm border-border/80 bg-transparent shadow-none"
                onClick={() => setImportOpen(true)}
              >
                <BookOpen className="mr-2 size-3.5" />
                Import a chapter
              </Button>
            </div>

            {translations && translations.length === 0 ? (
              <div className="mt-10 flex flex-col items-center gap-3 border-y border-border/70 py-16 text-center">
                <p className="text-sm font-medium">Your catalog is empty</p>
                <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                  Every chapter you translate is filed here automatically. You can also
                  import chapters you have already translated elsewhere.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  <Button
                    type="button"
                    className="rounded-sm px-5 shadow-none hover:bg-foreground/90"
                    onClick={() => setTab("translate")}
                  >
                    Translate a chapter
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm border-border/80 bg-transparent shadow-none"
                    onClick={() => setImportOpen(true)}
                  >
                    Import a chapter
                  </Button>
                </div>
              </div>
            ) : translations && filtered.length === 0 ? (
              <div className="mt-10 flex flex-col items-center gap-2 border-y border-border/70 py-16 text-center">
                <p className="text-sm font-medium">No chapters match</p>
                <p className="text-xs text-muted-foreground">
                  Nothing in your catalog matches “{query}”.
                </p>
              </div>
            ) : (
              <ul className="mt-6 divide-y divide-border/70 border-y border-border/70">
                {filtered.map((t) => (
                  <li key={t._id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-2 py-3 transition-colors hover:bg-muted/50",
                        activeId === t._id && "bg-muted/60",
                      )}
                      onClick={() => void handleOpenInTranslator(t._id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handleOpenInTranslator(t._id);
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {t.title ?? t.fileName}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[t.novelName, t.fileName, formatDate(t.createdAt)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "hidden text-[10px] font-medium tracking-[0.18em] uppercase sm:inline",
                            t.status === "done" && "text-foreground",
                            t.status === "translating" && "text-muted-foreground",
                            t.status === "error" && "text-destructive",
                            t.status === "draft" && "text-muted-foreground",
                          )}
                        >
                          {t.status === "done"
                            ? modelLabel(t.model)
                            : `${t.completedSegments}/${t.segmentCount}`}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label="Remove chapter"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(t._id);
                          }}
                        >
                          {confirmDeleteId === t._id ? (
                            <span className="text-[10px] font-medium">Sure?</span>
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="rounded-sm sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import a chapter</DialogTitle>
            <DialogDescription>
              Add a chapter you have already translated elsewhere — no translation run
              needed. It is filed straight into your catalog.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="import-title" className="text-xs">
                  Title
                </Label>
                <Input
                  id="import-title"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="Chapter 12 – The Quiet Storm"
                  className="rounded-sm border-border/80 text-sm shadow-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-novel" className="text-xs">
                  Novel / series <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="import-novel"
                  value={importNovel}
                  onChange={(e) => setImportNovel(e.target.value)}
                  placeholder="A Record of a Mortal's Journey"
                  className="rounded-sm border-border/80 text-sm shadow-none"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-text" className="text-xs">
                Translated text
              </Label>
              <Textarea
                id="import-text"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste the translated chapter here…"
                className="min-h-44 rounded-sm border-border/80 text-sm leading-6 shadow-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-source" className="text-xs">
                Original text <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="import-source"
                value={importSource}
                onChange={(e) => setImportSource(e.target.value)}
                placeholder="Paste the source chapter here if you want to keep it…"
                className="min-h-24 rounded-sm border-border/80 text-sm leading-6 shadow-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => setImportOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-sm px-5 shadow-none hover:bg-foreground/90"
              disabled={!importTitle.trim() || !importText.trim()}
              onClick={handleImport}
            >
              Add to catalog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
