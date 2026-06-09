"use client";

import { GeistSans } from "geist/font/sans";
import Image from "next/image";
import {
  ArrowUp,
  AudioLines,
  CalendarDays,
  CalendarIcon,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Paperclip,
  Plug2,
  Plus,
  Settings,
  TableProperties,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type SVGProps } from "react";

const PREVIEW_WIDTH = 1080;
const PREVIEW_HEIGHT = 600;
const MUTED_WINDOW_DOT = "#CFCFCD";

const metrics = [
  ["Sleep Duration", "1,454.08 Hours"],
  ["Computer Time", "470.38 Hours"],
  ["Workout", "155.15 Hours"],
  ["Screen Time", "345.76 Hours"],
  ["Spending", "10,580.50 Dollars"],
  ["Daily Steps", "22,429,107 Steps"],
  ["Daily Walk", "430.42 Miles"],
  ["Coding", "852.19 Hours"],
  ["Daily Reading", "4,502 Pages"],
  ["Caffeine", "23,750 MG"],
  ["Heart Rate", "105 BPM"],
  ["Nicotine", "334 MG"],
  ["Car Miles", "2,515.70 Miles"],
];

export const ritualSidebarNavItems = [
  { label: "Index", icon: IndexIcon },
  { label: "Logs", icon: TableProperties },
  { label: "Calendar", icon: CalendarDays },
  { label: "Reports", icon: ReportsIcon },
  { label: "Experiments", icon: FlaskConical },
  { label: "Integrations", icon: Plug2 },
  { label: "Settings", icon: Settings },
] as const;

function ReportsIcon({
  strokeWidth: _strokeWidth,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <g transform="translate(10 10) scale(1.16) translate(-10 -10)">
        <path d="M6.875 14.7916H13.125V13.5416H6.875V14.7916ZM6.875 11.4583H13.125V10.2083H6.875V11.4583ZM3.75 17.9166V2.08331H11.875L16.25 6.45831V17.9166H3.75ZM11.25 7.08331V3.33331H5V16.6666H15V7.08331H11.25Z" />
      </g>
    </svg>
  );
}

