import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type ProviderType = "openai" | "anthropic";

interface FormState {
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  providerType: "openai",
  baseUrl: "",
  apiKey: "",
  modelId: "",
};

const TYPE_LABEL: Record<ProviderType, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic-compatible",
};

const BASE_URL_HINTS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

export function ProvidersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const providers = useQuery(api.providers.listProviders);
  const saveProvider = useMutation(api.providers.saveProvider);
  const deleteProvider = useMutation(api.providers.deleteProvider);
  const testProviderAction = useAction(api.translateSegment.testProvider);
  const listProviderModelsAction = useAction(api.translateSegment.listProviderModels);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"aiProviders"> | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<Id<"aiProviders"> | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  // Provider list: which row's model list is expanded, which provider is
  // having its active model changed or its model list (re)loaded.
  const [expandedId, setExpandedId] = useState<Id<"aiProviders"> | null>(null);
  const [settingModelId, setSettingModelId] = useState<Id<"aiProviders"> | null>(
    null,
  );
  const [loadingModelsFor, setLoadingModelsFor] = useState<Id<"aiProviders"> | null>(
    null,
  );

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModels([]);
    setModelError(null);
    setShowForm(true);
  };

  const openEdit = (p: NonNullable<typeof providers>[number]) => {
    setEditingId(p._id);
    setForm({
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      apiKey: "",
      modelId: p.modelId ?? "",
    });
    setModels(p.models);
    setModelError(null);
    setShowForm(true);
  };

  const canLoadModels =
    form.baseUrl.trim() !== "" &&
    (editingId !== null || form.apiKey.trim() !== "");

  const handleLoadModels = async () => {
    if (loadingModels) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const result =
        editingId !== null && !form.apiKey.trim()
          ? await listProviderModelsAction({ providerId: editingId })
          : await listProviderModelsAction({
              providerType: form.providerType,
              baseUrl: form.baseUrl,
              apiKey: form.apiKey,
            });
      setModels(result);
      if (result.length === 0) {
        setModelError("No models found at this base URL.");
      }
    } catch (error) {
      setModelError(
        error instanceof Error ? error.message : "Could not load models.",
      );
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const id = await saveProvider({
        providerId: editingId ?? undefined,
        name: form.name,
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        modelId: form.modelId.trim() || undefined,
        models,
      });
      toast.success(editingId ? "Provider updated." : "Provider added.");
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      setModels([]);
      setModelError(null);
      // Drop straight into the list with the models visible.
      setExpandedId(id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the provider.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: Id<"aiProviders">) => {
    await deleteProvider({ providerId: id });
    toast.success("Provider removed.");
  };

  const handleTest = async (id: Id<"aiProviders">) => {
    if (testingId) return;
    setTestingId(id);
    try {
      const reply = await testProviderAction({ providerId: id });
      toast.success(`Connected — the model replied: “${reply}”`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Connection failed.",
      );
    } finally {
      setTestingId(null);
    }
  };

  /**
   * Pick the model used for this provider straight from the provider list.
   * Pass `undefined` to clear the fixed model and auto-pick at translate time.
   */
  const handleSetModel = async (
    id: Id<"aiProviders">,
    modelId: string | undefined,
  ) => {
    if (settingModelId) return;
    const p = providers?.find((x) => x._id === id);
    if (!p) return;
    setSettingModelId(id);
    try {
      await saveProvider({
        providerId: id,
        name: p.name,
        providerType: p.providerType,
        baseUrl: p.baseUrl,
        apiKey: "", // blank keeps the stored key
        modelId,
        models: p.models,
      });
      toast.success(
        modelId
          ? `Model set to ${modelId}.`
          : "Any model — one will be picked automatically when translating.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the model.",
      );
    } finally {
      setSettingModelId(null);
    }
  };

  /** Fetch the model list for a saved provider and store it. */
  const handleLoadModelsForProvider = async (
    p: NonNullable<typeof providers>[number],
  ) => {
    if (loadingModelsFor) return;
    setLoadingModelsFor(p._id);
    try {
      const result = await listProviderModelsAction({ providerId: p._id });
      await saveProvider({
        providerId: p._id,
        name: p.name,
        providerType: p.providerType,
        baseUrl: p.baseUrl,
        apiKey: "", // blank keeps the stored key
        modelId: p.modelId ?? undefined,
        models: result,
      });
      setExpandedId(p._id);
      if (result.length === 0) {
        toast.error("No models found at this base URL.");
      } else {
        toast.success(
          `${result.length} model${result.length === 1 ? "" : "s"} loaded from this base URL.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load models.",
      );
    } finally {
      setLoadingModelsFor(null);
    }
  };

  const canSave =
    form.name.trim() !== "" &&
    form.baseUrl.trim() !== "" &&
    (editingId !== null || form.apiKey.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI providers</DialogTitle>
          <DialogDescription>
            Connect any OpenAI- or Anthropic-compatible endpoint and translate
            with whichever model you want. All translations run through your
            own providers.
          </DialogDescription>
        </DialogHeader>

        {showForm ? (
          <>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="provider-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="My DeepSeek"
                    className="rounded-sm border-border/80 text-sm shadow-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-type" className="text-xs">
                    Type
                  </Label>
                  <Select
                    value={form.providerType}
                    onValueChange={(value) =>
                      setForm({ ...form, providerType: value as ProviderType })
                    }
                  >
                    <SelectTrigger
                      id="provider-type"
                      className="w-full rounded-sm border-border/80 bg-card text-sm shadow-none"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-sm">
                      <SelectItem value="openai">OpenAI-compatible</SelectItem>
                      <SelectItem value="anthropic">Anthropic-compatible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-base-url" className="text-xs">
                  Base URL
                </Label>
                <Input
                  id="provider-base-url"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder={BASE_URL_HINTS[form.providerType]}
                  className="rounded-sm border-border/80 font-mono text-xs shadow-none"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-api-key" className="text-xs">
                    API key
                  </Label>
                  <Input
                    id="provider-api-key"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={editingId ? "Leave blank to keep the existing key" : "sk-…"}
                    className="rounded-sm border-border/80 font-mono text-xs shadow-none"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-model" className="text-xs">
                    Model ID <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="provider-model"
                    value={form.modelId}
                    onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                    placeholder="deepseek-chat"
                    className="rounded-sm border-border/80 font-mono text-xs shadow-none"
                  />
                </div>
              </div>

              {/* Models at this base URL */}
              <div className="space-y-2 border-t border-border/70 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-xs">Models at this base URL</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-sm px-2 text-xs"
                    disabled={!canLoadModels || loadingModels}
                    onClick={() => void handleLoadModels()}
                  >
                    {loadingModels ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : models.length > 0 ? (
                      <RefreshCw className="mr-1.5 size-3.5" />
                    ) : null}
                    {models.length > 0 ? "Reload models" : "Load models"}
                  </Button>
                </div>

                {modelError && (
                  <p className="text-[11px] leading-5 text-destructive">{modelError}</p>
                )}

                {models.length > 0 && (
                  <Select
                    value={form.modelId}
                    onValueChange={(value) => setForm({ ...form, modelId: value })}
                  >
                    <SelectTrigger className="w-full rounded-sm border-border/80 bg-card font-mono text-xs shadow-none">
                      <SelectValue placeholder="Choose a model…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 rounded-sm font-mono text-xs">
                      {models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {models.length === 0 && !loadingModels && !modelError && (
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    Load the model list to pick any model at this base URL — or
                    leave the model blank and one will be chosen automatically.
                  </p>
                )}
              </div>

              <p className="text-[11px] leading-5 text-muted-foreground">
                The key is stored privately with your account and is never shown
                again after saving — only sent to the base URL you configure.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-sm px-5 shadow-none hover:bg-foreground/90"
                disabled={!canSave || saving}
                onClick={handleSave}
              >
                {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                {editingId ? "Save changes" : "Add provider"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {providers && providers.length === 0 ? (
                <p className="border-y border-border/70 py-8 text-center text-xs text-muted-foreground">
                  No custom providers yet. Add one to translate with any model
                  you like.
                </p>
              ) : (
                providers?.map((p) => {
                  const expanded = expandedId === p._id;
                  const busy =
                    settingModelId === p._id || loadingModelsFor === p._id;
                  return (
                    <div key={p._id} className="border border-border/70">
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {TYPE_LABEL[p.providerType]} ·{" "}
                            {p.modelId ?? "any model"}
                            {p.models.length > 0 &&
                              ` · ${p.models.length} models`}{" "}
                            · key ends in …{p.keySuffix}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                            {p.baseUrl}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 rounded-sm px-2 text-xs"
                            disabled={testingId === p._id}
                            onClick={() => void handleTest(p._id)}
                          >
                            {testingId === p._id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Zap className="mr-1 size-3.5" />
                            )}
                            Test
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 rounded-sm text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 rounded-sm text-muted-foreground hover:text-destructive",
                            )}
                            aria-label={`Delete ${p.name}`}
                            onClick={() => void handleDelete(p._id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 rounded-sm text-muted-foreground hover:text-foreground",
                            )}
                            aria-label={
                              expanded ? "Hide models" : "Show all models"
                            }
                            onClick={() =>
                              setExpandedId(expanded ? null : p._id)
                            }
                          >
                            <ChevronDown
                              className={cn(
                                "size-3.5 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          </Button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="border-t border-border/70 px-3 py-2.5">
                          {p.models.length > 0 ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                                  All models at this base URL
                                </p>
                                <button
                                  type="button"
                                  className={cn(
                                    "text-[10px] underline-offset-4 transition-colors hover:underline",
                                    p.modelId
                                      ? "text-foreground hover:text-foreground"
                                      : "text-muted-foreground hover:text-foreground",
                                  )}
                                  disabled={busy}
                                  onClick={() =>
                                    void handleSetModel(p._id, undefined)
                                  }
                                >
                                  Use any model
                                </button>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {p.models.map((m) => {
                                  const active = p.modelId === m;
                                  return (
                                    <button
                                      key={m}
                                      type="button"
                                      title={
                                        active
                                          ? `${m} — active model`
                                          : `Use ${m} for this provider`
                                      }
                                      className={cn(
                                        "inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                                        active
                                          ? "border-foreground/40 bg-muted text-foreground"
                                          : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                                      )}
                                      disabled={busy}
                                      onClick={() =>
                                        void handleSetModel(p._id, m)
                                      }
                                    >
                                      {active && (
                                        <Check className="size-3 shrink-0" />
                                      )}
                                      <span className="truncate">{m}</span>
                                    </button>
                                  );
                                })}
                                {busy && (
                                  <Loader2 className="ml-1 size-3.5 animate-spin text-muted-foreground" />
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] leading-5 text-muted-foreground">
                                No models loaded yet — fetch the list from this
                                base URL to pick any model.
                              </p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-sm px-2 text-xs"
                                disabled={busy}
                                onClick={() =>
                                  void handleLoadModelsForProvider(p)
                                }
                              >
                                {loadingModelsFor === p._id ? (
                                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-1.5 size-3.5" />
                                )}
                                Load models
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-sm border-border/80 bg-transparent shadow-none"
                onClick={openAdd}
              >
                <Plus className="mr-2 size-3.5" />
                Add provider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
