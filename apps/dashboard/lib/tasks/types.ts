export type TaskStatus = 'open' | 'completed' | 'skipped' | 'archived';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';
export type TaskSource = 'manual' | 'routine' | 'ai' | 'calendar' | 'habit' | 'experiment';

export type RoutineStatus = 'draft' | 'scheduled' | 'paused' | 'archived';
export type RoutineKind = 'task' | 'ai_workflow' | 'habit_prompt' | 'calendar_block' | 'mixed';
export type RoutineTriggerType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'on_completion';
export type RoutineRunStatus = 'scheduled' | 'generated' | 'completed' | 'skipped' | 'failed';

export type Task = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  source: TaskSource;
  project: string | null;
  category: string | null;
  tags: string[];
  routine_id: string | null;
  routine_run_id: string | null;
  linked_habit_id: string | null;
  linked_artifact_id: string | null;
  client_event_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TaskListResponse = {
  items: Task[];
};

export type TaskCreateInput = {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_at?: string | null;
  scheduled_for?: string | null;
  source?: TaskSource;
  project?: string | null;
  category?: string | null;
  tags?: string[];
  client_event_id?: string | null;
};

export type TaskUpdateInput = Partial<{
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  project: string | null;
  category: string | null;
  tags: string[];
  linked_habit_id: string | null;
  linked_artifact_id: string | null;
}>;

export type RoutineTaskTemplate = {
  title: string;
  notes: string | null;
  project: string | null;
  category: string | null;
  tags: string[];
  linked_habit_id: string | null;
};

export type Routine = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: RoutineStatus;
  kind: RoutineKind;
  trigger_type: RoutineTriggerType;
  trigger_config: Record<string, unknown>;
  timezone: string;
  priority: TaskPriority;
  tags: string[];
  task_template: RoutineTaskTemplate;
  ai_workflow_definition_id: string | null;
  first_run_at: string | null;
  ends_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  client_event_id: string | null;
  cadence_summary: string;
  next_preview: string[];
  created_at: string | null;
  updated_at: string | null;
};

export type RoutineListResponse = {
  items: Routine[];
};

export type RoutineCreateInput = {
  title: string;
  description?: string | null;
  status?: RoutineStatus;
  kind?: RoutineKind;
  trigger_type?: RoutineTriggerType;
  trigger_config?: Record<string, unknown>;
  timezone?: string;
  priority?: TaskPriority;
  tags?: string[];
  task_template?: RoutineTaskTemplate;
  ai_workflow_definition_id?: string | null;
  first_run_at?: string | null;
  ends_at?: string | null;
  client_event_id?: string | null;
};

export type RoutineUpdateInput = Partial<RoutineCreateInput>;

export type RoutineRun = {
  id: string;
  routine_id: string;
  user_id: string;
  scheduled_for: string;
  status: RoutineRunStatus;
  generated_task_id: string | null;
  generated_scheduled_block_id: string | null;
  workflow_run_id: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  error_json: string | null;
  idempotency_key: string | null;
  created_at: string | null;
  updated_at: string | null;
};
