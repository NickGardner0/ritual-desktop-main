'use client';

import * as React from "react";
import { Command } from "cmdk";
import apiClient from "@/lib/api-client";
import { useState } from "react";
import { 
  // Basic Shapes & UI
  Target, Lightning, Search, Config, Cog, Grid, List, Hand, Triangle, 
  Circle, Rectangle, Hexagon, CheckSquare, XCircle, XOctagon, Dots,
  
  // Communication & Social  
  MessageDots, TelephoneIn, User, Users,
  
  // Technology & Devices
  Microphone, WifiCheck, WifiPlus, WifiSlash, BatteryChargingFour,
  
  // Health & Fitness  
  HeartCircle, HeartPlus,
  
  // Work & Productivity
  BuildingOne, CalendarDown, ClockOne, ClockEight,
  
  // Time & Scheduling
  Sunrise,
  
  // Entertainment & Lifestyle
  Music, Wine, BookCheck, BookSnooze, BookSlash,
  
  // Actions & States
  Fire, PlayCircle, PauseCircle, RewindCircle, Repeat, Like,
  
  // Weather & Nature
  Earth, Umbrella, Snow,
  
  // Travel & Transportation  
  LocationX,
  
  // Finance & Shopping
  Dollar, DollarCircle, DollarDiamond, DollarOctagon, CartPlus,
  
  // Security & Privacy
  Lock, LockOpenKeyhole, LockKeyhole, LockOctagon, LockDiamond,
  
  // Files & Documents
  FileMinus, FolderCheck, FolderSlash,
  
  // Arrows & Navigation  
  ArrowDown, ArrowUpCircle, ArrowRightSquare, ArrowLongDownRight, ArrowLongUpRight,
  ChevronDown, ChevronDoubleLeft, ChevronDoubleRight, ChevronRightSquare, ChevronUpSquare,
  Home, CornerRightUp, CornerUpRight,
  
  // Tools & Utilities
  Scissors, TrashTwo, CameraSlash, Incognito, Crosshair, Airplay,
  
  // Charts & Analytics
  ChartLine, ChartBarOne, ChartBubble, ChartGraph,
  
  // Layout & Structure
  Columns, LayersTwo, GridOne, PanelRightClose, Sidebar,
  
  // Numbers & Letters
  Zero, One, Two, Three, Four, Five, Six, Seven, Eight, Nine,
  ZeroHexagon, OneSquare, ThreeCircle, ThreeDiamond, ThreeOctagon,
  FiveCircle, FiveDiamond, FiveOctagon, SixWaves, SevenWaves, EightWaves, NineDiamond, NineOctagon,
  
  // Notifications & Alerts
  Bell, BellOn, BellHome, DangerCircle, InfoSquare,
  
  // Text & Typography
  TypeBold, TypeItalic, TextJustify, TextAlignCenter, Heading,
  
  // Media Controls
  PlayWaves, PauseDiamond, PauseOctagon, RewindHexagon,
  
  // Brands & Special
  BrandGithub, BrandGitlab, BrandCodesandbox,
  
  // Gestures & Actions
  PlusWaves, LinkTwo, Logout, ToggleRight,
  
  // Food & Drinks
  Croissant,
  
  // Devices & Signals
  MobileSignalOne,
  
  // Shapes & Geometric
  CircleHalf, SlashWaves, Path, Hexagon as HexagonShape
} from "@mynaui/icons-react";

// Add custom styles for dropdown options
const dropdownStyles = `
  .white-dropdown-options option {
    background-color: white !important;
    color: black !important;
  }
  .white-dropdown-options {
    background-color: white !important;
    color: black !important;
  }
`;

// Define habit arrays locally
const productivityHabits = [
  { value: 'deep-work', label: 'Deep Work' },
  { value: 'focus-sessions', label: 'Focus Sessions' },
  { value: 'task-completion', label: 'Task Completion' },
  { value: 'email-batching', label: 'Email Batching' },
  { value: 'time-blocking', label: 'Time Blocking' },
  { value: 'goal-setting', label: 'Goal Setting' },
  { value: 'daily-planning', label: 'Daily Planning' },
  { value: 'weekly-review', label: 'Weekly Review' },
  { value: 'inbox-zero', label: 'Inbox Zero' },
  { value: 'meeting-free-blocks', label: 'Meeting-Free Blocks' },
  { value: 'pomodoro-sessions', label: 'Pomodoro Sessions' },
  { value: 'priority-tasks', label: 'Priority Tasks' },
  { value: 'reflection-journaling', label: 'Reflection Journaling' },
  { value: 'learning-hour', label: 'Learning Hour' },
  { value: 'standup-checkin', label: 'Standup Check-in' },
  { value: 'breaks-taken', label: 'Breaks Taken' },
  { value: 'distraction-free-time', label: 'Distraction-Free Time' },
  { value: 'end-of-day-shutdown', label: 'End of Day Shutdown' }

];

const fitnessHealthHabits = [
  { value: 'morning-workout', label: 'Morning Workout' },
  { value: 'daily-walk', label: 'Daily Walk' },
  { value: 'hydration', label: 'Hydration' },
  { value: 'sleep-schedule', label: 'Sleep Schedule' },
  { value: 'meditation', label: 'Meditation' },
  { value: 'stretching', label: 'Stretching' },
];

const educationHabits = [
  { value: 'reading', label: 'Reading' },
  { value: 'learning', label: 'Learning' },
  { value: 'online-courses', label: 'Online Courses' },
  { value: 'skill-practice', label: 'Skill Practice' },
  { value: 'journaling', label: 'Journaling' },
  { value: 'research', label: 'Research' },
  { value: 'language-study', label: 'Language Study' },
  { value: 'flashcards', label: 'Flashcards/Spaced Repetition' },
  { value: 'lecture-attendance', label: 'Lecture Attendance' },
  { value: 'note-taking', label: 'Note Taking' },
  { value: 'practice-tests', label: 'Practice Tests' },
  { value: 'group-study', label: 'Group Study' },
  { value: 'project-work', label: 'Project Work' },
  { value: 'reading-summaries', label: 'Reading Summaries' },
  { value: 'problem-solving', label: 'Problem Solving' },
  { value: 'creative-writing', label: 'Creative Writing' },
  { value: 'presentation-prep', label: 'Presentation Prep' },
  { value: 'study-breaks', label: 'Study Breaks' }

];

