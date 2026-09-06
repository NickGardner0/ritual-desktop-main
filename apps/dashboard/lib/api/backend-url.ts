const LOCAL_BACKEND_PROTOCOL = 'http';
const LOCAL_BACKEND_HOST = '127.0.0.1';
const LOCAL_BACKEND_PORT = '8000';

function localBackendUrl(): string {
  return `${LOCAL_BACKEND_PROTOCOL}://${LOCAL_BACKEND_HOST}:${LOCAL_BACKEND_PORT}`;
}

export function getBackendBaseUrl(): string {
  return (process.env.PYTHON_API_URL || process.env.BACKEND_URL || localBackendUrl()).replace(/\/$/, '');
}

