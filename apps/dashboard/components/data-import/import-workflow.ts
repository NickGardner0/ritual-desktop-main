import type {
  DataSource,
  ImportPreviewResponse,
  ImportRun,
  ImportRunSummary,
} from "../data-import-modal.config";

type RequestState = "idle" | "pending";

export type ImportWorkflowState =
  | { kind: "selecting" }
  | { kind: "uploading"; source: DataSource; file: File | null; request: RequestState; error: string | null }
  | { kind: "configuring"; source: DataSource; file: File; preview: ImportPreviewResponse; runId: string; request: RequestState; error: string | null }
  | { kind: "importing"; source: DataSource; file: File; preview: ImportPreviewResponse; runId: string; attempt: number; progress: { current: number; total: number } }
  | { kind: "complete"; runId: string; result: ImportRunSummary }
  | { kind: "history"; runs: ImportRun[]; request: RequestState; error: string | null };

export type ImportWorkflowAction =
  | { type: "SELECT_SOURCE"; source: DataSource }
  | { type: "SET_FILE"; file: File | null }
  | { type: "REQUEST_PREVIEW" }
  | { type: "PREVIEW_SUCCEEDED"; preview: ImportPreviewResponse }
  | { type: "REQUEST_FAILED"; error: string }
  | { type: "IMPORT_STARTED"; attempt: number }
  | { type: "IMPORT_PROGRESS"; attempt: number; current: number; total: number }
  | { type: "IMPORT_COMPLETED"; attempt: number; result: ImportRunSummary }
  | { type: "IMPORT_FAILED"; attempt: number; error: string }
  | { type: "SHOW_HISTORY" }
  | { type: "HISTORY_LOADED"; runs: ImportRun[] }
  | { type: "BACK" }
  | { type: "RESET" };

export const initialImportWorkflowState: ImportWorkflowState = { kind: "selecting" };

export function importWorkflowReducer(
  state: ImportWorkflowState,
  action: ImportWorkflowAction,
): ImportWorkflowState {
  switch (action.type) {
    case "SELECT_SOURCE":
      return { kind: "uploading", source: action.source, file: null, request: "idle", error: null };
    case "SET_FILE":
      return state.kind === "uploading" ? { ...state, file: action.file, error: null } : state;
    case "REQUEST_PREVIEW":
      return state.kind === "uploading" ? { ...state, request: "pending", error: null } : state;
    case "PREVIEW_SUCCEEDED":
      if (state.kind !== "uploading" || !state.file) return state;
      return {
        kind: "configuring",
        source: state.source,
        file: state.file,
        preview: action.preview,
        runId: action.preview.import_run_id,
        request: "idle",
        error: null,
      };
    case "REQUEST_FAILED":
      if (state.kind === "uploading" || state.kind === "configuring") {
        return { ...state, request: "idle", error: action.error };
      }
      return state;
    case "IMPORT_STARTED":
      if (state.kind !== "configuring") return state;
      return {
        kind: "importing",
        source: state.source,
        file: state.file,
        preview: state.preview,
        runId: state.runId,
        attempt: action.attempt,
        progress: { current: 0, total: 0 },
      };
    case "IMPORT_PROGRESS":
      return state.kind === "importing" && state.attempt === action.attempt
        ? { ...state, progress: { current: action.current, total: action.total } }
        : state;
    case "IMPORT_COMPLETED":
      return state.kind === "importing" && state.attempt === action.attempt
        ? { kind: "complete", runId: state.runId, result: action.result }
        : state;
    case "IMPORT_FAILED":
      return state.kind === "importing" && state.attempt === action.attempt
        ? {
            kind: "configuring",
            source: state.source,
            file: state.file,
            preview: state.preview,
            runId: state.runId,
            request: "idle",
            error: action.error,
          }
        : state;
    case "SHOW_HISTORY":
      return { kind: "history", runs: [], request: "pending", error: null };
    case "HISTORY_LOADED":
      return state.kind === "history" ? { ...state, runs: action.runs, request: "idle" } : state;
    case "BACK":
      if (state.kind === "uploading" || state.kind === "history") return initialImportWorkflowState;
      if (state.kind === "configuring") {
        return { kind: "uploading", source: state.source, file: state.file, request: "idle", error: null };
      }
      return state;
    case "RESET":
      return initialImportWorkflowState;
  }
}
