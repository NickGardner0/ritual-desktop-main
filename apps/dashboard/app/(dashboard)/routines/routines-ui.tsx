"use client";

import {
  BriefcaseBusiness,
  CalendarClock,
  FlaskConical,
  GitPullRequest,
  HeartPulse,
  History,
  Inbox,
  MailPlus,
  MonitorCheck,
  PenLine,
  Radar,
  Sparkles,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { Switch } from "@/components/ui/switch";
import { dateFromInput, dateInputValue } from "@/lib/tasks/date-format";
import { WEEKDAYS } from "@/lib/tasks/routine-editor";
import { triggerDefaults } from "@/lib/tasks/routine-editor";
import type { AiRoutineTemplate } from "@/lib/tasks/ai-routine-templates";
import {
  FieldGroup,
  FieldRow,
  InlineControl,
  InlineSelect,
} from "@/lib/tasks/reference-task-shell";
import type { Routine, RoutineKind, RoutineRun, RoutineTriggerType } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

export const TRIGGERS: RoutineTriggerType[] = ["daily", "weekly", "monthly", "yearly", "on_completion"];
export const KIND_OPTIONS: Array<{ id: RoutineKind; label: string }> = [
  { id: "task", label: "task" },
  { id: "ai_workflow", label: "ai report" },
  { id: "habit_prompt", label: "log prompt" },
  { id: "mixed", label: "experiment check-in" },
  { id: "calendar_block", label: "calendar block" },
];

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
  return trigger === "on_completion" ? "on completion" : trigger;
}

export function runOutputType(run: RoutineRun) {
  if (run.generated_task_id) return "task";
  if (run.generated_scheduled_block_id) return "note";
  if (run.workflow_run_id) return "report";
  return run.status === "failed" ? "prompt" : "none";
}

