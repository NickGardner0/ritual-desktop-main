const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const PYTHON_API_TIMEOUT_MS = 30_000;

export { PYTHON_API_BASE };

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

export async function fetchPythonApi(endpoint: string, token: string, params?: Record<string, string | number>) {
  const url = new URL(`${PYTHON_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }

  console.log(`🐍 Calling Python API: ${url.toString()}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PYTHON_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}
