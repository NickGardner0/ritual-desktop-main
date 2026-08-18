import type React from "react";
import {
  CalendarDays,
  ChartNoAxesCombined,
  FlaskConical,
  MousePointerClick,
  Plug2,
  Repeat2,
  TableProperties,
} from "lucide-react";

export type SidebarIconProps = React.SVGProps<SVGSVGElement>;

export const SidebarIndexIcon = ({ strokeWidth = 2.1, ...props }: SidebarIconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    strokeWidth={strokeWidth}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path
      d="M9 6h6M12 6v12M9 18h6"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

export const SidebarReportIcon = ({
  strokeWidth: _strokeWidth,
  ...props
}: SidebarIconProps) => (
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

export const SidebarMetricIcon = (props: SidebarIconProps) => <ChartNoAxesCombined {...props} />;
export const SidebarLogIcon = (props: SidebarIconProps) => <TableProperties {...props} />;
export const SidebarTaskIcon = (props: SidebarIconProps) => <MousePointerClick {...props} />;
export const SidebarCalendarIcon = (props: SidebarIconProps) => <CalendarDays {...props} />;
export const SidebarRoutineIcon = (props: SidebarIconProps) => <Repeat2 {...props} />;
export const SidebarExperimentIcon = (props: SidebarIconProps) => <FlaskConical {...props} />;
export const SidebarIntegrationIcon = (props: SidebarIconProps) => <Plug2 {...props} />;

export const SIDEBAR_ICONS = {
  "/dashboard": SidebarIndexIcon,
  "/dashboard?view=metrics": SidebarMetricIcon,
  "/tasks": SidebarTaskIcon,
  "/activity": SidebarLogIcon,
  "/calendar": SidebarCalendarIcon,
  "/reports": SidebarReportIcon,
  "/routines": SidebarRoutineIcon,
  "/analytics": SidebarMetricIcon,
  "/experiments": SidebarExperimentIcon,
  "/integrations": SidebarIntegrationIcon,
} as const;