export function runStatusClass(status: RoutineRun["status"]) {
  if (status === "failed") return "text-[#a1493b]";
  if (status === "skipped") return "text-[#956d2c]";
  if (status === "completed" || status === "generated") return "text-[#1f6c47]";
  return "text-[#65707c]";
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

export function RoutineRecurrenceFields({
  editor,
  setEditor,
  updateConfig,
  editorTimeValue,
  completionPreview,
}: {
  editor: Routine;
  setEditor: Dispatch<SetStateAction<Routine | null>>;
  updateConfig: (patch: Record<string, unknown>) => void;
  editorTimeValue: string;
  completionPreview: string | null;
}) {
  return (
    <>
      <FieldGroup>
        <FieldRow label="Kind">
          <InlineSelect
            value={editor.kind}
            onChange={(event) => setEditor({ ...editor, kind: event.target.value as RoutineKind })}
            className="w-[190px]"
          >
            {KIND_OPTIONS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </InlineSelect>
        </FieldRow>
        <FieldRow label="Trigger">
          <InlineSelect
            value={editor.trigger_type}
            onChange={(event) => {
              const trigger = event.target.value as RoutineTriggerType;
              setEditor({ ...editor, trigger_type: trigger, trigger_config: triggerDefaults(trigger) });
            }}
            className="w-[190px]"
          >
            {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{triggerLabel(trigger)}</option>)}
          </InlineSelect>
        </FieldRow>
        <FieldRow label="Paused">
          <Switch
            checked={editor.status === "paused"}
            onCheckedChange={(checked) => setEditor({ ...editor, status: checked ? "paused" : "scheduled" })}
          />
        </FieldRow>
      </FieldGroup>

      <FieldGroup>
        <FieldRow label={editor.trigger_type === "on_completion" ? "Repeat" : "Every"}>
          <InlineControl
            type="number"
            min={1}
            value={Number(editor.trigger_config.interval || 1)}
            onChange={(event) => updateConfig({ interval: Number(event.target.value) || 1 })}
            className="w-16 text-right"
          />
          {editor.trigger_type === "on_completion" ? (
            <>
              <InlineSelect
                value={String(editor.trigger_config.unit || "weeks")}
                onChange={(event) => updateConfig({ unit: event.target.value })}
                className="w-[104px]"
              >
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </InlineSelect>
              <span className="text-[13px] font-[650] text-[#6a717b]">after completion</span>
            </>
          ) : (
            <span className="text-[13px] font-[650] text-[#6a717b]">
              {editor.trigger_type === "daily" ? "days" : editor.trigger_type === "weekly" ? "weeks" : editor.trigger_type === "monthly" ? "months" : "years"}
            </span>
          )}
        </FieldRow>
        <FieldRow label="Time">
          <InlineControl
            type="time"
            value={editorTimeValue}
            onChange={(event) => {
              const [hour, minute] = event.target.value.split(":").map(Number);
              updateConfig({ hour, minute });
            }}
            className="w-[128px]"
          />
        </FieldRow>
        {completionPreview ? (
          <FieldRow label="Completion preview">
            <span className="max-w-[360px] truncate text-[13px] font-[650] text-[#737b86]">{completionPreview}</span>
          </FieldRow>
        ) : null}
        {editor.kind === "calendar_block" || editor.kind === "mixed" ? (
          <FieldRow label="Block duration">
            <InlineControl
              type="number"
              min={5}
              max={720}
              value={Number(editor.trigger_config.duration_minutes || 60)}
              onChange={(event) => updateConfig({ duration_minutes: Number(event.target.value) || 60 })}
              className="w-20 text-right"
            />
            <span className="text-[13px] font-[650] text-[#6a717b]">minutes</span>
          </FieldRow>
        ) : null}
        {editor.trigger_type === "weekly" ? (
          <FieldRow label="Weekdays">
            <span className="flex flex-wrap justify-end gap-1.5">
              {WEEKDAYS.map((day) => {
                const weekdays = Array.isArray(editor.trigger_config.weekdays) ? editor.trigger_config.weekdays.map(Number) : [];
                const active = weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => updateConfig({
                      weekdays: active ? weekdays.filter((value) => value !== day.value) : [...weekdays, day.value].sort(),
                    })}
                    className={cn(
                      "h-7 rounded-[6px] px-2 text-[12px] font-[700]",
                      active ? "bg-[#111827] text-white" : "bg-white/86 text-[#626a75] hover:bg-white",
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </span>
          </FieldRow>
        ) : null}
        {editor.trigger_type === "monthly" || editor.trigger_type === "yearly" ? (
          <>
            <FieldRow label="Mode">
              <InlineSelect
                value={String(editor.trigger_config.mode || "day_of_month")}
                onChange={(event) => updateConfig({ mode: event.target.value })}
                className="w-[190px]"
              >
                <option value="day_of_month">day of month</option>
                <option value="nth_weekday">nth weekday</option>
              </InlineSelect>
            </FieldRow>
            {editor.trigger_type === "yearly" ? (
              <FieldRow label="Month">
                <InlineSelect
                  value={Number(editor.trigger_config.month || 1)}
                  onChange={(event) => updateConfig({ month: Number(event.target.value) })}
                  className="w-[156px]"
                >
                  {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </InlineSelect>
              </FieldRow>
            ) : null}
            {editor.trigger_config.mode === "nth_weekday" ? (
              <FieldRow label="When">
                <InlineSelect
                  value={Number(editor.trigger_config.ordinal || 1)}
                  onChange={(event) => updateConfig({ ordinal: Number(event.target.value) })}
                  className="w-[116px]"
                >
                  {ORDINALS.map((ordinal) => <option key={ordinal.value} value={ordinal.value}>{ordinal.label}</option>)}
                </InlineSelect>
                <InlineSelect
                  value={Number(editor.trigger_config.weekday || 0)}
                  onChange={(event) => updateConfig({ weekday: Number(event.target.value) })}
                  className="w-[132px]"
                >
                  {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                </InlineSelect>
              </FieldRow>
            ) : (
              <FieldRow label="Day">
                <InlineControl
                  type="number"
                  min={1}
                  max={31}
                  value={Number(editor.trigger_config.day || 1)}
                  onChange={(event) => updateConfig({ day: Number(event.target.value) || 1 })}
                  className="w-20 text-right"
                />
              </FieldRow>
            )}
          </>
        ) : null}
        <FieldRow label="First run">
          <InlineControl
            type="date"
            value={dateInputValue(editor.first_run_at)}
            onChange={(event) => setEditor({ ...editor, first_run_at: dateFromInput(event.target.value) })}
            className="w-[150px]"
          />
        </FieldRow>
        <FieldRow label="Ends">
          <InlineControl
            type="date"
            value={dateInputValue(editor.ends_at)}
            onChange={(event) => setEditor({ ...editor, ends_at: dateFromInput(event.target.value) })}
            className="w-[150px]"
          />
        </FieldRow>
      </FieldGroup>
    </>
  );
}
