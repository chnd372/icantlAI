import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";

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

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<Id<"aiProviders"> | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<Id<"aiProviders"> | null>(null);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (p: NonNullable<typeof providers>[number]) => {
    setEditingId(p._id);
    setForm({
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      apiKey: "",
      modelId: p.modelId,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveProvider({
        providerId: editingId ?? undefined,
        name: form.name,
        providerType: form.providerType,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        modelId: form.modelId,
      });
      toast.success(editingId ? "Provider updated." : "Provider added.");
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
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

  const canSave =
    form.name.trim() !== "" &&
    form.baseUrl.trim() !== "" &&
    form.modelId.trim() !== "" &&
    (editingId !== null || form.apiKey.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sm sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI providers</DialogTitle>
          <DialogDescription>
            Connect any OpenAI- or Anthropic-compatible endpoint and translate
            with whichever model you want. The built-in gateway stays available
            alongside your own providers.
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
                    Model ID
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
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {providers && providers.length === 0 ? (
                <p className="border-y border-border/70 py-8 text-center text-xs text-muted-foreground">
                  No custom providers yet. Add one to translate with any model
                  you like.
                </p>
              ) : (
                providers?.map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between gap-3 border border-border/70 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {TYPE_LABEL[p.providerType]} · {p.modelId} · key ends in
                        …{p.keySuffix}
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
                        className="size-7 rounded-sm text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => void handleDelete(p._id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
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
