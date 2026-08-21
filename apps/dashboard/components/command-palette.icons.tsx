'use client';

import * as React from "react";
import dynamic from "next/dynamic";
import {
  Search,
  List,
  BarChart3,
  CalendarDays,
  Wifi,
  Bot,
  Timer,
  Focus,
  Eye,
  FileText,
  TrendingUp,
  Download,
  Plus,
  Settings,
  Upload,
  Watch,
  MessageSquare,
  Monitor,
  Activity,
  Sparkles,
  LayoutDashboard,
} from "lucide-react";

const DynamicIcon = dynamic(() => import('@/components/ui/dynamic-icon'), {
  ssr: false,
  loading: () => <LayoutDashboard className="w-4 h-4 text-gray-400" />,
});

const isEmoji = (str: string) => /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(str);

export const HabitIcon = ({ iconName, className = "w-4 h-4" }: { iconName?: string; className?: string }) => {
  if (!iconName) {
    return <LayoutDashboard className={`${className} text-gray-400`} />;
  }
  if (isEmoji(iconName)) {
    return <span className="text-base leading-none">{iconName}</span>;
  }
  return <DynamicIcon name={iconName} className={`${className} text-gray-600`} />;
};

export const commandPaletteIconMap: Record<string, React.ReactNode> = {
  "plus": <Plus className="h-4 w-4" />,
  "search": <Search className="h-4 w-4" />,
  "bar-chart": <BarChart3 className="h-4 w-4" />,
  "calendar": <CalendarDays className="h-4 w-4" />,
  "bot": <Bot className="h-4 w-4" />,
  "upload": <Upload className="h-4 w-4" />,
  "watch": <Watch className="h-4 w-4" />,
  "settings": <Settings className="h-4 w-4" />,
  "download": <Download className="h-4 w-4" />,
  "timer": <Timer className="h-4 w-4" />,
  "focus": <Focus className="h-4 w-4" />,
  "eye": <Eye className="h-4 w-4" />,
  "file": <FileText className="h-4 w-4" />,
  "trending": <TrendingUp className="h-4 w-4" />,
  "list": <List className="h-4 w-4" />,
  "wifi": <Wifi className="h-4 w-4" />,
  "message": <MessageSquare className="h-4 w-4" />,
  "monitor": <Monitor className="h-4 w-4" />,
  "activity": <Activity className="h-4 w-4" />,
  "sparkles": <Sparkles className="h-4 w-4" />,
};
