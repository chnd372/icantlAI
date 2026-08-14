import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Files,
  Loader2,
  LogOut,
  PenLine,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { ProvidersDialog } from "@/components/ProvidersDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { countWords, extractTitle, splitChapter } from "@/lib/chapter-split";
import {
  OUTPUT_LANGUAGES,
  SOURCE_LANGUAGES,
  languageName,
  resolveLangCode,
} from "@/lib/languages";
import { cn } from "@/lib/utils";

interface QueueItem {
  key: string;
  fileName: string;
  sourceText: string;
  wordCount: number;
  translationId?: Id<"translations">;
  status: "waiting" | "translating" | "done" | "error";
  error?: string;
}

const MAX_FILE_SIZE = 250_000; // characters

function langPair(sourceLang: string, targetLang: string) {
  return `${resolveLangCode(sourceLang).toUpperCase()} → ${resolveLangCode(
    targetLang,
  ).toUpperCase()}`;
}

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

/** A sensible file name for a chapter pasted directly as text. */
function sourceFileName(text: string): string {
  const base = (extractTitle(text) ?? "chapter")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .slice(0, 60);
  return `${base || "chapter"}.txt`;
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
  const [selectedProviderId, setSelectedProviderId] = useState<Id<"aiProviders"> | "">("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("id");
  const [providersOpen, setProvidersOpen] = useState(false);
  const [novelName, setNovelName] = useState("");
  const [localSource, setLocalSource] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<Id<"translations"> | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sourceInputMode, setSourceInputMode] = useState<"upload" | "paste">("upload");
  const [pasteText, setPasteText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<Id<"translations"> | null>(null);

  // Catalog result viewer
  const [viewerId, setViewerId] = useState<Id<"translations"> | null>(null);
  const [viewerCopied, setViewerCopied] = useState(false);

  // Translation instructions (custom prompt), saved to the account. Long
  // saved prompts collapse to a few preview lines; expand to edit them.
  const [customPrompt, setCustomPrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const promptSynced = useRef(false);

  // Batch queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueKeyRef = useRef(0);
  const processingRef = useRef(false);
  const [processing, setProcessing] = useState(false);

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
  const saveCustomPrompt = useMutation(api.settings.saveCustomPrompt);
  const translateSegmentAction = useAction(api.translateSegment.translateSegment);
  const deleteTranslation = useMutation(api.translations.deleteTranslation);

  const translations = useQuery(api.translations.listTranslations);
  const providers = useQuery(api.providers.listProviders);
  const active = useQuery(
    api.translations.getTranslation,
    activeId ? { translationId: activeId } : "skip",
  );
  const viewer = useQuery(
    api.translations.getTranslation,
    viewerId ? { translationId: viewerId } : "skip",
  );

  useEffect(() => {
    if (!promptSynced.current && user) {
      setCustomPrompt(user.customPrompt ?? "");
      promptSynced.current = true;
    }
  }, [user]);

  // Auto-select the first provider so the studio is ready to translate.
  useEffect(() => {
    if (providers && providers.length > 0 && !selectedProviderId) {
      setSelectedProviderId(providers[0]._id);
    }
  }, [providers, selectedProviderId]);

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

  const viewerText = useMemo(() => {
    if (!viewer) return "";
    return viewer.segments
      .filter((s) => s.status === "done" && s.translatedText)
      .map((s) => s.translatedText)
      .join("\n\n");
  }, [viewer]);

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

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const accepted: { file: File; text: string }[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is too large — keep chapters under 250 KB.`);
        continue;
      }
      try {
        const text = await file.text();
        if (text.trim()) {
          accepted.push({ file, text });
        } else {
          toast.error(`${file.name} is empty.`);
        }
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }

    if (accepted.length === 0) return;

    // A single file keeps the current one-chapter flow.
    if (accepted.length === 1) {
      const { file, text } = accepted[0];
      setLocalSource(text);
      setLocalFileName(file.name);
      setActiveId(null);
      setConfirmDeleteId(null);
      return;
    }

    // Multiple files go into the batch queue.
    const items: QueueItem[] = accepted.map(({ file, text }) => ({
      key: `q-${++queueKeyRef.current}`,
      fileName: file.name,
      sourceText: text,
      wordCount: countWords(text),
      status: "waiting",
    }));
    setQueue((q) => [...q, ...items]);
    toast.success(`${items.length} chapters added to the queue.`);
  }, []);

  const handleUsePasted = () => {
    const text = pasteText.trim();
    if (!text) return;
    if (text.length > MAX_FILE_SIZE) {
      toast.error("That text is too long — keep chapters under 250 KB.");
      return;
    }
    setLocalSource(text);
    setLocalFileName(sourceFileName(text));
    setActiveId(null);
    setConfirmDeleteId(null);
    setPasteText("");
    toast.success("Text loaded as the source chapter.");
  };

  /** Translate every segment of one chapter. Returns false on failure. */
  const runSegments = useCallback(
    async (
      items: { segmentId: Id<"translationSegments">; sourceText: string }[],
      options: {
        sourceLang: string;
        targetLang: string;
        providerId: Id<"aiProviders">;
        model: string;
      },
    ): Promise<boolean> => {
      if (runningRef.current) return false;
      runningRef.current = true;
      setRunning(true);
      try {
        for (const item of items) {
          await translateSegmentAction({
            segmentId: item.segmentId,
            sourceText: item.sourceText,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang,
            providerId: options.providerId,
          });
        }
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Translation interrupted: ${error.message}`
            : "Translation interrupted. You can resume from where it stopped.",
        );
        return false;
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
    if (runningRef.current || processingRef.current) return;

    const segments = splitChapter(displaySource);
    if (segments.length === 0) {
      toast.error("Nothing to translate — the chapter is empty.");
      return;
    }

    const chosenProvider = providers?.find((p) => p._id === selectedProviderId);
    if (!chosenProvider) {
      toast.error(
        "Add an AI provider first — open the gear icon next to the provider selector.",
      );
      return;
    }
    const options = {
      sourceLang,
      targetLang,
      providerId: selectedProviderId as Id<"aiProviders">,
      // No fixed Model ID? Fall back to the provider name so the catalog
      // still shows what produced the chapter.
      model: chosenProvider.modelId ?? chosenProvider.name,
    };

    try {
      const id = await createTranslation({
        fileName: displayFileName ?? sourceFileName(displaySource),
        title: extractTitle(displaySource) ?? undefined,
        novelName: novelName.trim() || undefined,
        sourceText: displaySource,
        model: options.model,
        providerId: options.providerId,
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
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
      const ok = await runSegments(items, options);
      if (ok) toast.success("Chapter translated and filed in your catalog.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the translation.",
      );
    }
  };

  const handleResume = async () => {
    if (!active || runningRef.current || processingRef.current) return;
    if (!active.translation.providerId) {
      toast.error(
        "This chapter predates custom providers — re-run it with a provider selected.",
      );
      return;
    }
    const pending = active.segments.filter(
      (s) => s.status === "pending" || s.status === "error",
    );
    if (pending.length === 0) return;
    await startTranslation({ translationId: active.translation._id });
    await runSegments(
      pending.map((s) => ({ segmentId: s._id, sourceText: s.sourceText })),
      {
        sourceLang: active.translation.sourceLang,
        targetLang: active.translation.targetLang,
        providerId: active.translation.providerId,
        model: active.translation.model,
      },
    );
  };

  /** Create (or resume) one queued chapter and translate its segments. */
  const translateQueueItem = useCallback(
    async (item: QueueItem): Promise<boolean> => {
      const segments = splitChapter(item.sourceText);
      if (segments.length === 0) return false;

      const chosenProvider = providers?.find((p) => p._id === selectedProviderId);
      if (!chosenProvider) {
        toast.error(
          "Add an AI provider first — open the gear icon next to the provider selector.",
        );
        return false;
      }
      const options = {
        sourceLang,
        targetLang,
        providerId: selectedProviderId as Id<"aiProviders">,
        model: chosenProvider.modelId ?? chosenProvider.name,
      };

      try {
        let id = item.translationId;
        if (!id) {
          id = await createTranslation({
            fileName: item.fileName,
            title: extractTitle(item.sourceText) ?? undefined,
            novelName: novelName.trim() || undefined,
            sourceText: item.sourceText,
            model: options.model,
            providerId: options.providerId,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang,
            segments: segments.map((s) => ({
              index: s.index,
              sourceText: s.sourceText,
            })),
          });
          setQueue((q) =>
            q.map((i) => (i.key === item.key ? { ...i, translationId: id } : i)),
          );
          await startTranslation({ translationId: id });
        }

        const full = await convex.query(api.translations.getTranslation, {
          translationId: id,
        });
        const pending =
          full?.segments.filter(
            (s) => s.status === "pending" || s.status === "error",
          ) ?? [];
        return await runSegments(
          pending.map((s) => ({ segmentId: s._id, sourceText: s.sourceText })),
          options,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not translate this chapter.",
        );
        return false;
      }
    },
    [
      convex,
      createTranslation,
      startTranslation,
      runSegments,
      providers,
      selectedProviderId,
      sourceLang,
      targetLang,
      novelName,
    ],
  );

  const handleTranslateAll = async () => {
    if (processingRef.current || runningRef.current) return;
    const targets = queue.filter(
      (i) => i.status === "waiting" || i.status === "error",
    );
    if (targets.length === 0) return;

    processingRef.current = true;
    setProcessing(true);
    let doneCount = 0;
    let failed = false;
    try {
      for (const item of targets) {
        setQueue((q) =>
          q.map((i) =>
            i.key === item.key ? { ...i, status: "translating", error: undefined } : i,
          ),
        );
        const ok = await translateQueueItem(item);
        setQueue((q) =>
          q.map((i) => (i.key === item.key ? { ...i, status: ok ? "done" : "error" } : i)),
        );
        if (ok) {
          doneCount += 1;
        } else {
          failed = true;
          break;
        }
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }

    if (failed) {
      toast.error("Batch stopped on a failed chapter — fix it and translate again.");
    } else if (doneCount > 0) {
      toast.success(
        `${doneCount} chapter${doneCount === 1 ? "" : "s"} translated and filed in your catalog.`,
      );
    }
  };

  const handleTranslateItem = async (item: QueueItem) => {
    if (processingRef.current || runningRef.current || item.status === "done") return;
    processingRef.current = true;
    setProcessing(true);
    setQueue((q) =>
      q.map((i) =>
        i.key === item.key ? { ...i, status: "translating", error: undefined } : i,
      ),
    );
    const ok = await translateQueueItem(item);
    setQueue((q) =>
      q.map((i) => (i.key === item.key ? { ...i, status: ok ? "done" : "error" } : i)),
    );
    processingRef.current = false;
    setProcessing(false);
    if (ok) toast.success(`${item.fileName} translated and filed in your catalog.`);
  };

  const handleRemoveQueueItem = (key: string) => {
    if (processingRef.current) return;
    setQueue((q) => q.filter((i) => i.key !== key));
  };

  const handleClearQueue = () => {
    if (processingRef.current) return;
    setQueue((q) =>
      q.filter((i) => i.status === "waiting" || i.status === "translating"),
    );
  };

  const handleSavePrompt = async () => {
    if (savingPrompt) return;
    setSavingPrompt(true);
    try {
      await saveCustomPrompt({ customPrompt });
      setPromptSaved(true);
      setPromptExpanded(false);
      toast.success("Translation instructions saved — they apply to new runs.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the instructions.",
      );
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleOpenInTranslator = async (id: Id<"translations">) => {
    if (runningRef.current || processingRef.current) return;
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

  const copyToClipboard = async (
    text: string,
    setCopiedFlag: (value: boolean) => void,
  ) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFlag(true);
      window.setTimeout(() => setCopiedFlag(false), 1800);
    } catch {
      toast.error("Could not copy — select the text manually.");
    }
  };

  const downloadText = (text: string, fileName: string, targetLang: string) => {
    if (!text) return;
    const name = baseName(fileName);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name} - ${resolveLangCode(targetLang).toUpperCase()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenViewer = (id: Id<"translations">) => {
    if (runningRef.current || processingRef.current) return;
    setViewerId(id);
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
        sourceLang: "en",
        targetLang: "id",
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
  const canTranslate = !!displaySource && !running && !processing;
  const hasPending = active
    ? active.segments.some((s) => s.status === "pending" || s.status === "error")
    : false;
  const queueBusy = processing || running;
  const hasQueueWork = queue.some(
    (i) => i.status === "waiting" || i.status === "error",
  );

  return (
    <main className="page-surface min-h-screen text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/70 backdrop-blur-md dark:border-white/10 dark:bg-black/40">
        <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6">
          {/* Row 1: brand + quick actions */}
          <div className="flex h-14 items-center justify-between gap-3 sm:h-16">
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-display truncate text-lg tracking-tight">
                Ican Translator AI
              </span>
              <span className="hidden text-[11px] font-medium tracking-[0.22em] text-muted-foreground uppercase md:inline">
                Personal studio
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              {/* Provider controls (desktop) */}
              <div className="hidden items-center gap-2 lg:flex">
                <Select
                  value={selectedProviderId || undefined}
                  onValueChange={(v) =>
                    setSelectedProviderId(v as Id<"aiProviders">)
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-fit max-w-56 rounded-sm border-border/80 bg-transparent text-xs"
                    aria-label="AI provider"
                  >
                    <SelectValue placeholder="No provider" />
                  </SelectTrigger>
                  <SelectContent className="rounded-sm">
                    {providers && providers.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Your providers</SelectLabel>
                        {providers.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {p.name}
                            {p.modelId ? ` · ${p.modelId}` : " · any model"}
                          </SelectItem>
                        ))}
                      </SelectGroup>
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
                  className="size-8 rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label="Manage AI providers"
                  onClick={() => setProvidersOpen(true)}
                >
                  <Settings2 className="size-4" />
                </Button>

                {user?.name && (
                  <span className="text-xs text-muted-foreground">
                    {user.name}
                  </span>
                )}
              </div>

              <ThemeToggle />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground sm:px-3"
                onClick={handleSignOut}
              >
                <LogOut className="mr-1.5 size-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>

          {/* Row 2: provider controls (mobile) */}
          <div className="flex items-center gap-2 pb-3 lg:hidden">
            <Select
              value={selectedProviderId || undefined}
              onValueChange={(v) =>
                setSelectedProviderId(v as Id<"aiProviders">)
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0 flex-1 rounded-sm border-border/80 bg-transparent text-xs"
                aria-label="AI provider"
              >
                <SelectValue placeholder="No provider" />
              </SelectTrigger>
              <SelectContent className="rounded-sm">
                {providers && providers.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Your providers</SelectLabel>
                    {providers.map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                        {p.modelId ? ` · ${p.modelId}` : " · any model"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
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
              onClick={() => setProvidersOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>

            {user?.name && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {user.name}
              </span>
            )}
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
              <section className="flex flex-col border border-black/[0.06] bg-card shadow-sm transition-shadow hover:shadow-md dark:border-white/10">
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
                        disabled={queueBusy}
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
                ) : sourceInputMode === "paste" ? (
                  <div className="flex flex-1 flex-col">
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste the raw chapter text here…"
                      className="m-5 flex-1 min-h-44 rounded-sm border-border/80 text-sm leading-6 shadow-none"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-2.5">
                      <span className="text-[11px] text-muted-foreground">
                        {pasteText.trim()
                          ? `${countWords(pasteText).toLocaleString()} words`
                          : "Paste the chapter, then use it as the source."}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={queueBusy}
                          onClick={() => setSourceInputMode("upload")}
                        >
                          Back to file
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 rounded-sm px-4 text-xs shadow-none hover:bg-foreground/90"
                          disabled={!pasteText.trim() || queueBusy}
                          onClick={handleUsePasted}
                        >
                          Use this text
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col">
                    <label
                      className={cn(
                        "flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 px-8 pt-16 pb-6 text-center transition-colors",
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
                        if (!queueBusy) void handleFiles(e.dataTransfer.files);
                      }}
                    >
                      <input
                        type="file"
                        accept=".txt,.md,.text,text/plain,text/markdown"
                        multiple
                        className="hidden"
                        disabled={queueBusy}
                        onChange={(e) => {
                          if (e.target.files) void handleFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <div className="flex size-10 items-center justify-center rounded-sm border border-border/70 bg-background">
                        <FileText className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Drop chapter files here</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          or click to browse · .txt or .md · under 250 KB each — or
                          paste the text directly
                        </p>
                      </div>
                    </label>
                    <div className="border-t border-border/70 px-5 py-3 text-center">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                        disabled={queueBusy}
                        onClick={() => setSourceInputMode("paste")}
                      >
                        Paste text instead
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Translation */}
              <section className="flex flex-col border border-black/[0.06] bg-card shadow-sm transition-shadow hover:shadow-md dark:border-white/10">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                      Translation
                    </span>
                    {active && (
                      <span className="text-[11px] text-muted-foreground">
                        {langPair(
                          active.translation.sourceLang,
                          active.translation.targetLang,
                        )}{" "}
                        · {modelLabel(active.translation.model)}
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
                      <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-2.5">
                        <span className="text-[11px] text-muted-foreground">
                          {status === "done"
                            ? "Saved to catalog — copy or download it there."
                            : `${countWords(translatedText).toLocaleString()} words · ${languageName(
                                active.translation.targetLang,
                              )}`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Action bar */}
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-3">
              <div className="flex flex-col gap-1.5 sm:w-auto">
                <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Series
                </span>
                <Input
                  value={novelName}
                  onChange={(e) => setNovelName(e.target.value)}
                  placeholder="Novel / series (optional)"
                  className="w-full rounded-sm border-border/80 bg-card text-sm shadow-none sm:max-w-52"
                  disabled={queueBusy}
                />
              </div>

              <div className="flex flex-col gap-1.5 sm:w-auto">
                <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Source language
                </span>
                <Select value={sourceLang} onValueChange={setSourceLang}>
                  <SelectTrigger
                    size="sm"
                    className="w-full rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-36"
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
                    className="w-full rounded-sm border-border/80 bg-card text-xs shadow-none sm:w-40"
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
                {hasPending && !queueBusy && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center rounded-sm border-border/80 bg-transparent shadow-none sm:w-auto"
                    onClick={handleResume}
                  >
                    <RefreshCw className="mr-2 size-3.5" />
                    Resume
                  </Button>
                )}
              </div>
              {!queueBusy && active && status === "done" && (
                <p className="text-xs text-muted-foreground sm:w-full">
                  Filed under{" "}
                  <span className="font-medium text-foreground">
                    {active.translation.novelName ?? active.translation.title ?? "Catalog"}
                  </span>
                  . Find it in the catalog tab.
                </p>
              )}
            </div>

            {/* Translation instructions */}
            <section className="mt-12 border-t border-border/70 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <PenLine className="size-4 text-muted-foreground" />
                  <h2 className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                    Translation instructions
                  </h2>
                </div>
                {promptSaved && (
                  <span className="text-[11px] text-muted-foreground">
                    Saved — applies to new runs
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                Extra guidance for the model on every new translation run — style
                notes, glossary terms, names to keep or change. Where these
                conflict with the general rules, your instructions win.
              </p>
              {!promptExpanded && customPrompt.trim() ? (
                <div className="mt-3 max-w-2xl border border-black/[0.06] bg-card shadow-sm dark:border-white/10">
                  <div className="px-4 py-3">
                    <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground line-clamp-3">
                      {customPrompt}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-2">
                    <span className="text-[11px] text-muted-foreground">
                      Saved instructions — only the first few lines shown here.
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-sm px-2 text-xs"
                      onClick={() => setPromptExpanded(true)}
                    >
                      <PenLine className="mr-1.5 size-3.5" />
                      Edit instructions
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-3">
                  <Textarea
                    value={customPrompt}
                    onChange={(e) => {
                      setCustomPrompt(e.target.value);
                      setPromptSaved(false);
                    }}
                    placeholder="e.g., Keep the term “Qi” as-is, translate “Young Miss” as “Nona Muda”, keep battle scenes terse and dialogue casual."
                    className="max-w-2xl min-h-24 rounded-sm border-border/80 text-sm leading-6 shadow-none"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-sm border-border/80 bg-transparent shadow-none"
                      onClick={handleSavePrompt}
                      disabled={savingPrompt}
                    >
                      {savingPrompt && (
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                      )}
                      Save instructions
                    </Button>
                    {customPrompt.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-sm px-3 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setPromptExpanded(false)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Batch queue */}
            <section className="mt-10 border-t border-border/70 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Files className="size-4 text-muted-foreground" />
                  <h2 className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                    Queue
                  </h2>
                  {queue.length > 0 && (
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {queue.length}
                    </span>
                  )}
                </div>
                {queue.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-sm px-3 text-xs text-muted-foreground hover:text-foreground"
                      disabled={queueBusy}
                      onClick={handleClearQueue}
                    >
                      Clear finished
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-sm px-4 shadow-none hover:bg-foreground/90"
                      disabled={queueBusy || !hasQueueWork}
                      onClick={handleTranslateAll}
                    >
                      {processing ? (
                        <>
                          <Loader2 className="mr-2 size-3.5 animate-spin" />
                          Translating…
                        </>
                      ) : (
                        <>
                          Translate all
                          <ArrowRight className="ml-2 size-3.5" />
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {queue.length === 0 ? (
                <p className="mt-4 border-y border-border/70 py-6 text-center text-xs text-muted-foreground">
                  Drop several chapter files at once to queue them — then translate
                  them all in sequence, or one by one.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-border/70 border-y border-border/70">
                  {queue.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center justify-between gap-3 px-2 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.fileName}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {item.wordCount.toLocaleString()} words
                          {item.error ? ` · ${item.error}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            "text-[10px] font-medium tracking-[0.18em] uppercase",
                            item.status === "done" && "text-foreground",
                            item.status === "translating" && "text-muted-foreground",
                            item.status === "error" && "text-destructive",
                            item.status === "waiting" && "text-muted-foreground",
                          )}
                        >
                          {item.status === "translating" ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Loader2 className="size-3 animate-spin" />
                              Translating
                            </span>
                          ) : (
                            item.status
                          )}
                        </span>
                        {(item.status === "waiting" || item.status === "error") && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-sm px-2 text-xs"
                            disabled={queueBusy}
                            onClick={() => void handleTranslateItem(item)}
                          >
                            Translate
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-sm text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${item.fileName} from the queue`}
                          disabled={queueBusy}
                          onClick={() => handleRemoveQueueItem(item.key)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
                      onClick={() => handleOpenViewer(t._id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenViewer(t._id);
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {t.title ?? t.fileName}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {[
                            langPair(t.sourceLang, t.targetLang),
                            t.novelName,
                            t.fileName,
                            formatDate(t.createdAt),
                          ]
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
                          className="size-7 rounded-sm text-muted-foreground opacity-100 group-hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
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

      {/* Catalog result viewer */}
      <Dialog
        open={viewerId !== null}
        onOpenChange={(open) => {
          if (!open) setViewerId(null);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden rounded-sm p-5 sm:max-w-2xl sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="pr-8">
              {viewer?.translation.title ?? viewer?.translation.fileName ?? "Chapter"}
            </DialogTitle>
            <DialogDescription>
              {viewer
                ? [
                    viewer.translation.novelName,
                    langPair(
                      viewer.translation.sourceLang,
                      viewer.translation.targetLang,
                    ),
                    modelLabel(viewer.translation.model),
                    formatDate(viewer.translation.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto border-y border-border/70 px-5 py-4">
            {viewerText ? (
              <div className="font-display text-[15px] leading-7 whitespace-pre-wrap">
                {viewerText}
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

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <span className="text-[11px] text-muted-foreground sm:mr-auto">
              {viewerText ? `${countWords(viewerText).toLocaleString()} words` : ""}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                const id = viewerId;
                setViewerId(null);
                if (id) void handleOpenInTranslator(id);
              }}
            >
              <ArrowRight className="mr-2 size-3.5" />
              Open in translator
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              disabled={!viewerText}
              onClick={() => void copyToClipboard(viewerText, setViewerCopied)}
            >
              {viewerCopied ? (
                <Check className="mr-2 size-3.5" />
              ) : (
                <Copy className="mr-2 size-3.5" />
              )}
              {viewerCopied ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              className="rounded-sm px-5 shadow-none hover:bg-foreground/90"
              disabled={!viewerText || !viewer}
              onClick={() =>
                viewer &&
                downloadText(
                  viewerText,
                  viewer.translation.fileName,
                  viewer.translation.targetLang,
                )
              }
            >
              <Download className="mr-2 size-3.5" />
              Download .txt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-sm p-5 sm:max-w-lg sm:p-6">
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

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
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

      {/* Providers dialog */}
      <ProvidersDialog open={providersOpen} onOpenChange={setProvidersOpen} />
    </main>
  );
}
