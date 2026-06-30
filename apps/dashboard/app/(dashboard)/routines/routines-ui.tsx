"use client";

import { useState } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  ChevronsRight,
  FlaskConical,
  GitPullRequest,
  HeartPulse,
  History,
  Inbox,
  MailPlus,
  MonitorCheck,
  MoreHorizontal,
  PenLine,
  Radar,
  Sparkles,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { dateFromInput, dateInputValue } from "@/lib/tasks/date-format";
import { WEEKDAYS } from "@/lib/tasks/routine-editor";
import { triggerDefaults } from "@/lib/tasks/routine-editor";
import type { AiRoutineTemplate } from "@/lib/tasks/ai-routine-templates";
import {
  DetailCard,
  DetailFieldRow,
  DetailTextarea,
  InlineFieldInput,
  PillSelect,
  ToolbarIconButton,
  priorityBars,
} from "@/lib/tasks/task-ui-shell";
import type { Routine, RoutineKind, RoutineRun, RoutineTriggerType, TaskPriority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

export const TRIGGERS: RoutineTriggerType[] = ["daily", "weekly", "monthly", "yearly", "on_completion"];
export const KIND_OPTIONS: Array<{ id: RoutineKind; label: string }> = [
  { id: "task", label: "Task" },
  { id: "ai_workflow", label: "AI report" },
  { id: "habit_prompt", label: "Log prompt" },
  { id: "mixed", label: "Experiment check-in" },
  { id: "calendar_block", label: "Calendar block" },
];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const ORDINALS = [
  { value: 1, label: "first" },
  { value: 2, label: "second" },
  { value: 3, label: "third" },
  { value: 4, label: "fourth" },
  { value: 5, label: "last" },
];

export function templateScheduleSummary(template: AiRoutineTemplate) {
  const time = `${String(template.hour).padStart(2, "0")}:${String(template.minute).padStart(2, "0")}`;
  if (template.cadence === "daily") return `Daily at ${time}`;
  const days = template.weekdays
    .map((day) => WEEKDAYS.find((item) => item.value === day)?.label)
    .filter(Boolean)
    .join(", ");
  return `Weekly ${days || "weekdays"} at ${time}`;
}

export function routineKindLabel(kind: RoutineKind) {
  return KIND_OPTIONS.find((option) => option.id === kind)?.label || kind.replace(/_/g, " ");
}

export function triggerLabel(trigger: RoutineTriggerType) {
  if (trigger === "on_completion") return "On completion";
  return trigger.charAt(0).toUpperCase() + trigger.slice(1);
}

export function runOutputType(run: RoutineRun) {
  if (run.generated_task_id) return "task";
  if (run.generated_scheduled_block_id) return "note";
  if (run.workflow_run_id) return "report";
  return run.status === "failed" ? "prompt" : "none";
}

export function runStatusClass(status: RoutineRun["status"]) {
  if (status === "failed") return "text-[#c44d3a]";
  if (status === "skipped") return "text-[rgba(39,37,30,0.55)]";
  if (status === "completed" || status === "generated") return "text-[#2d6a4f]";
  return "text-[rgba(39,37,30,0.55)]";
}

export function TemplateIcon({ sourceIcon }: { sourceIcon: string }) {
  const className = "h-4 w-4";
  switch (sourceIcon) {
    case "Calendar":
    case "CalendarClock":
    case "CalendarSearch":
      return <CalendarClock className={className} />;
    case "History":
      return <History className={className} />;
    case "FlaskConical":
      return <FlaskConical className={className} />;
    case "HeartPulse":
      return <HeartPulse className={className} />;
    case "Radar":
      return <Radar className={className} />;
    case "MonitorCheck":
      return <MonitorCheck className={className} />;
    case "Inbox":
      return <Inbox className={className} />;
    case "MailPlus":
      return <MailPlus className={className} />;
    case "PenLine":
      return <PenLine className={className} />;
    case "GitPullRequest":
      return <GitPullRequest className={className} />;
    case "BriefcaseBusiness":
      return <BriefcaseBusiness className={className} />;
    default:
      return <Sparkles className={className} />;
  }
}

export function RoutineDetailHeader() {
  return (
    <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-subtle)] px-4">
      <ChevronsRight className="h-4 w-4 text-[rgba(39,37,30,0.35)]" />
      <div className="min-w-0 flex-1 text-center text-[12.5px] font-medium text-[rgba(39,37,30,0.55)]">
        Routine
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarIconButton aria-label="Routine options" title="Routine options" className="h-7 w-7">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </ToolbarIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-40">
          <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
          <DropdownMenuItem disabled className="text-[#c44d3a]">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function RoutineListItem({
  title,
  cadence,
  showCadence,
  selected,
  onClick,
}: {
  title: string;
  cadence?: string | null;
  showCadence: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ritual-snappy-row grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left hover:bg-[#f6f6f5]",
        selected && "bg-[rgba(59,130,246,0.08)]",
      )}
    >
      <svg className="h-4 w-4 text-[rgba(39,37,30,0.45)]" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M4 2.5a2.5 2.5 0 0 1 2.45 2h3.1A2.5 2.5 0 0 1 12 6.5V8a4 4 0 0 1-3.874 3.996L8 12l-.126-.004A4 4 0 0 1 4 8V6.5A2.5 2.5 0 0 1 4 2.5Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M6 12v1.5M10 12v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="min-w-0 truncate text-[14px] font-medium text-[#27251E]">{title}</span>
      {showCadence && cadence ? (
        <span className="max-w-[140px] truncate text-[12.5px] text-[rgba(39,37,30,0.42)]">{cadence}</span>
      ) : null}
    </button>
  );
}

