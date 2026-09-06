export type ExperimentStatus = 'active' | 'completed' | 'archived';
export type ExperimentEntryKind = 'observation' | 'file' | 'metric' | 'conclusion';

export type ExperimentSummary = {
  id: string;
  title: string;
  description: string | null;
  status: ExperimentStatus;
  thread_count: number;
  entry_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ExperimentThread = {
  id: string;
  title: string | null;
  first_message: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ExperimentEntry = {
  id: string;
  experiment_id: string;
  kind: ExperimentEntryKind;
  title: string;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

export type ExperimentDetail = ExperimentSummary & {
  threads: ExperimentThread[];
  entries: ExperimentEntry[];
};

async function experimentFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `Experiment request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function listExperiments(limit = 20): Promise<ExperimentSummary[]> {
  const data = await experimentFetch<{ items: ExperimentSummary[] }>(`/api/experiments?limit=${limit}`);
  return data.items || [];
}

export function getExperiment(experimentId: string): Promise<ExperimentDetail> {
  return experimentFetch(`/api/experiments/${experimentId}`);
}

export function createExperiment(input: { title: string; description?: string }): Promise<ExperimentSummary> {
  return experimentFetch('/api/experiments', { method: 'POST', body: JSON.stringify(input) });
}

export function updateExperiment(
  experimentId: string,
  input: Partial<Pick<ExperimentSummary, 'title' | 'description' | 'status'>>,
): Promise<ExperimentDetail> {
  return experimentFetch(`/api/experiments/${experimentId}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function createExperimentThread(experimentId: string): Promise<ExperimentThread> {
  return experimentFetch(`/api/experiments/${experimentId}/threads`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function createExperimentEntry(
  experimentId: string,
  input: { kind: ExperimentEntryKind; title: string; content?: string },
): Promise<ExperimentEntry> {
  return experimentFetch(`/api/experiments/${experimentId}/entries`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteExperimentEntry(experimentId: string, entryId: string): Promise<void> {
  return experimentFetch(`/api/experiments/${experimentId}/entries/${entryId}`, { method: 'DELETE' });
}