const experimentsHabits = [
  { value: 'new-recipes', label: 'Try New Recipes' },
  { value: 'creative-projects', label: 'Creative Projects' },
  { value: 'habit-experiments', label: 'Habit Experiments' },
  { value: 'productivity-tests', label: 'Productivity Tests' },
  { value: 'wellness-trials', label: 'Wellness Trials' },
  { value: 'skill-challenges', label: 'Skill Challenges' },
  { value: 'new-supplements', label: 'Try New Supplements' },
  { value: 'new-medication', label: 'Take New Medication' },
  { value: 'cold-showers', label: 'Cold Showers' },
  { value: 'intermittent-fasting', label: 'Intermittent Fasting' },
  { value: 'sleep-schedule-experiment', label: 'Sleep Schedule Experiment' },
  { value: 'digital-detox', label: 'Digital Detox' },
  { value: 'no-caffeine', label: 'No Caffeine' },
  { value: 'no-sugar', label: 'No Sugar' },
  { value: 'new-exercise', label: 'Try New Exercise' },
  { value: 'mindfulness-practice', label: 'Mindfulness Practice' },
  { value: 'gratitude-journaling', label: 'Gratitude Journaling' },
  { value: 'screen-time-limit', label: 'Screen Time Limit' },
  { value: 'early-wake-up', label: 'Early Wake Up' }

];

// Define available MynaUI icons for habits
const AVAILABLE_ICONS = [
  // Basic Shapes & UI
  { name: 'Target', component: Target },
  { name: 'Lightning', component: Lightning },
  { name: 'Search', component: Search },
  { name: 'Config', component: Config },
  { name: 'Cog', component: Cog },
  { name: 'Grid', component: Grid },
  { name: 'List', component: List },
  { name: 'Hand', component: Hand },
  { name: 'Triangle', component: Triangle },
  { name: 'Circle', component: Circle },
  { name: 'Rectangle', component: Rectangle },
  { name: 'Hexagon', component: Hexagon },
  { name: 'CheckSquare', component: CheckSquare },
  { name: 'XCircle', component: XCircle },
  { name: 'XOctagon', component: XOctagon },
  { name: 'Dots', component: Dots },
  
  // Communication & Social
  { name: 'MessageDots', component: MessageDots },
  { name: 'TelephoneIn', component: TelephoneIn },
  { name: 'User', component: User },
  { name: 'Users', component: Users },
  
  // Technology & Devices
  { name: 'Microphone', component: Microphone },
  { name: 'WifiCheck', component: WifiCheck },
  { name: 'WifiPlus', component: WifiPlus },
  { name: 'WifiSlash', component: WifiSlash },
  { name: 'BatteryChargingFour', component: BatteryChargingFour },
  
  // Health & Fitness
  { name: 'HeartCircle', component: HeartCircle },
  { name: 'HeartPlus', component: HeartPlus },
  
  // Work & Productivity
  { name: 'BuildingOne', component: BuildingOne },
  { name: 'CalendarDown', component: CalendarDown },
  { name: 'ClockOne', component: ClockOne },
  { name: 'ClockEight', component: ClockEight },
  
  // Time & Scheduling
  { name: 'Sunrise', component: Sunrise },
  
  // Entertainment & Lifestyle
  { name: 'Music', component: Music },
  { name: 'Wine', component: Wine },
  { name: 'BookCheck', component: BookCheck },
  { name: 'BookSnooze', component: BookSnooze },
  { name: 'BookSlash', component: BookSlash },
  
  // Actions & States
  { name: 'Fire', component: Fire },
  { name: 'PlayCircle', component: PlayCircle },
  { name: 'PauseCircle', component: PauseCircle },
  { name: 'RewindCircle', component: RewindCircle },
  { name: 'Repeat', component: Repeat },
  { name: 'Like', component: Like },
  
  // Weather & Nature
  { name: 'Earth', component: Earth },
  { name: 'Umbrella', component: Umbrella },
  { name: 'Snow', component: Snow },
  
  // Travel & Transportation
  { name: 'LocationX', component: LocationX },
  
  // Finance & Shopping
  { name: 'Dollar', component: Dollar },
  { name: 'DollarCircle', component: DollarCircle },
  { name: 'DollarDiamond', component: DollarDiamond },
  { name: 'DollarOctagon', component: DollarOctagon },
  { name: 'CartPlus', component: CartPlus },
  
  // Security & Privacy
  { name: 'Lock', component: Lock },
  { name: 'LockOpenKeyhole', component: LockOpenKeyhole },
  { name: 'LockKeyhole', component: LockKeyhole },
  { name: 'LockOctagon', component: LockOctagon },
  { name: 'LockDiamond', component: LockDiamond },
  
  // Files & Documents
  { name: 'FileMinus', component: FileMinus },
  { name: 'FolderCheck', component: FolderCheck },
  { name: 'FolderSlash', component: FolderSlash },
  
  // Arrows & Navigation
  { name: 'ArrowDown', component: ArrowDown },
  { name: 'ArrowUpCircle', component: ArrowUpCircle },
  { name: 'ArrowRightSquare', component: ArrowRightSquare },
  { name: 'ArrowLongDownRight', component: ArrowLongDownRight },
  { name: 'ArrowLongUpRight', component: ArrowLongUpRight },
  { name: 'ChevronDown', component: ChevronDown },
  { name: 'ChevronDoubleLeft', component: ChevronDoubleLeft },
  { name: 'ChevronDoubleRight', component: ChevronDoubleRight },
  { name: 'ChevronRightSquare', component: ChevronRightSquare },
  { name: 'ChevronUpSquare', component: ChevronUpSquare },
  { name: 'Home', component: Home },
  { name: 'CornerRightUp', component: CornerRightUp },
  { name: 'CornerUpRight', component: CornerUpRight },
  
  // Tools & Utilities
  { name: 'Scissors', component: Scissors },
  { name: 'TrashTwo', component: TrashTwo },
  { name: 'CameraSlash', component: CameraSlash },
  { name: 'Incognito', component: Incognito },
  { name: 'Crosshair', component: Crosshair },
  { name: 'Airplay', component: Airplay },
  
  // Charts & Analytics
  { name: 'ChartLine', component: ChartLine },
  { name: 'ChartBarOne', component: ChartBarOne },
  { name: 'ChartBubble', component: ChartBubble },
  { name: 'ChartGraph', component: ChartGraph },
  
  // Layout & Structure
  { name: 'Columns', component: Columns },
  { name: 'LayersTwo', component: LayersTwo },
  { name: 'GridOne', component: GridOne },
  { name: 'PanelRightClose', component: PanelRightClose },
  { name: 'Sidebar', component: Sidebar },
  
  // Numbers
  { name: 'Zero', component: Zero },
  { name: 'One', component: One },
  { name: 'Two', component: Two },
  { name: 'Three', component: Three },
  { name: 'Four', component: Four },
  { name: 'Five', component: Five },
  { name: 'Six', component: Six },
  { name: 'Seven', component: Seven },
  { name: 'Eight', component: Eight },
  { name: 'Nine', component: Nine },
  
  // Number Variants
  { name: 'ZeroHexagon', component: ZeroHexagon },
  { name: 'OneSquare', component: OneSquare },
  { name: 'ThreeCircle', component: ThreeCircle },
  { name: 'ThreeDiamond', component: ThreeDiamond },
  { name: 'ThreeOctagon', component: ThreeOctagon },
  { name: 'FiveCircle', component: FiveCircle },
  { name: 'FiveDiamond', component: FiveDiamond },
  { name: 'FiveOctagon', component: FiveOctagon },
  { name: 'SixWaves', component: SixWaves },
  { name: 'SevenWaves', component: SevenWaves },
  { name: 'EightWaves', component: EightWaves },
  { name: 'NineDiamond', component: NineDiamond },
  { name: 'NineOctagon', component: NineOctagon },
  
  // Notifications & Alerts
  { name: 'Bell', component: Bell },
  { name: 'BellOn', component: BellOn },
  { name: 'BellHome', component: BellHome },
  { name: 'DangerCircle', component: DangerCircle },
  { name: 'InfoSquare', component: InfoSquare },
  
  // Text & Typography
  { name: 'TypeBold', component: TypeBold },
  { name: 'TypeItalic', component: TypeItalic },
  { name: 'TextJustify', component: TextJustify },
  { name: 'TextAlignCenter', component: TextAlignCenter },
  { name: 'Heading', component: Heading },
  
  // Media Controls
  { name: 'PlayWaves', component: PlayWaves },
  { name: 'PauseDiamond', component: PauseDiamond },
  { name: 'PauseOctagon', component: PauseOctagon },
  { name: 'RewindHexagon', component: RewindHexagon },
  
  // Brands
  { name: 'BrandGithub', component: BrandGithub },
  { name: 'BrandGitlab', component: BrandGitlab },
  { name: 'BrandCodesandbox', component: BrandCodesandbox },
  
  // Gestures & Actions
  { name: 'PlusWaves', component: PlusWaves },
  { name: 'LinkTwo', component: LinkTwo },
  { name: 'Logout', component: Logout },
  { name: 'ToggleRight', component: ToggleRight },
  
  // Food & Drinks
  { name: 'Croissant', component: Croissant },
  
  // Devices & Signals
  { name: 'MobileSignalOne', component: MobileSignalOne },
  
  // Shapes & Geometric
  { name: 'CircleHalf', component: CircleHalf },
  { name: 'SlashWaves', component: SlashWaves },
  { name: 'Path', component: Path }
];