export function RoutineEditorCards({
  editor,
  setEditor,
  updateConfig,
  editorTimeValue,
  completionPreview,
  nextPreviewText,
  lastRunText,
}: {
  editor: Routine;
  setEditor: Dispatch<SetStateAction<Routine | null>>;
  updateConfig: (patch: Record<string, unknown>) => void;
  editorTimeValue: string;
  completionPreview: string | null;
  nextPreviewText: string;
  lastRunText: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const intervalUnit = editor.trigger_type === "on_completion"
    ? String(editor.trigger_config.unit || "weeks")
    : editor.trigger_type === "daily"
      ? "days"
      : editor.trigger_type === "weekly"
        ? "weeks"
        : editor.trigger_type === "monthly"
          ? "months"
          : "years";

  return (
    <div className="space-y-3">
      <DetailCard>
        <DetailFieldRow label="Trigger" inCard>
          <PillSelect
            value={editor.trigger_type}
            options={TRIGGERS.map((trigger) => ({ value: trigger, label: triggerLabel(trigger) }))}
            onChange={(value) => {
              const trigger = value as RoutineTriggerType;
              setEditor({ ...editor, trigger_type: trigger, trigger_config: triggerDefaults(trigger) });
            }}
          />
        </DetailFieldRow>
        <DetailFieldRow label="Paused" inCard>
          <Switch
            checked={editor.status === "paused"}
            onCheckedChange={(checked) => setEditor({ ...editor, status: checked ? "paused" : "scheduled" })}
          />
        </DetailFieldRow>
      </DetailCard>

      <DetailCard>
        <DetailFieldRow label={editor.trigger_type === "on_completion" ? "Repeat" : "Every"} inCard>
          <InlineFieldInput
            type="number"
            min={1}
            value={Number(editor.trigger_config.interval || 1)}
            onChange={(event) => updateConfig({ interval: Number(event.target.value) || 1 })}
            className="w-14 text-right"
          />
          {editor.trigger_type === "on_completion" ? (
            <PillSelect
              value={intervalUnit}
              options={[
                { value: "days", label: "days" },
                { value: "weeks", label: "weeks" },
                { value: "months", label: "months" },
              ]}
              onChange={(value) => updateConfig({ unit: value })}
            />
          ) : (
            <span className="text-[12.5px] text-[rgba(39,37,30,0.55)]">{intervalUnit}</span>
          )}
        </DetailFieldRow>

        {editor.trigger_type !== "on_completion" ? (
          <DetailFieldRow label="Time" inCard>
            <InlineFieldInput
              type="time"
              value={editorTimeValue}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(":").map(Number);
                updateConfig({ hour, minute });
              }}
              className="w-[120px]"
            />
          </DetailFieldRow>
        ) : null}

        {editor.trigger_type === "weekly" ? (
          <DetailFieldRow label="Weekdays" inCard>
            <span className="flex flex-wrap justify-end gap-1">
              {WEEKDAYS.map((day) => {
                const weekdays = Array.isArray(editor.trigger_config.weekdays)
                  ? editor.trigger_config.weekdays.map(Number)
                  : [];
                const active = weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => updateConfig({
                      weekdays: active
                        ? weekdays.filter((value) => value !== day.value)
                        : [...weekdays, day.value].sort(),
                    })}
                    className={cn(
                      "h-6 rounded-sm px-2 text-[11.5px]",
                      active
                        ? "bg-[#27251E] text-white"
                        : "bg-white text-[rgba(39,37,30,0.65)] hover:bg-[#ececea]",
                    )}
                  >
                    {day.label.slice(0, 3)}
                  </button>
                );
              })}
            </span>
          </DetailFieldRow>
        ) : null}

        {(editor.trigger_type === "monthly" || editor.trigger_type === "yearly") ? (
          <>
            <DetailFieldRow label="Mode" inCard>
              <PillSelect
                value={String(editor.trigger_config.mode || "day_of_month")}
                options={[
                  { value: "day_of_month", label: "Day of month" },
                  { value: "nth_weekday", label: "Nth weekday" },
                ]}
                onChange={(value) => updateConfig({ mode: value })}
              />
            </DetailFieldRow>
            {editor.trigger_type === "yearly" ? (
              <DetailFieldRow label="Month" inCard>
                <PillSelect
                  value={String(Number(editor.trigger_config.month || 1))}
                  options={MONTHS.map((month, index) => ({
                    value: String(index + 1),
                    label: month,
                  }))}
                  onChange={(value) => updateConfig({ month: Number(value) })}
                />
              </DetailFieldRow>
            ) : null}
            {editor.trigger_config.mode === "nth_weekday" ? (
              <DetailFieldRow label="When" inCard>
                <PillSelect
                  value={String(Number(editor.trigger_config.ordinal || 1))}
                  options={ORDINALS.map((ordinal) => ({
                    value: String(ordinal.value),
                    label: ordinal.label,
                  }))}
                  onChange={(value) => updateConfig({ ordinal: Number(value) })}
                />
                <PillSelect
                  value={String(Number(editor.trigger_config.weekday || 0))}
                  options={WEEKDAYS.map((day) => ({
                    value: String(day.value),
                    label: day.label,
                  }))}
                  onChange={(value) => updateConfig({ weekday: Number(value) })}
                />
              </DetailFieldRow>
            ) : (
              <DetailFieldRow label="Day" inCard>
                <InlineFieldInput
                  type="number"
                  min={1}
                  max={31}
                  value={Number(editor.trigger_config.day || 1)}
                  onChange={(event) => updateConfig({ day: Number(event.target.value) || 1 })}
                  className="w-16 text-right"
                />
              </DetailFieldRow>
            )}
          </>
        ) : null}

        {editor.kind === "calendar_block" || editor.kind === "mixed" ? (
          <DetailFieldRow label="Duration" inCard>
            <InlineFieldInput
              type="number"
              min={5}
              max={720}
              value={Number(editor.trigger_config.duration_minutes || 60)}
              onChange={(event) => updateConfig({ duration_minutes: Number(event.target.value) || 60 })}
              className="w-16 text-right"
            />
            <span className="text-[12.5px] text-[rgba(39,37,30,0.55)]">min</span>
          </DetailFieldRow>
        ) : null}

        <DetailFieldRow label="First run" inCard>
          <InlineFieldInput
            type="date"
            value={dateInputValue(editor.first_run_at)}
            onChange={(event) => setEditor({ ...editor, first_run_at: dateFromInput(event.target.value) })}
            className="w-[140px]"
          />
        </DetailFieldRow>

        <DetailFieldRow label="Ends" inCard>
          <InlineFieldInput
            type="date"
            value={dateInputValue(editor.ends_at)}
            onChange={(event) => setEditor({ ...editor, ends_at: dateFromInput(event.target.value) })}
            className="w-[140px]"
          />
        </DetailFieldRow>

        {completionPreview ? (
          <DetailFieldRow label="Preview" inCard>
            <span className="max-w-[240px] truncate text-[12.5px] text-[rgba(39,37,30,0.55)]">{completionPreview}</span>
          </DetailFieldRow>
        ) : null}

        <div className="px-3 py-2.5 text-[12px] text-[rgba(39,37,30,0.42)]">
          Last: {lastRunText} · Next: {nextPreviewText}
        </div>
      </DetailCard>

      <DetailCard>
        <DetailFieldRow label="Priority" inCard>
          {priorityBars(editor.priority, true)}
          <PillSelect
            value={editor.priority}
            options={(["none", "low", "medium", "high"] as TaskPriority[]).map((priority) => ({
              value: priority,
              label: priority,
            }))}
            onChange={(value) => setEditor({ ...editor, priority: value as TaskPriority })}
          />
        </DetailFieldRow>
      </DetailCard>

      <DetailCard className="p-3">
        <DetailTextarea
          value={editor.description || ""}
          onChange={(event) => setEditor({ ...editor, description: event.target.value })}
          placeholder="Start each day with physical activity."
          rows={4}
          className="border-0 bg-transparent shadow-none focus:ring-0"
        />
      </DetailCard>

      <DetailCard>
        <DetailFieldRow label="Tags" inCard>
          <InlineFieldInput
            value={editor.tags.join(", ")}
            onChange={(event) => setEditor({
              ...editor,
              tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
            })}
            placeholder="+ tag"
            className="w-[200px]"
          />
        </DetailFieldRow>
      </DetailCard>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((current) => !current)}
          className="flex items-center gap-1.5 py-2 text-[12.5px] text-[rgba(39,37,30,0.55)] hover:text-[#27251E]"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />
          Advanced
        </button>
        {advancedOpen ? (
          <DetailCard className="mt-1">
            <DetailFieldRow label="Kind" inCard>
              <PillSelect
                value={editor.kind}
                options={KIND_OPTIONS.map((kind) => ({ value: kind.id, label: kind.label }))}
                onChange={(value) => setEditor({ ...editor, kind: value as RoutineKind })}
              />
            </DetailFieldRow>
            <DetailFieldRow label="Template title" inCard>
              <InlineFieldInput
                value={editor.task_template.title}
                onChange={(event) => setEditor({
                  ...editor,
                  task_template: { ...editor.task_template, title: event.target.value },
                })}
                className="w-[220px]"
              />
            </DetailFieldRow>
            <DetailFieldRow label="Project" inCard>
              <InlineFieldInput
                value={editor.task_template.project || ""}
                onChange={(event) => setEditor({
                  ...editor,
                  task_template: { ...editor.task_template, project: event.target.value },
                })}
                className="w-[180px]"
              />
            </DetailFieldRow>
            <DetailFieldRow label="Category" inCard>
              <InlineFieldInput
                value={editor.task_template.category || ""}
                onChange={(event) => setEditor({
                  ...editor,
                  task_template: { ...editor.task_template, category: event.target.value },
                })}
                className="w-[180px]"
              />
            </DetailFieldRow>
            <div className="p-3">
              <label className="mb-1.5 block text-[13px] text-[rgba(39,37,30,0.55)]">Task template notes</label>
              <DetailTextarea
                value={editor.task_template.notes || ""}
                onChange={(event) => setEditor({
                  ...editor,
                  task_template: { ...editor.task_template, notes: event.target.value },
                })}
                placeholder="Generated task notes or AI prompt context..."
                rows={3}
              />
            </div>
          </DetailCard>
        ) : null}
      </div>
    </div>
  );
}