function WindowTrafficLights({
  size = 10,
  gap = 6,
  className = "",
}: {
  size?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center ${className}`} style={{ gap }}>
      {Array.from({ length: 3 }).map((_, index) => (
        <span
          key={index}
          className="block shrink-0 rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: MUTED_WINDOW_DOT,
            boxShadow: "inset 0 0 0 0.5px rgba(0, 0, 0, 0.08)",
          }}
          aria-hidden
        />
      ))}
    </div>
  );
}

const comparisonData = [
  { metric: "Coding", thisWeek: "18.4h", avg: "14.2h", change: "+30%", positive: true },
  { metric: "Phone Screen Time", thisWeek: "3.2h/d", avg: "4.1h/d", change: "-22%", positive: true },
  { metric: "Reading", thisWeek: "86 pgs", avg: "62 pgs", change: "+39%", positive: true },
  { metric: "Spending", thisWeek: "$847", avg: "$1,040", change: "-19%", positive: true },
  { metric: "Computer Time", thisWeek: "52.3h", avg: "48.1h", change: "+8%", positive: true },
  { metric: "Caffeine", thisWeek: "475mg/d", avg: "390mg/d", change: "+22%", positive: false },
];

type ViewMode = "Chat" | "Overview" | "Metrics";

export function IndexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 6h6M12 6v12M9 18h6" />
    </svg>
  );
}

function WhoopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 39 39"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M18.744 35.678c-9.33 0-16.893-7.563-16.893-16.894 0-9.33 7.563-16.893 16.893-16.893 9.33 0 16.893 7.563 16.893 16.893 0 9.33-7.563 16.894-16.893 16.894zm9.4-24.086h1.943l-4.985 16.389h-1.944l-3.102-10.198h1.943l2.132 7.004 4.013-13.194zm-14.9 10.194l-3.101-10.195H8.2l3.1 10.195h1.944zm4.928-10.194l-4.987 16.389h1.943l4.987-16.389h-1.943zm.649 26.049c10.394 0 18.82-8.426 18.82-18.821C37.64 8.427 29.215 0 18.82 0S0 8.426 0 18.82s8.426 18.821 18.82 18.821z"
        transform="translate(.73 .541)"
      />
    </svg>
  );
}

function PlaidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-2 -2 48 52" xmlns="http://www.w3.org/2000/svg" fill="currentColor" {...props}>
      <path d="M18.637 0L4.09 3.81.081 18.439l5.014 5.148L0 28.65l3.773 14.693 14.484 4.047 5.096-5.064 5.014 5.147 14.547-3.81 4.008-14.63-5.013-5.146 5.095-5.063L43.231 4.13 28.745.083l-5.094 5.063L18.637 0zM9.71 6.624l7.663-2.008 3.351 3.44-4.887 4.856L9.71 6.624zm16.822 1.478l3.405-3.383 7.63 2.132-6.227 6.187-4.808-4.936zM4.672 17.238l2.111-7.705 6.125 6.288-4.886 4.856-3.35-3.44zm29.547-1.243l6.227-6.189 1.986 7.74-3.404 3.384-4.809-4.935zm-15.502-.127l4.887-4.856 4.807 4.936-4.886 4.856-4.808-4.936zm-7.814 7.765l4.886-4.856 4.81 4.936-4.888 4.856-4.808-4.936zm15.503.127l4.886-4.856L36.1 23.84l-4.887 4.856-4.807-4.936zM4.57 29.927l3.406-3.385 4.807 4.937-6.225 6.186-1.988-7.738zm14.021 1.598l4.887-4.856 4.808 4.936-4.886 4.856-4.809-4.936zm15.502.128l4.887-4.856 3.351 3.439-2.11 7.705-6.128-6.288zm-24.656 8.97l6.226-6.189 4.81 4.936-3.406 3.385-7.63-2.133zm16.843-1.206l4.886-4.856 6.126 6.289-7.662 2.007-3.35-3.44z" />
    </svg>
  );
}

function AppleLogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 384 512" xmlns="http://www.w3.org/2000/svg" fill="currentColor" {...props}>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-62.1 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function TrafficLights() {
  return <WindowTrafficLights size={10} gap={6} className="shrink-0" />;
}

function ViewModeToggle({
  activeView,
  onChange,
  compact = false,
}: {
  activeView: ViewMode;
  onChange: (view: ViewMode) => void;
  compact?: boolean;
}) {
  const views: ViewMode[] = ["Chat", "Overview", "Metrics"];

  return (
    <div
      className={`inline-flex items-center rounded-[7px] bg-[#F0F0F0]/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ${
        compact ? "p-[2px]" : "p-[3px]"
      }`}
    >
      {views.map((view) => {
        const isActive = activeView === view;
        return (
          <button
            key={view}
            type="button"
            onClick={() => onChange(view)}
            className={`flex items-center justify-center rounded-[5px] leading-none transition-all duration-150 ${
              compact ? "h-[18px] px-[8px] text-[8.5px]" : "h-[20px] px-[10px] text-[9.5px]"
            } ${
              isActive
                ? "bg-white font-medium text-[#27251E] shadow-[0_1px_4px_rgba(0,0,0,0.09)]"
                : "bg-transparent font-normal text-[rgba(39,37,30,0.68)] hover:bg-white/40 hover:text-[#27251E]"
            }`}
          >
            {view}
          </button>
        );
      })}
    </div>
  );
}

function ChatComposer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`mx-auto rounded-sm border border-[#DDDAD4] bg-[#FBFBFA] ${compact ? "w-full" : "w-[94%]"}`}>
      <div className={`relative px-[12px] py-[10px] ${compact ? "h-[54px]" : "h-[70px]"}`}>
        <p className={`font-normal text-[#9FA5AE] ${compact ? "text-[9px] leading-[12px]" : "text-[11px] leading-[14px]"}`}>
          Log anything...
        </p>
        <div className="absolute bottom-[6px] left-[12px] right-[12px] flex items-center gap-[8px]">
          <div className="flex items-center gap-[5px]">
            <span className={`relative shrink-0 rounded-full bg-[#D1D5DB] ${compact ? "h-[10px] w-[18px]" : "h-[12px] w-[22px]"}`} aria-hidden="true">
              <span className={`absolute left-[1px] top-[1px] rounded-full bg-white shadow-[0_0.5px_1px_rgba(39,37,30,0.15)] ${compact ? "h-[8px] w-[8px]" : "h-[10px] w-[10px]"}`} />
            </span>
            <span className={`font-normal text-[#6B7280] ${compact ? "text-[8px]" : "text-[10px]"}`}>Log</span>
          </div>
          <AudioLines className={`flex-shrink-0 text-[#68707D] stroke-[2] ${compact ? "h-[10px] w-[10px]" : "h-[12px] w-[12px]"}`} />
          <Paperclip className={`flex-shrink-0 text-[#68707D] stroke-[2] ${compact ? "h-[9px] w-[9px]" : "h-[11px] w-[11px]"}`} />
          <button type="button" className={`ml-auto flex flex-shrink-0 items-center justify-center rounded-sm bg-[#14130F] text-white shadow-[0_1px_2px_rgba(0,0,0,0.16)] ${compact ? "h-[18px] w-[18px]" : "h-[21px] w-[21px]"}`} aria-label="Submit">
            <ArrowUp className={`stroke-[2.45] ${compact ? "h-[9px] w-[9px]" : "h-[11px] w-[11px]"}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectedDevicesBar({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`mx-auto flex justify-end pr-[2px] ${compact ? "mt-[2px] w-full" : "w-[94%]"}`}>
      <button type="button" className={`inline-flex items-center gap-[2px] leading-none text-[#737373] ${compact ? "h-[10px] text-[7.5px]" : "h-[12px] text-[9px]"}`}>
        <span>Connect devices</span>
        <ChevronRight className="h-[6.5px] w-[6.5px] text-[#737373]" strokeWidth={2.4} />
        <span className="inline-flex h-[12px] items-center gap-[0.5px] pl-[0.5px] text-[#111111]">
          <span className="flex h-[8px] w-[8px] items-center justify-center">
            <WhoopIcon className="h-[7.7px] w-[7.7px]" aria-hidden="true" />
          </span>
          <span className="flex h-[8px] w-[8px] items-center justify-center">
            <PlaidIcon className="h-[6.6px] w-[6.6px]" aria-hidden="true" />
          </span>
          <span className="flex h-[8px] w-[8px] items-center justify-center">
            <AppleLogoIcon className="relative top-[-0.4px] h-[7.1px] w-[7.1px]" aria-hidden="true" />
          </span>
        </span>
      </button>
    </div>
  );
}

function ComparisonTable({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="w-full space-y-2">
        {comparisonData.map((row) => (
          <div
            key={row.metric}
            className="rounded-[4px] border border-[#E3E1DD] bg-[#FBFBFA] px-2.5 py-2 text-[10px] leading-[14px] shadow-[0_1px_0_rgba(255,255,255,0.75)]"
          >
            <div className="font-medium text-[#27251E]">{row.metric}</div>
            <div className="mt-1 flex items-center justify-between gap-3 text-[#736F68]">
              <span>
                {row.thisWeek} <span className="text-[#938F88]">vs {row.avg}</span>
              </span>
              <span className={`shrink-0 font-medium ${row.positive ? "text-[#1E7E34]" : "text-[#C62828]"}`}>
                {row.change}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const textSize = "text-[8.5px] leading-[12px]";
  const headerSize = "text-[8px] leading-[10px]";

  return (
    <div className={`w-full overflow-hidden rounded-[4px] border border-[#E3E1DD] bg-[#FBFBFA] font-normal shadow-[0_1px_0_rgba(255,255,255,0.75)] ${textSize}`}>
      <div className={`flex border-b border-[#E5E3DF] bg-[#F0F0F0] px-[6px] py-[2px] text-[#85817A] ${headerSize}`}>
        <span className="w-[35%] shrink-0">Metric</span>
        <span className="w-[22%] shrink-0">This week</span>
        <span className="w-[25%] shrink-0">30d avg</span>
        <span className="w-[14%] shrink-0 text-right">Change</span>
      </div>
      {comparisonData.map((row) => (
        <div key={row.metric} className="flex border-b border-[#EDEBE7] px-[6px] py-[1.5px] text-[#736F68] last:border-b-0">
          <span className="w-[35%] shrink-0">{row.metric}</span>
          <span className="w-[22%] shrink-0">{row.thisWeek}</span>
          <span className="w-[25%] shrink-0 text-[#938F88]">{row.avg}</span>
          <span className={`w-[14%] shrink-0 text-right font-normal ${row.positive ? "text-[#1E7E34]" : "text-[#C62828]"}`}>
            {row.change}
          </span>
        </div>
      ))}
    </div>
  );
}

function AIChatPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex h-full flex-col overflow-hidden bg-[#FEFEFE] ${compact ? "px-[10px] pb-[4px] pt-[8px]" : "px-[14px] pb-[6px] pt-[10px]"}`}>
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${compact ? "gap-[6px]" : "gap-[8px]"} pt-[2px]`}>
        <div className="flex justify-end">
          <div className={`rounded-[10px] rounded-br-[2px] bg-[#F0F0F0] px-[9px] py-[4px] font-medium leading-[140%] text-[#27251E] ${compact ? "text-[10px]" : "text-[9.5px]"}`}>
            What patterns do you see this week?
          </div>
        </div>
        <div className={`flex flex-col leading-[135%] text-[#737373] ${compact ? "text-[9px]" : "text-[8.5px]"}`}>
          <p>Read Computer Time, Coding, Screen Time, Reading, Spending, Caffeine, Sleep</p>
          <p>Thought 4s</p>
        </div>
        <div className={`flex flex-col gap-[3px] leading-[145%] text-[#625F59] ${compact ? "text-[10.5px]" : "text-[10px]"}`}>
          <p>Your week shifted toward deliberate work.</p>
          {compact ? (
            <p>Coding was up 30%, while phone screen time fell 22% and spending dropped 19%.</p>
          ) : (
            <>
              <p>Coding was up 30%, while phone screen time fell 22% and spending dropped 19%. Computer time only increased slightly, which suggests this was not just more screen time. It was a different use of time.</p>
              <p>Reading also increased 39%, making the broader pattern look like less passive consumption and more intentional behavior.</p>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <div className={`rounded-[10px] rounded-br-[2px] bg-[#F0F0F0] px-[9px] py-[4px] font-medium leading-[140%] text-[#27251E] ${compact ? "text-[10px]" : "text-[9.5px]"}`}>
            Compare this to my normal baseline
          </div>
        </div>
        {!compact ? (
          <div className="flex flex-col text-[8.5px] leading-[135%] text-[#737373]">
            <p>Read all metrics - 30 day window</p>
            <p>Thought 8s</p>
          </div>
        ) : null}
        <ComparisonTable compact={compact} />
        {!compact ? (
          <>
            <div className="flex flex-col gap-[2px] text-[10px] leading-[145%] text-[#625F59]">
              <p>The strongest signal is substitution: low-signal time went down while deliberate activities went up.</p>
              <p>The only thing worth watching is caffeine. It rose alongside coding time, which may be helping focus or becoming the cost of sustaining longer work blocks.</p>
            </div>

            <div className="flex justify-end">
              <div className="rounded-[10px] rounded-br-[2px] bg-[#F0F0F0] px-[9px] py-[4px] text-[9.5px] font-medium leading-[140%] text-[#27251E]">
                What should I test next week?
              </div>
            </div>
            <div className="flex flex-col text-[8.5px] leading-[135%] text-[#737373]">
              <p>Thought 3s</p>
            </div>
            <div className="flex flex-col gap-[2px] text-[10px] leading-[145%] text-[#625F59]">
              <p>Try keeping coding time above 18 hours while capping caffeine after 2 PM. If sleep and next-day focus stay stable, the pattern may be sustainable.</p>
              <p>If they drop, the productivity gain may be borrowing from recovery. The goal is not to optimize one metric. It is to understand the tradeoff between focus, recovery, and attention.</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MetricsList({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="mx-auto grid w-fit max-w-full grid-cols-[max-content_max-content] items-center gap-x-1.5 gap-y-0.5 px-1">
        {metrics.map(([label, rawValue]) => {
          const splitAt = rawValue.lastIndexOf(" ");
          const value = splitAt === -1 ? rawValue : rawValue.slice(0, splitAt);
          const unit = splitAt === -1 ? "" : rawValue.slice(splitAt + 1);

          return (
            <Fragment key={label}>
              <span className="whitespace-nowrap text-left text-[10px] font-normal leading-[1.02] text-[#111827]">
                {label}
              </span>
              <span className="whitespace-nowrap text-right text-[10px] font-normal leading-[1.02] text-[#111827]">
                <span className="tabular-nums">{value}</span>
                {unit ? <span className="ml-0.5">{unit}</span> : null}
              </span>
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[252px] flex-col self-center">
      {metrics.map(([label, value]) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-[4px] py-[1px] text-[11.8px] font-medium leading-[15.5px]"
        >
          <span className="shrink-0 text-[#27251E]">{label}</span>
          <span className="shrink-0 text-right text-[#1E1C17]">{value}</span>
        </div>
      ))}
    </div>
  );
}

function DashboardPreviewCompact() {
  const [activeView, setActiveView] = useState<ViewMode>("Overview");
  const [activeNav, setActiveNav] = useState("Index");

  return (
    <div
      className={`relative mx-auto w-full overflow-hidden rounded-[12px] border border-[#E6E6E3] bg-white text-[#27251E] shadow-[0_28px_70px_-30px_rgba(39,37,30,0.42),0_10px_24px_-18px_rgba(39,37,30,0.28)] ${GeistSans.variable}`}
      aria-label="Ritual desktop dashboard preview"
    >
      <div className="overflow-hidden bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
        <div className="flex h-8 w-full flex-shrink-0 items-center border-b border-[#E4E2DE] bg-[#FBFBFA] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <TrafficLights />
          <div className="flex flex-1 justify-center">
            <span className="text-[12px] font-normal leading-4 text-[#68645E]">Ritual Desktop</span>
          </div>
          <div className="w-10 shrink-0" />
        </div>

        <div className="flex min-h-[378px] overflow-hidden bg-[#FEFEFE]">
          <aside className="flex w-[48px] shrink-0 flex-col border-r border-[#E4E2DE] bg-[#FEFEFE] py-3">
            <nav className="flex flex-col gap-[10px] pt-[18px]">
              {ritualSidebarNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.label;
                const isReports = item.label === "Reports";
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveNav(item.label)}
                    className="flex h-[18px] items-center justify-center"
                    aria-label={item.label}
                  >
                    <Icon
                      className={`${isReports ? "h-[12px] w-[12px]" : "h-[11.5px] w-[11.5px]"} ${isActive ? "text-[#111111]" : "text-[#666666]"}`}
                      strokeWidth={isReports ? undefined : isActive ? 2.3 : 2.1}
                    />
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-[#FEFEFE]">
            <div className="flex shrink-0 items-center justify-center border-b border-transparent px-3 py-[7px]">
              <ViewModeToggle activeView={activeView} onChange={setActiveView} compact />
            </div>

            {activeView === "Overview" ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col justify-start px-3 pb-2 pt-5">
                  <MetricsList compact />
                </div>
                <div className="mt-auto shrink-0 px-3 pb-2.5 pt-2">
                  <ChatComposer compact />
                  <ConnectedDevicesBar compact />
                </div>
              </>
            ) : null}

            {activeView === "Chat" ? (
              <div className="h-[260px] min-h-0 overflow-hidden">
                <AIChatPanel compact />
              </div>
            ) : null}

            {activeView === "Metrics" ? (
              <div className="max-h-[320px] min-h-0 overflow-y-auto px-3 pb-3 pt-1">
                <ComparisonTable compact />
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

export function DashboardPreviewWindow({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <DashboardPreviewCompact />;
  }

  return <DashboardPreviewScaled />;
}

export function LandingHeroPreviewWindow() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#fafaf9]">
      <Image
        src="/images/river-hero-1300x720.jpg"
        alt=""
        fill
        sizes="640px"
        className="object-cover object-center"
        draggable={false}
      />
      <div className="absolute inset-0 bg-white/15" aria-hidden="true" />
      <div className="absolute left-1/2 top-[20px] w-[560px] -translate-x-1/2">
        <DashboardPreviewWindow />
      </div>
    </div>
  );
}

function DashboardPreviewScaled() {
  const [activeView, setActiveView] = useState<ViewMode>("Overview");
  const [activeNav, setActiveNav] = useState("Index");
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;

    const updateScale = () => {
      setPreviewScale(node.clientWidth / PREVIEW_WIDTH);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const scaledWindowStyle = {
    transform: `scale(${previewScale})`,
    transformOrigin: "top left",
    fontFamily: "var(--font-geist-sans), system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  } satisfies CSSProperties;

  return (
    <div
      ref={previewRef}
      className={`relative mx-auto aspect-[1080/600] w-full overflow-hidden rounded-[12px] border border-[#E6E6E3] bg-white text-[#27251E] shadow-[0_28px_70px_-30px_rgba(39,37,30,0.42),0_10px_24px_-18px_rgba(39,37,30,0.28)] ${GeistSans.variable}`}
      aria-label="Ritual desktop dashboard preview"
    >
      <div
        className="group/ritual-window h-[600px] w-[1080px] overflow-hidden bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
        style={scaledWindowStyle}
      >
        {/* Title bar */}
        <div className="flex h-[32px] w-full flex-shrink-0 items-center border-b border-[#E4E2DE] bg-[#FBFBFA] px-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          <TrafficLights />
          <div className="flex flex-1 justify-center">
            <span className="text-[12px] font-normal leading-[16px] text-[#68645E]">Ritual Desktop</span>
          </div>
          <div className="w-[52px] shrink-0" />
        </div>

        <div className="flex h-[568px] overflow-hidden bg-[#FEFEFE]">
          {/* Sidebar */}
          <aside className="relative flex w-[166px] flex-shrink-0 flex-col border-r border-[#E4E2DE] bg-[#FEFEFE] px-[14px] py-[16px]">
            <nav className="flex flex-col gap-[12px] pt-[29px]">
              {ritualSidebarNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.label;
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActiveNav(item.label)}
                    className="group flex h-[24px] cursor-pointer items-center gap-[11px] px-[6px] text-left transition-colors"
                  >
                    <Icon
                      className={`h-[15px] w-[15px] flex-shrink-0 transition-colors ${isActive ? "text-[#27251E]" : "text-[#34322D] group-hover:text-[#27251E]"}`}
                      strokeWidth={isActive ? 2.35 : 2.15}
                    />
                    <span className={`text-[12.5px] font-medium leading-[15px] transition-colors ${isActive ? "text-[#27251E]" : "text-[#66635E] group-hover:text-[#27251E]"}`}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Center panel */}
          <main className="flex flex-[0.9] flex-col border-r border-[#E4E2DE] bg-[#FEFEFE]">
            {/* Top bar */}
            <div className="flex items-center justify-between px-[20px] py-[8px]">
              <button type="button" className="flex h-[20px] items-center gap-[4px] rounded-[3px] border border-[#E2E0DC] bg-[#FEFEFE] px-[6px] py-[1px] text-[9.5px] font-medium leading-[12px] text-[#525A65] shadow-[0_1px_2px_rgba(39,37,30,0.05)]">
                Search
                <kbd className="inline-flex h-[14px] items-center gap-[2px] rounded-[2px] border border-[#E1DFDA] bg-[#F0F0EEE6] px-[3px] py-[1px] text-[8px] font-normal leading-[10px] text-[#6B7280]">
                  <span>⌘</span>K
                </kbd>
              </button>

              <ViewModeToggle activeView={activeView} onChange={setActiveView} />

              <div className="flex items-center gap-[4px]">
                <button type="button" className="flex h-[20px] w-[20px] items-center justify-center rounded-[3px] border border-[#E2E0DC] bg-[#FEFEFE] text-[#525A65] shadow-[0_1px_2px_rgba(39,37,30,0.05)]">
                  <Plus className="h-[9px] w-[9px] text-[#6B7280]" strokeWidth={2.2} />
                </button>
                <button type="button" className="flex h-[20px] items-center gap-[4px] rounded-[3px] border border-[#E2E0DC] bg-[#FEFEFE] px-[6px] py-[1px] text-[9.5px] font-medium leading-[12px] text-[#525A65] shadow-[0_1px_2px_rgba(39,37,30,0.05)]">
                  <CalendarIcon className="h-[9px] w-[9px]" strokeWidth={2.2} />
                  All time
                  <ChevronDown className="h-[8px] w-[8px]" strokeWidth={2.4} />
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div className="flex flex-1 flex-col justify-start px-[28px] py-[37px]">
              <MetricsList />
            </div>

            {/* Bottom section */}
            <div className="mt-auto flex flex-col gap-[2px] px-[20px] pb-[6px] pt-[10px]">
              <ChatComposer />
              <ConnectedDevicesBar />
            </div>
          </main>

          {/* Right AI Chat panel */}
          <aside className="flex flex-[0.7] flex-col overflow-hidden bg-[#FEFEFE]">
            <AIChatPanel />
          </aside>
        </div>
      </div>
    </div>
  );
}