// Custom Icon Dropdown Component
interface CustomIconDropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ name: string; component: React.ComponentType<any> }>;
  placeholder: string;
  enableSearch?: boolean;
}

function CustomIconDropdown({ value, onChange, options, placeholder, enableSearch }: CustomIconDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      if (typeof window !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside);
      }
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find(option => option.name === value);
  const filteredOptions = enableSearch && search
    ? options.filter(option => option.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className="relative w-64" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm bg-white rounded-none flex items-center justify-between hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {selectedOption ? (
            <>
              <selectedOption.component className="w-4 h-4" />
              <span>{selectedOption.name}</span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
        </div>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-60 overflow-auto p-0 scrollbar-thin scrollbar-track-white scrollbar-thumb-gray-300" style={{ scrollbarColor: '#d1d5db #fff' }}>
          {enableSearch && (
            <>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search icons..."
                className="w-full border-0 focus:ring-0 text-sm mb-0 bg-white outline-none shadow-none py-2 px-3"
                autoFocus
              />
              <div className="border-b border-gray-200 w-full" />
            </>
          )}
          {filteredOptions.map((option) => {
            const IconComponent = option.component;
            return (
              <button
                key={option.name}
                type="button"
                onClick={() => {
                  onChange(option.name);
                  setIsOpen(false);
                  setSearch('');
                }}
                className="w-full py-2 text-left flex items-center gap-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm px-3"
              >
                <IconComponent className="w-4 h-4 flex-shrink-0" />
                <span>{option.name}</span>
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-2 text-gray-400 text-sm">No icons found.</div>
          )}
        </div>
      )}
    </div>
  );
}

interface HabitSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHabitSelect?: (habit: any) => void;
  onHabitCreated?: (habit: any) => void; // New callback for when habit is created in backend
}

// Map frontend categories to backend categories
const categoryMap: Record<string, string> = {
  'productivity': 'manual',
  'fitness': 'manual', 
  'education': 'manual',
  'experiments': 'manual',
  'custom': 'manual'
};

// Map tracking types to unit types
const trackingTypeMap: Record<string, string> = {
  'number': 'count',
  'time': 'minutes',
  'boolean': 'boolean',
  'distance': 'distance',
  'weight': 'weight'
};

