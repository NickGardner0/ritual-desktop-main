// @ts-nocheck
"use client";

import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ritual/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { ArtifactKind } from "@/lib/workflows/types";
import { WORKFLOW_WEEKDAY_OPTIONS } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";
import { EMPTY_BLOCK, formatDateTime, formatKind, isProfileSchedulable } from "./reports-client.helpers";

type ReportsSideSheetsProps = { ctx: Record<string, any> };

export function ReportsSideSheets({ ctx }: ReportsSideSheetsProps) {
  const {
    actionProfiles,
    activeFacts,
    approvals,
    artifactEditor,
    artifactEditorMutation,
    editor,
    factApproveMutation,
    factDismissMutation,
    isApprovalsOpen,
    isArtifactEditorOpen,
    isMemoryOpen,
    isWorkflowEditorOpen,
    pendingFacts,
    saveWorkflowMutation,
    selectedProfile,
    setArtifactEditor,
    setEditor,
    setIsApprovalsOpen,
    setIsArtifactEditorOpen,
    setIsMemoryOpen,
    setIsWorkflowEditorOpen,
  } = ctx;

  return (
    <>
      <Sheet open={isArtifactEditorOpen} onOpenChange={setIsArtifactEditorOpen}>
        <SheetContent side="right" className="w-full max-w-[620px] overflow-y-auto bg-[#fcfcfa] px-6 py-6">
          <SheetHeader>
            <SheetTitle>{artifactEditor?.id ? "Edit artifact" : "Create artifact"}</SheetTitle>
            <SheetDescription>
              Notebooks, plans, conversation briefs, and ambient digests all use the shared artifact document model.
            </SheetDescription>
          </SheetHeader>

          {artifactEditor ? (
            <div className="mt-6 space-y-6">
              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="grid gap-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Kind</div>
                    <Select
                      value={artifactEditor.kind}
                      onValueChange={(value) =>
                        setArtifactEditor({ ...artifactEditor, kind: value as ArtifactKind })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select artifact kind" />
                      </SelectTrigger>
                      <SelectContent>
                        {(["notebook", "plan", "conversation_brief", "ambient_digest"] as ArtifactKind[]).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {formatKind(kind)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Title</div>
                    <Input value={artifactEditor.title} onChange={(event) => setArtifactEditor({ ...artifactEditor, title: event.target.value })} />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Summary</div>
                    <textarea
                      value={artifactEditor.summary}
                      onChange={(event) => setArtifactEditor({ ...artifactEditor, summary: event.target.value })}
                      className="min-h-[100px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                    />
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-sm font-[600] text-[#111827]">Folder</div>
                      <Input value={artifactEditor.folder_key} onChange={(event) => setArtifactEditor({ ...artifactEditor, folder_key: event.target.value })} placeholder="general" />
                    </label>
                    <div className="flex items-center justify-between rounded-[20px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">Pinned</div>
                        <div className="text-xs text-[#6b7280]">Keep this near the top of the inbox and launcher.</div>
                      </div>
                      <Switch checked={artifactEditor.is_pinned} onCheckedChange={(checked) => setArtifactEditor({ ...artifactEditor, is_pinned: checked })} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Blocks</div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setArtifactEditor({
                        ...artifactEditor,
                        body_blocks: [
                          ...artifactEditor.body_blocks,
                          { ...EMPTY_BLOCK, id: `block-${artifactEditor.body_blocks.length}-${Date.now()}` },
                        ],
                      })
                    }
                  >
                    Add block
                  </Button>
                </div>
                <div className="mt-4 space-y-4">
                  {artifactEditor.body_blocks.map((block, index) => (
                    <div key={block.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-[600] text-[#111827]">Block {index + 1}</div>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setArtifactEditor({
                              ...artifactEditor,
                              body_blocks: artifactEditor.body_blocks.filter((candidate) => candidate.id !== block.id),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="mt-3 space-y-3">
                        <Select
                          value={block.type}
                          onValueChange={(value) =>
                            setArtifactEditor({
                              ...artifactEditor,
                              body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                candidate.id === block.id ? { ...candidate, type: value } : candidate,
                              ),
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Block type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hero">Hero</SelectItem>
                            <SelectItem value="summary">Summary</SelectItem>
                            <SelectItem value="bullet_list">Bullet list</SelectItem>
                            <SelectItem value="metric_list">Metric list</SelectItem>
                          </SelectContent>
                        </Select>
                        {block.type === "hero" ? (
                          <div className="grid gap-3">
                            <Input
                              value={block.title}
                              placeholder="Hero title"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, title: event.target.value } : candidate,
                                  ),
                                })
                              }
                            />
                            <Input
                              value={block.period_label}
                              placeholder="Period label"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, period_label: event.target.value } : candidate,
                                  ),
                                })
                              }
                            />
                            <textarea
                              value={block.intro}
                              placeholder="Intro"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, intro: event.target.value } : candidate,
                                  ),
                                })
                              }
                              className="min-h-[96px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                            />
                          </div>
                        ) : block.type === "summary" ? (
                          <textarea
                            value={block.text}
                            placeholder="Summary text"
                            onChange={(event) =>
                              setArtifactEditor({
                                ...artifactEditor,
                                body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                  candidate.id === block.id ? { ...candidate, text: event.target.value } : candidate,
                                ),
                              })
                            }
                            className="min-h-[120px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                          />
                        ) : (
                          <div className="grid gap-3">
                            {block.type === "bullet_list" ? (
                              <Input
                                value={block.title}
                                placeholder="List title"
                                onChange={(event) =>
                                  setArtifactEditor({
                                    ...artifactEditor,
                                    body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                      candidate.id === block.id ? { ...candidate, title: event.target.value } : candidate,
                                    ),
                                  })
                                }
                              />
                            ) : null}
                            <textarea
                              value={block.items_text}
                              placeholder={block.type === "metric_list" ? "One per line: label | value | note" : "One item per line"}
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, items_text: event.target.value } : candidate,
                                  ),
                                })
                              }
                              className="min-h-[140px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex gap-3">
                <Button
                  className="bg-[#111827] text-white hover:bg-[#1f2937]"
                  onClick={() => artifactEditorMutation.mutate()}
                  disabled={artifactEditorMutation.isPending}
                >
                  {artifactEditorMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save artifact
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
        <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Memory &amp; Rules</SheetTitle>
            <SheetDescription>
              Only approved facts are eligible for prompt injection. Pending suggestions stay visible here until you explicitly approve them.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Pending suggestions</div>
                <div className="text-xs text-[#6b7280]">{pendingFacts.length}</div>
              </div>
              <div className="mt-4 space-y-3">
                {pendingFacts.length ? pendingFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.10em] text-[#6b7280]">{fact.category}</div>
                      </div>
                      <div className="text-xs text-[#6b7280]">{Math.round(fact.confidence * 100)}%</div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-[16px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" onClick={() => factDismissMutation.mutate(fact.id)} disabled={factDismissMutation.isPending}>
                        Dismiss
                      </Button>
                      <Button className="bg-[#111827] text-white hover:bg-[#1f2937]" onClick={() => factApproveMutation.mutate(fact.id)} disabled={factApproveMutation.isPending}>
                        Approve
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[20px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center text-sm text-[#6b7280]">
                    No pending fact suggestions.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Approved facts</div>
                <div className="text-xs text-[#6b7280]">{activeFacts.length}</div>
              </div>
              <div className="mt-4 space-y-3">
                {activeFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.10em] text-[#6b7280]">{fact.category}</div>
                      </div>
                      <div className="text-xs text-[#6b7280]">{fact.visibility}</div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-[16px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isWorkflowEditorOpen} onOpenChange={setIsWorkflowEditorOpen}>
        <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto bg-[#fcfcfa] px-6 py-6">
          <SheetHeader>
            <SheetTitle>{editor?.name || "Edit routine"}</SheetTitle>
            <SheetDescription>
              Keep this sprint constrained to in-app delivery and bounded permissions.
            </SheetDescription>
          </SheetHeader>

          {editor ? (
            <div className="mt-6 space-y-6">
              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Schedule</div>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Timezone</div>
                    <Input value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })} />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Local send time</div>
                    <Input type="time" value={editor.time_value} onChange={(event) => setEditor({ ...editor, time_value: event.target.value })} />
                  </label>
                  <div>
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Weekdays</div>
                    <div className="flex flex-wrap gap-2">
                      {WORKFLOW_WEEKDAY_OPTIONS.map((day) => {
                        const active = editor.send_weekdays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-sm font-[600] transition",
                              active
                                ? "border-[#111827] bg-[#111827] text-white"
                                : "border-[rgba(15,23,42,0.10)] bg-white text-[#4b5563]",
                            )}
                            onClick={() => {
                              const next = active
                                ? editor.send_weekdays.filter((value) => value !== day.value)
                                : [...editor.send_weekdays, day.value];
                              setEditor({ ...editor, send_weekdays: next });
                            }}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Content</div>
                <div className="mt-4 space-y-3">
                  {Object.entries(editor.config).map(([key, enabled]) => (
                    <div key={key} className="flex items-center justify-between gap-4 rounded-[20px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{key.replace(/_/g, " ")}</div>
                        <div className="text-xs text-[#6b7280]">Include this section in the generated artifact.</div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={(checked) => setEditor({ ...editor, config: { ...editor.config, [key]: checked } })} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Action profile</div>
                <div className="mt-4 space-y-3">
                  <Select value={editor.action_profile_id} onValueChange={(value) => setEditor({ ...editor, action_profile_id: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {actionProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} ({profile.mode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="rounded-[18px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3 text-sm leading-6 text-[#4b5563]">
                    {selectedProfile?.mode === "observe"
                      ? "Observe is read-only. It can be saved as draft or paused, but cannot be scheduled."
                      : "Draft allows artifact creation and workflow updates, but still blocks external sends and system writes."}
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => saveWorkflowMutation.mutate({ status: "draft" })} disabled={saveWorkflowMutation.isPending}>
                  {saveWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save Draft
                </Button>
                <Button variant="outline" onClick={() => saveWorkflowMutation.mutate({ status: "paused" })} disabled={saveWorkflowMutation.isPending}>
                  Pause
                </Button>
                <Button
                  className="bg-[#111827] text-white hover:bg-[#1f2937]"
                  onClick={() => saveWorkflowMutation.mutate({ status: "scheduled" })}
                  disabled={saveWorkflowMutation.isPending || !isProfileSchedulable(selectedProfile)}
                >
                  Schedule Routine
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={isApprovalsOpen} onOpenChange={setIsApprovalsOpen}>
        <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Approval queue</SheetTitle>
            <SheetDescription>
              Observe and Draft profiles do not allow external or destructive actions, so this queue should usually stay empty in sprint one.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {approvals.length ? approvals.map((approval) => (
              <section key={approval.id} className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex rounded-full border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.10)] px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.10em] text-[#1d4ed8]">
                    {approval.status}
                  </span>
                  <span className="text-xs text-[#6b7280]">{formatDateTime(approval.created_at)}</span>
                </div>
                <div className="mt-3 text-sm font-[600] text-[#111827]">{approval.action_kind}</div>
                {approval.reason ? <div className="mt-2 text-sm leading-6 text-[#4b5563]">{approval.reason}</div> : null}
              </section>
            )) : (
              <section className="rounded-[28px] border border-[rgba(15,23,42,0.08)] bg-white px-5 py-10 text-center shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                <ShieldCheck className="mx-auto h-12 w-12 text-[#2563eb]" />
                <div className="mt-4 text-[22px] font-[620] tracking-[-0.03em] text-[#111827]">Nothing needs your sign-off yet</div>
                <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#6b7280]">
                  Approval-generating actions will arrive later when Ritual starts touching external systems or destructive mutations.
                </p>
                <div className="mt-8 rounded-[24px] border border-[rgba(34,197,94,0.16)] bg-[rgba(34,197,94,0.06)] px-4 py-4 text-sm text-[#166534]">
                  <div className="flex items-center justify-center gap-2 font-[600]">
                    <CheckCircle2 className="h-4 w-4" />
                    Profiles are currently bounded to read-only and draft-only actions.
                  </div>
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