export function HabitSelectionModal({ isOpen, onClose, onHabitSelect, onHabitCreated }: HabitSelectionModalProps) {
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [selectedHabit, setSelectedHabit] = React.useState<any | null>(null);
  const [customHabit, setCustomHabit] = React.useState({
    title: '',
    icon: '',
    trackingType: ''
  });
  const [habitConfig, setHabitConfig] = React.useState({
    title: '',
    icon: '',
    emoji: '',
    metricType: '',
    targetAmount: ''
  });
  const [isCreating, setIsCreating] = useState(false);

  // Define comprehensive Apple/iPhone emoji system
  const APPLE_EMOJIS: Record<string, string[]> = {
    'Smileys & Emotion': [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'
    ],
    'People & Body': [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '🥷', '👷', '🤴', '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👼', '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴️', '👯', '🧖', '🧗', '🤺', '🏇', '⛷️', '🏂', '🏌️', '🏄', '🚣', '🏊', '⛹️', '🏋️', '🚴', '🚵', '🤸', '🤼', '🤽', '🤾', '🤹', '🧘', '🛀', '🛌', '👭', '👫', '👬', '💏', '💑', '👪'
    ],
    'Animals & Nature': [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🎋', '🍃', '🍂', '🍁', '🍄', '🐚', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '🪐', '💫', '⭐', '🌟', '✨', '⚡', '☄️', '💥', '🔥', '🌪️', '🌈', '☀️', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💧', '💦', '☔', '☂️', '🌊', '🌫️'
    ],
    'Food & Drink': [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️', '🥢', '🥡'
    ],
    'Travel & Places': [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛹', '🛼', '🚁', '🛸', '✈️', '🛩️', '🛫', '🛬', '🪂', '💺', '🚀', '🛰️', '🚢', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚟', '🚠', '🚡', '🚊', '🚝', '🚞', '🚋', '🚃', '🚂', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚱', '🎡', '🎢', '🎠', '🏗️', '🌁', '🗼', '🏭', '⛲', '🎑', '⛰️', '🏔️', '🗻', '🌋', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🏟️', '🏛️', '🏗️', '🧱', '🏘️', '🏚️', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '🗾', '🗻', '🌠', '🎆', '🎇', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁', '⛪', '🕌', '🛕', '🕍', '⛩️', '🛤️', '🛣️', '🗺️', '🗿', '🗽', '🗼', '🏛️', '🎪'
    ],
    'Activities': [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤸', '🤼', '🤽', '🤾', '🤹', '🧘', '🎪', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🕹️', '🎰', '🧩', '🃏', '🀄', '🎴', '🎊', '🎉', '🎈', '🎁', '🎀', '🪄', '🪅', '🪆', '🎗️', '🥇', '🥈', '🥉', '🏆', '🏅', '🎖️', '🏵️', '🎫', '🎟️', '🎪'
    ],
    'Objects': [
      '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🧺', '🧻', '🚽', '🚿', '🛁', '🛀', '🧼', '🪒', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🖼️', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '📇', '🗃️', '🗳️', '🗄️', '📋', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💖', '💗', '💘', '💝', '💞', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '⬛', '⬜', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'
    ],
    'Symbols': [
      '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️‍🔥', '❤️‍🩹', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍��️', '🗨️', '🗯️', '💭', '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸'
    ],
    'Flags': [
      '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇨', '🇦🇩', '🇦🇪', '🇦🇫', '🇦🇬', '🇦🇮', '🇦🇱', '🇦🇲', '🇦🇴', '🇦🇶', '🇦🇷', '🇦🇸', '🇦🇹', '🇦🇺', '🇦🇼', '🇦🇽', '🇦🇿', '🇧🇦', '🇧🇧', '🇧🇩', '🇧🇪', '🇧🇫', '🇧🇬', '🇧🇭', '🇧🇮', '🇧🇯', '🇧🇱', '🇧🇲', '🇧🇳', '🇧🇴', '🇧🇶', '🇧🇷', '🇧🇸', '🇧🇹', '🇧🇻', '🇧🇼', '🇧🇾', '🇧🇿', '🇨🇦', '🇨🇨', '🇨🇩', '🇨🇫', '🇨🇬', '🇨🇭', '🇨🇮', '🇨🇰', '🇨🇱', '🇨🇲', '🇨🇳', '🇨🇴', '🇨🇵', '🇨🇷', '🇨🇺', '🇨🇻', '🇨🇼', '🇨🇽', '🇨🇾', '🇨🇿', '🇩🇪', '🇩🇬', '🇩🇯', '🇩🇰', '🇩🇲', '🇩🇴', '🇩🇿', '🇪🇦', '🇪🇨', '🇪🇪', '🇪🇬', '🇪🇭', '🇪🇷', '🇪🇸', '🇪🇹', '🇪🇺', '🇫🇮', '🇫🇯', '🇫🇰', '🇫🇲', '🇫🇴', '🇫🇷', '🇬🇦', '🇬🇧', '🇬🇩', '🇬🇪', '🇬🇫', '🇬🇬', '🇬🇭', '🇬🇮', '🇬🇱', '🇬🇲', '🇬🇳', '🇬🇵', '🇬🇶', '🇬🇷', '🇬🇸', '🇬🇹', '🇬🇺', '🇬🇼', '🇬🇾', '🇭🇰', '🇭🇲', '🇭🇳', '🇭🇷', '🇭🇹', '🇭🇺', '🇮🇨', '🇮🇩', '🇮🇪', '🇮🇱', '🇮🇲', '🇮🇳', '🇮🇴', '🇮🇶', '🇮🇷', '🇮🇸', '🇮🇹', '🇯🇪', '🇯🇲', '🇯🇴', '🇯🇵', '🇰🇪', '🇰🇬', '🇰🇭', '🇰🇮', '🇰🇲', '🇰🇳', '🇰🇵', '🇰🇷', '🇰🇼', '🇰🇾', '🇰🇿', '🇱🇦', '🇱🇧', '🇱🇨', '🇱🇮', '🇱🇰', '🇱🇷', '🇱🇸', '🇱🇹', '🇱🇺', '🇱🇻', '🇱🇾', '🇲🇦', '🇲🇨', '🇲🇩', '🇲🇪', '🇲🇫', '🇲🇬', '🇲🇭', '🇲🇰', '🇲🇱', '🇲🇲', '🇲🇳', '🇲🇴', '🇲🇵', '🇲🇶', '🇲🇷', '🇲🇸', '🇲🇹', '🇲🇺', '🇲🇻', '🇲🇼', '🇲🇽', '🇲🇾', '🇲🇿', '🇳🇦', '🇳🇨', '🇳🇪', '🇳🇫', '🇳🇬', '🇳🇮', '🇳🇱', '🇳🇴', '🇳🇵', '🇳🇷', '🇳🇺', '🇳🇿', '🇴🇲', '🇵🇦', '🇵🇪', '🇵🇫', '🇵🇬', '🇵🇭', '🇵🇰', '🇵🇱', '🇵🇲', '🇵🇳', '🇵🇷', '🇵🇸', '🇵🇹', '🇵🇼', '🇵🇾', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇸', '🇷🇺', '🇷🇼', '🇸🇦', '🇸🇧', '🇸🇨', '🇸🇩', '🇸🇪', '🇸🇬', '🇸🇭', '🇸🇮', '🇸🇯', '🇸🇰', '🇸🇱', '🇸🇲', '🇸🇳', '🇸🇴', '🇸🇷', '🇸🇸', '🇸🇹', '🇸🇻', '🇸🇽', '🇸🇾', '🇸🇿', '🇹🇦', '🇹🇨', '🇹🇩', '🇹🇫', '🇹🇬', '🇹🇭', '🇹🇯', '🇹🇰', '🇹🇱', '🇹🇲', '🇹🇳', '🇹🇴', '🇹🇷', '🇹🇹', '🇹🇻', '🇹🇼', '🇹🇿', '🇺🇦', '🇺🇬', '🇺🇲', '🇺🇳', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇦', '🇻🇨', '🇻🇪', '🇻🇬', '🇻🇮', '🇻🇳', '🇻🇺', '🇼🇫', '🇼🇸', '🇽🇰', '🇾🇪', '🇾🇹', '🇿🇦', '🇿🇲', '🇿🇼', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿'
    ]
  };

  // Flatten all emojis into a single array for easy access
  const ALL_EMOJIS = Object.values(APPLE_EMOJIS).flat();

  // Custom Metric Dropdown Component
  interface CustomMetricDropdownProps {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }

  function CustomMetricDropdown({ value, onChange, placeholder }: CustomMetricDropdownProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    React.useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }

      if (isOpen) {
        if (typeof window !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside);
      }
      }

      return () => {
        if (typeof window !== 'undefined') {
          document.removeEventListener('mousedown', handleClickOutside);
        }
      };
    }, [isOpen]);

    // Define metric options
    const metricOptions = [
      { value: 'count', name: 'Count (times, repetitions)' },
      { value: 'minutes', name: 'Minutes' },
      { value: 'hours', name: 'Hours' },
      { value: 'pages', name: 'Pages' },
      { value: 'miles', name: 'Miles' },
      { value: 'kilometers', name: 'Kilometers' },
      { value: 'glasses', name: 'Glasses (water)' },
      { value: 'sessions', name: 'Sessions' },
      { value: 'boolean', name: 'Yes/No (completed or not)' }
    ];

    // Find the selected metric name
    const selectedMetricName = metricOptions.find(option => option.value === value)?.name || '';

    return (
      <div className="relative w-64" ref={dropdownRef}>
        {/* Dropdown Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm bg-white rounded-none flex items-center justify-between hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            {selectedMetricName ? (
              <span className="text-gray-900">{selectedMetricName}</span>
            ) : (
              <span className="text-gray-500">{placeholder}</span>
            )}
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Options */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-60 overflow-auto scrollbar-thin scrollbar-track-white scrollbar-thumb-gray-300" style={{ scrollbarColor: '#d1d5db #fff' }}>
            {metricOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm"
              >
                <span>{option.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Custom Target Amount Dropdown Component
  interface CustomTargetDropdownProps {
    metricType: string;
    onSelect: (value: string) => void;
  }

  function CustomTargetDropdown({ metricType, onSelect }: CustomTargetDropdownProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    React.useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }

      if (isOpen) {
        if (typeof window !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside);
      }
      }

      return () => {
        if (typeof window !== 'undefined') {
          document.removeEventListener('mousedown', handleClickOutside);
        }
      };
    }, [isOpen]);

    // Define suggested values for each metric type
    const getSuggestedValues = (type: string): number[] => {
      switch (type) {
        case 'count':
          return [1, 2, 3, 5, 10, 15, 20, 25, 30, 50, 100];
        case 'minutes':
          return [5, 10, 15, 20, 30, 45, 60, 90, 120];
        case 'hours':
          return [1, 2, 3, 4, 5, 6, 7, 8];
        case 'pages':
          return [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
        case 'miles':
          return [1, 2, 3, 5, 10, 15, 20, 25];
        case 'kilometers':
          return [1, 2, 3, 5, 10, 15, 20, 25, 30];
        case 'glasses':
          return [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
        case 'sessions':
          return [1, 2, 3, 4, 5, 6, 7, 8, 10];
        default:
          return [1, 2, 3, 5, 10];
      }
    };

    const suggestedValues = getSuggestedValues(metricType);

    // Format the display value with unit
    const formatValue = (value: number, type: string): string => {
      const unit = type === 'count' ? '' : 
                   type === 'minutes' ? ' min' :
                   type === 'hours' ? ' hr' :
                   type === 'pages' ? ' pages' :
                   type === 'miles' ? ' mi' :
                   type === 'kilometers' ? ' km' :
                   type === 'glasses' ? ' glasses' :
                   type === 'sessions' ? ' sessions' : '';
      
      return `${value}${unit}`;
    };

    return (
      <div className="relative w-64" ref={dropdownRef}>
        {/* Dropdown Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm bg-white rounded-none flex items-center justify-between hover:bg-gray-50"
        >
          <span className="text-gray-500">Suggested values</span>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Options */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-60 overflow-auto scrollbar-thin scrollbar-track-white scrollbar-thumb-gray-300" style={{ scrollbarColor: '#d1d5db #fff' }}>
            {suggestedValues.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  onSelect(value.toString());
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm"
              >
                <span>{formatValue(value, metricType)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Custom Emoji Dropdown Component
  interface CustomEmojiDropdownProps {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }

  function CustomEmojiDropdown({ value, onChange, placeholder }: CustomEmojiDropdownProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    React.useEffect(() => {
      function handleClickOutside(event: MouseEvent) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      }

      if (isOpen) {
        if (typeof window !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside);
      }
      }

      return () => {
        if (typeof window !== 'undefined') {
          document.removeEventListener('mousedown', handleClickOutside);
        }
      };
    }, [isOpen]);

    // Flatten all emojis into a single array with names
    const allEmojis = [
      ...APPLE_EMOJIS['Smileys & Emotion'].map(emoji => ({ emoji, name: 'Smiley' })),
      ...APPLE_EMOJIS['People & Body'].map(emoji => ({ emoji, name: 'Person' })),
      ...APPLE_EMOJIS['Animals & Nature'].map(emoji => ({ emoji, name: 'Animal' })),
      ...APPLE_EMOJIS['Food & Drink'].map(emoji => ({ emoji, name: 'Food' })),
      ...APPLE_EMOJIS['Travel & Places'].map(emoji => ({ emoji, name: 'Travel' })),
      ...APPLE_EMOJIS['Activities'].map(emoji => ({ emoji, name: 'Activity' })),
      ...APPLE_EMOJIS['Objects'].map(emoji => ({ emoji, name: 'Object' })),
      ...APPLE_EMOJIS['Symbols'].map(emoji => ({ emoji, name: 'Symbol' })),
      ...APPLE_EMOJIS['Flags'].map(emoji => ({ emoji, name: 'Flag' }))
    ];

    return (
      <div className="relative w-64" ref={dropdownRef}>
        {/* Dropdown Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm bg-white rounded-none flex items-center justify-between hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            {value ? (
              <>
                <span className="text-base">{value}</span>
                <span>Emoji</span>
              </>
            ) : (
              <span className="text-gray-500">{placeholder}</span>
            )}
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Options */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-none shadow-lg max-h-60 overflow-auto scrollbar-thin scrollbar-track-white scrollbar-thumb-gray-300" style={{ scrollbarColor: '#d1d5db #fff' }}>
            {allEmojis.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onChange(item.emoji);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none text-sm"
              >
                <span className="text-base flex-shrink-0">{item.emoji}</span>
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Add ESC key handler
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      if (typeof window !== 'undefined') {
        document.addEventListener('keydown', handleKeyDown);
      }
    }

    return () => {
              if (typeof window !== 'undefined') {
          document.removeEventListener('keydown', handleKeyDown);
        }
    };
  }, [isOpen, onClose]);

  const createHabitInBackend = async (habitData: {
    name: string;
    category: string;
    unit_type?: string;
    is_custom?: boolean;
    integration_source?: string;
    icon?: string;
  }) => {
    try {
      setIsCreating(true);
      const newHabit = await apiClient.habits.create(habitData) as any; // Type assertion for now
      console.log('✅ Habit created in backend:', newHabit);
      
      // Call the callback if provided
      if (onHabitCreated) {
        onHabitCreated(newHabit);
      }
      
      return newHabit;
    } catch (error) {
      console.error('❌ Error creating habit:', error);
      // You might want to show a toast notification here
      throw error;
    } finally {
      setIsCreating(false);
    }
  };

  const handleHabitClick = (habit: any) => {
    // Set up configuration screen
    setSelectedHabit(habit);
    setHabitConfig({
      title: habit.label,
      icon: getDefaultIcon(habit.label) || '',
      emoji: '',
      metricType: getDefaultMetricType(habit.label) || '',
      targetAmount: ''
    });
  };

  const getDefaultIcon = (habitName: string) => {
    const name = habitName.toLowerCase();
    const iconMap: { [key: string]: string } = {
      'deep work': 'Target',
      'focus sessions': 'Crosshair',
      'task completion': 'CheckSquare',
      'email batching': 'MessageDots',
      'time blocking': 'CalendarDown',
      'goal setting': 'Target',
      'morning workout': 'Sunrise',
      'daily walk': 'Repeat',
      'hydration': 'WifiCheck',
      'sleep schedule': 'ClockEight',
      'meditation': 'HeartCircle',
      'stretching': 'Hand',
      'reading': 'BookCheck',
      'learning': 'ChartLine',
      'online courses': 'Grid',
      'skill practice': 'Target',
      'journaling': 'Hand',
      'research': 'Search',
      'new recipes': 'Home',
      'creative projects': 'Lightning',
      'habit experiments': 'Cog',
      'productivity tests': 'ChartBarOne',
      'wellness trials': 'HeartPlus',
      'skill challenges': 'Target'
    };
    return iconMap[name] || 'Target';
  };

  const getDefaultMetricType = (habitName: string) => {
    const name = habitName.toLowerCase();
    if (name.includes('sleep')) return 'hours';
    if (name.includes('reading')) return 'pages';
    if (name.includes('walk') || name.includes('run')) return 'miles';
    if (name.includes('water') || name.includes('hydration')) return 'glasses';
    if (name.includes('meditation') || name.includes('workout')) return 'minutes';
    if (name.includes('deep work') || name.includes('focus')) return 'sessions';
    return 'count';
  };

  const getHabitsForCategory = (category: string) => {
    switch (category) {
      case 'productivity':
        return productivityHabits;
      case 'fitness':
        return fitnessHealthHabits;
      case 'education':
        return educationHabits;
      case 'experiments':
        return experimentsHabits;
      default:
        return [];
    }
  };

  const handleSaveHabit = async () => {
    if (!selectedHabit || !habitConfig.title || (!habitConfig.icon && !habitConfig.emoji) || !habitConfig.metricType) return;
    
    try {
      // Convert target amount to seconds if it's a time-based metric
      let targetDurationInSeconds = null;
      if (habitConfig.targetAmount) {
        const amount = parseInt(habitConfig.targetAmount);
        if (habitConfig.metricType === 'minutes') {
          targetDurationInSeconds = amount * 60;
        } else if (habitConfig.metricType === 'hours') {
          targetDurationInSeconds = amount * 60 * 60;
        }
      }

      // Map frontend habit data to backend format
      const habitData = {
        name: habitConfig.title,
        category: categoryMap[selectedCategory || 'productivity'] || 'manual',
        is_custom: selectedHabit.value.startsWith('custom-'),
        unit_type: undefined, // Set to undefined to avoid foreign key constraint issues
        integration_source: selectedHabit.value.startsWith('custom-') ? undefined : selectedHabit.value,
        target_duration: targetDurationInSeconds,
        icon: habitConfig.icon || habitConfig.emoji || undefined,
      };

      // Create habit in backend
      const backendHabit = await createHabitInBackend(habitData);
      
      // Call the original callback with both frontend and backend data
      if (onHabitSelect) {
        onHabitSelect({
          ...selectedHabit,
          label: habitConfig.title,
          icon: habitConfig.icon || habitConfig.emoji,
          metricType: habitConfig.metricType,
          backendId: backendHabit.id,
          backendData: backendHabit
        });
      }
      
      // Reset state and close
      setSelectedHabit(null);
      setHabitConfig({ title: '', icon: '', emoji: '', metricType: '', targetAmount: '' });
      setSelectedCategory(null);
      onClose();
    } catch (error) {
      console.error('Failed to create habit:', error);
      // For now, still proceed with frontend-only behavior
      if (onHabitSelect) {
        onHabitSelect({
          ...selectedHabit,
          label: habitConfig.title,
          icon: habitConfig.icon || habitConfig.emoji,
          metricType: habitConfig.metricType
        });
      }
      setSelectedHabit(null);
      setHabitConfig({ title: '', icon: '', emoji: '', metricType: '', targetAmount: '' });
      onClose();
    }
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
  };

  const handleBack = () => {
    if (selectedHabit) {
      setSelectedHabit(null);
    } else if (selectedCategory) {
      setSelectedCategory(null);
    }
  };

  const handleCustomHabitCreate = async () => {
    if (!customHabit.title || !customHabit.icon || !customHabit.trackingType) return;

    const newHabit = {
      value: `custom-${customHabit.title.toLowerCase().replace(/\s+/g, '-')}`,
      label: customHabit.title,
      icon: customHabit.icon,
      metricType: customHabit.trackingType,
      isCustom: true
    };
    
    // Create in backend first
    try {
      const backendHabit = await createHabitInBackend({
        name: newHabit.label,
        category: 'manual', // All custom are manual
        is_custom: true,
        unit_type: trackingTypeMap[newHabit.metricType] || 'count',
        icon: newHabit.icon,
      });

      // Pass both frontend and backend data
      if (onHabitSelect) {
        onHabitSelect({
          ...newHabit,
          backendId: backendHabit.id,
          backendData: backendHabit
        });
      }

      setCustomHabit({ title: '', icon: '', trackingType: '' });
      setSelectedCategory(null);
      onClose();

    } catch (error) {
      console.error("Failed to create custom habit:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: dropdownStyles }} />
      <Command.Dialog 
        open={isOpen} 
        onOpenChange={onClose} 
        className="fixed z-50 font-inter"
        style={{ 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh'
        }}
      >
      <div className="bg-white rounded-none shadow-xl border border-gray-200 overflow-hidden max-h-full">
        {/* Header with back button (if in config) and close button */}
        <div className="relative border-b border-gray-200">
          {(selectedHabit || selectedCategory) && (
            <button
              onClick={handleBack}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-none transition-colors"
              title="Back"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
          )}
          {!selectedHabit && (
            <Command.Input 
              placeholder="Search for what you want to track..."
              className={`w-full py-4 text-sm border-0 focus:outline-none bg-transparent ${selectedCategory ? 'pl-12 pr-4' : 'px-4'}`}
            />
          )}
          {selectedHabit && (
            <div className="w-full py-5 pl-12 pr-4"></div>
          )}

        </div>

        {selectedHabit ? (
          // Show habit configuration (outside Command structure)
          <div className="px-6 pt-6 pb-6 space-y-4 min-h-[400px]">
            {/* Title Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
              <input
                type="text"
                value={habitConfig.title}
                onChange={(e) => setHabitConfig(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm rounded-none"
                placeholder="Enter habit name..."
              />
            </div>

            {/* Icon Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
              <div className="flex gap-2">
                <CustomIconDropdown
                  value={habitConfig.icon}
                  onChange={(value) => setHabitConfig(prev => ({ ...prev, icon: value, emoji: '' }))}
                  options={AVAILABLE_ICONS}
                  placeholder="Select an icon..."
                  enableSearch={true}
                />
                <CustomEmojiDropdown
                  value={habitConfig.emoji}
                  onChange={(value) => setHabitConfig(prev => ({ ...prev, emoji: value, icon: '' }))}
                  placeholder="Select an emoji..."
                />
              </div>
            </div>

            {/* Metric Type Dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Metric</label>
              <CustomMetricDropdown
                value={habitConfig.metricType}
                onChange={(value) => setHabitConfig(prev => ({ ...prev, metricType: value, targetAmount: '' }))}
                placeholder="Select tracking metric..."
              />
            </div>

            {/* Target Amount Input - Show only for quantifiable metrics */}
            {habitConfig.metricType && habitConfig.metricType !== 'boolean' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target {habitConfig.metricType === 'count' ? 'Amount' : 
                         habitConfig.metricType === 'minutes' ? 'Minutes' :
                         habitConfig.metricType === 'hours' ? 'Hours' :
                         habitConfig.metricType === 'pages' ? 'Pages' :
                         habitConfig.metricType === 'miles' ? 'Miles' :
                         habitConfig.metricType === 'kilometers' ? 'Kilometers' :
                         habitConfig.metricType === 'glasses' ? 'Glasses' :
                         habitConfig.metricType === 'sessions' ? 'Sessions' : 'Amount'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={habitConfig.targetAmount}
                    onChange={(e) => setHabitConfig(prev => ({ ...prev, targetAmount: e.target.value }))}
                    className="w-64 px-3 py-2 border border-gray-300 focus:outline-none text-sm rounded-none"
                    placeholder={`Enter target ${habitConfig.metricType === 'count' ? 'amount' : 
                                habitConfig.metricType === 'minutes' ? 'minutes' :
                                habitConfig.metricType === 'hours' ? 'hours' :
                                habitConfig.metricType === 'pages' ? 'pages' :
                                habitConfig.metricType === 'miles' ? 'miles' :
                                habitConfig.metricType === 'kilometers' ? 'kilometers' :
                                habitConfig.metricType === 'glasses' ? 'glasses' :
                                habitConfig.metricType === 'sessions' ? 'sessions' : 'amount'}...`}
                    min="0"
                    step={habitConfig.metricType === 'miles' || habitConfig.metricType === 'kilometers' ? '0.1' : '1'}
                  />
                  <CustomTargetDropdown
                    metricType={habitConfig.metricType}
                    onSelect={(value) => setHabitConfig(prev => ({ ...prev, targetAmount: value }))}
                  />
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="pt-2">
              <button
                onClick={handleSaveHabit}
                disabled={!habitConfig.title || (!habitConfig.icon && !habitConfig.emoji) || !habitConfig.metricType || 
                         (habitConfig.metricType !== 'boolean' && !habitConfig.targetAmount) || isCreating}
                className="w-full bg-black text-white px-4 py-2 hover:bg-gray-800 transition-colors text-sm font-medium disabled:bg-[#1E2124] disabled:cursor-not-allowed rounded-none"
              >
                {isCreating ? 'Creating Habit...' : 'Save Habit'}
              </button>
            </div>
          </div>
        ) : (
          <Command.List className="h-[360px] min-h-[360px] max-h-[360px] overflow-y-auto px-6 pt-2 pb-6">
            <Command.Empty className="py-6 text-center text-sm text-gray-500">No results found.</Command.Empty>

            {!selectedCategory ? (
            // Show category selection
            <>
              <div className="px-0 pb-1 text-xs text-gray-500 font-medium">
                Welcome to Ritual
              </div>
              
              {/* Start supercharging row - similar to Raycast */}
              <div className="flex items-center gap-3 px-6 py-3 mb-2 hover:bg-gray-50 cursor-pointer transition-colors -mx-6 rounded-none">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 40 40" className="text-gray-700 flex-shrink-0">
                  <path fill="currentColor" d="M0 20C0 8.954 8.954 0 20 0c8.121 0 15.112 4.84 18.245 11.794l-26.45 26.45a20 20 0 0 1-3.225-1.83L24.984 20H20L5.858 34.142A19.94 19.94 0 0 1 0 20M39.999 20.007 20.006 40c11.04-.004 19.99-8.953 19.993-19.993"/>
                </svg>
                <span className="text-sm font-medium text-gray-900">Start supercharging your self-tracking</span>
              </div>
              
              <div className="px-0 pb-1 text-xs text-gray-500 font-medium">
                Suggestions
              </div>
              <Command.Item 
                onSelect={() => handleCategorySelect('productivity')}
                className="flex items-center px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Productivity</span>
                </div>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('education')}
                className="flex items-center px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path d="M12 2L3 7L12 12L21 7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 7V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M7 9V16C7 16 9 18 12 18C15 18 17 16 17 16V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Education</span>
                </div>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('fitness')}
                className="flex items-center px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path d="M6.7 6.7L4.9 4.9M17.3 17.3L19.1 19.1M4.9 19.1L6.7 17.3M19.1 4.9L17.3 6.7M9 2H15M12 16V22M12 2V9M20 12H22M16 12H12M2 12H4M8 12H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Fitness & Health</span>
                </div>
              </Command.Item>

              <Command.Item 
                onSelect={() => handleCategorySelect('experiments')}
                className="flex items-center px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path d="M9 3H15M10 9.5V3M14 3V7.5M8 14.5L9.61541 9.5H14.4615L16 14.2M8 14.5C8 14.5 7 17 8 19C9 21 15 21 16 19C17 17 16 14.2 16 14.2M8 14.5H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9 3H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Experiments</span>
                </div>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('screentime')}
                className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path fillRule="evenodd" d="M4.75 2a.75.75 0 000 1.5h.75v2.982a4.75 4.75 0 002.215 4.017l2.044 1.29a.25.25 0 010 .422l-2.044 1.29A4.75 4.75 0 005.5 17.518V20.5h-.75a.75.75 0 000 1.5h14.5a.75.75 0 000-1.5h-.75v-2.982a4.75 4.75 0 00-2.215-4.017l-2.044-1.29a.25.25 0 010-.422l2.044-1.29A4.75 4.75 0 0018.5 6.482V3.5h.75a.75.75 0 000-1.5H4.75zM17 3.5H7v2.982A3.25 3.25 0 008.516 9.23l2.044 1.29a1.75 1.75 0 010 2.96l-2.044 1.29A3.25 3.25 0 007 17.518V20.5h10v-2.982a3.25 3.25 0 00-1.516-2.748l-2.044-1.29a1.75 1.75 0 010-2.96l2.044-1.29A3.25 3.25 0 0017 6.482V3.5z" fill="currentColor"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Screen Time</span>
                </div>
                <button className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
                  Connect
                </button>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('applewatch')}
                className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="currentColor"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Apple Watch</span>
                </div>
                <button className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
                  Connect
                </button>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('ouraring')}
                className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="4" fill="none"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Oura Ring</span>
                </div>
                <button className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
                  Connect
                </button>
              </Command.Item>
              
              <Command.Item 
                onSelect={() => handleCategorySelect('whoop')}
                className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <img src="/images/whoop.svg" alt="Whoop" width="16" height="16" className="flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-900">Whoop</span>
                </div>
                <button className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
                  Connect
                </button>
              </Command.Item>
              
              <Command.Item 
  onSelect={() => handleCategorySelect('garmin')}
  className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
>
  <div className="flex items-center gap-3">
    {/* Black triangle as logo */}
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
      <polygon points="8,3 14,13 2,13" fill="black" />
    </svg>
    <span className="text-sm font-medium text-gray-900">Garmin</span>
  </div>
  <button className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors">
    Connect
  </button>
</Command.Item>














              <Command.Item 
                onSelect={() => handleCategorySelect('custom')}
                className="flex items-center px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
              >
                <div className="flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-900 flex-shrink-0">
                    <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-sm font-medium text-gray-900">Add Custom</span>
                </div>
              </Command.Item>
            </>
          ) : (
            // Show habits for selected category
            <>
              {selectedCategory === 'productivity' && (
                <div className="space-y-1">
                  <div className="px-0 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Productivity Habits
                  </div>
                  {productivityHabits.map((habit) => (
                    <Command.Item 
                      key={habit.value}
                      onSelect={() => handleHabitClick(habit)}
                      className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{habit.label}</div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {isCreating ? 'Creating...' : 'Select'}
                      </span>
                    </Command.Item>
                  ))}
                </div>
              )}
              
              {selectedCategory === 'fitness' && (
                <div className="space-y-1">
                  <div className="px-0 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Fitness & Health Habits
                  </div>
                  {fitnessHealthHabits.map((habit) => (
                    <Command.Item 
                      key={habit.value}
                      onSelect={() => handleHabitClick(habit)}
                      className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{habit.label}</div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {isCreating ? 'Creating...' : 'Select'}
                      </span>
                    </Command.Item>
                  ))}
                </div>
              )}

              {selectedCategory === 'education' && (
                <div className="space-y-1">
                  <div className="px-0 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Education Habits
                  </div>
                  {educationHabits.map((habit) => (
                    <Command.Item 
                      key={habit.value}
                      onSelect={() => handleHabitClick(habit)}
                      className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{habit.label}</div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {isCreating ? 'Creating...' : 'Select'}
                      </span>
                    </Command.Item>
                  ))}
                </div>
              )}

              {selectedCategory === 'experiments' && (
                <div className="space-y-1">
                  <div className="px-0 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Experiment Habits
                  </div>
                  {experimentsHabits.map((habit) => (
                    <Command.Item 
                      key={habit.value}
                      onSelect={() => handleHabitClick(habit)}
                      className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-100 transition-colors -mx-6 rounded-none"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{habit.label}</div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {isCreating ? 'Creating...' : 'Select'}
                      </span>
                    </Command.Item>
                  ))}
                </div>
              )}

              {selectedCategory === 'custom' && (
                <div className="px-0 py-2 space-y-4">
                  {/* Title Input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    <input
                      type="text"
                      placeholder="Enter habit name..."
                      value={customHabit.title}
                      onChange={(e) => setCustomHabit(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm rounded-none"
                    />
                  </div>

                  {/* Icon Dropdown with Search */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
                    <CustomIconDropdown
                        value={customHabit.icon}
                      onChange={(value) => setCustomHabit(prev => ({ ...prev, icon: value }))}
                      options={AVAILABLE_ICONS}
                      placeholder="Select an icon..."
                      enableSearch={true}
                    />
                  </div>

                  {/* Tracking Type Dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tracking Type</label>
                    <div className="relative">
                     <select
                        value={customHabit.trackingType}
                        onChange={(e) => setCustomHabit(prev => ({ ...prev, trackingType: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 focus:outline-none text-sm appearance-none bg-white white-dropdown-options rounded-none"
                      >
                        <option value="" style={{ backgroundColor: 'white', color: 'black' }}>Select tracking type...</option>
                        <option value="number" style={{ backgroundColor: 'white', color: 'black' }}>Number (count, reps, pages, etc.)</option>
                        <option value="time" style={{ backgroundColor: 'white', color: 'black' }}>Time (minutes, hours)</option>
                        <option value="boolean" style={{ backgroundColor: 'white', color: 'black' }}>Yes/No (completed or not)</option>
                        <option value="distance" style={{ backgroundColor: 'white', color: 'black' }}>Distance (miles, kilometers)</option>
                        <option value="weight" style={{ backgroundColor: 'white', color: 'black' }}>Weight (pounds, kilograms)</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Create Button */}
                  <div className="pt-2">
                    <button
                      onClick={handleCustomHabitCreate}
                      disabled={!customHabit.title || !customHabit.icon || !customHabit.trackingType || isCreating}
                      className="w-full bg-black text-white px-4 py-2 hover:bg-gray-800 transition-colors text-sm font-medium disabled:bg-[#1E2124] disabled:cursor-not-allowed rounded-none"
                    >
                      {isCreating ? 'Creating Habit...' : 'Create Custom Habit'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          </Command.List>
        )}
        
        {/* Bottom footer row - similar to Raycast */}
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 flex items-center justify-between">
          {/* Left side - Logo */}
          <div className="flex items-center opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 40 40" className="text-gray-500">
              <path fill="currentColor" d="M0 20C0 8.954 8.954 0 20 0c8.121 0 15.112 4.84 18.245 11.794l-26.45 26.45a20 20 0 0 1-3.225-1.83L24.984 20H20L5.858 34.142A19.94 19.94 0 0 1 0 20M39.999 20.007 20.006 40c11.04-.004 19.99-8.953 19.993-19.993"/>
            </svg>
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {selectedHabit ? (
              <>
                <div className="flex items-center gap-1">
                  <span>Save</span>
                  <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded-none text-xs font-mono">⌘S</kbd>
                </div>
                <div className="flex items-center gap-1">
                  <span>Back</span>
                  <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded-none text-xs font-mono">⌘←</kbd>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <span>Select</span>
                  <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded-none text-xs font-mono">↵</kbd>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Command.Dialog>
    </>
  );
} 