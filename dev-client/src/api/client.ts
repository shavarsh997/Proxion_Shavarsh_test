export type ApiError = { status: number; code: string; message: string };
export type RequestLog = {
  at: string;
  method: string;
  url: string;
  body?: unknown;
  status: number;
  response: unknown;
};

// Keep browser requests behind the stable API namespace. In development, Vite proxies
// this relative path to the Nest server; deployments can provide an absolute API base URL.
const configuredBaseUrl = (import.meta.env.VITE_API_URL ?? '/api').trim().replace(/\/+$/, '');
const baseUrl = configuredBaseUrl || '/api';
const logs: RequestLog[] = [];

// Request bodies can contain submissions and reviewer feedback. Keep the optional
// developer panel's diagnostics in memory instead of persisting that data in the browser.
export const getLogs = (): RequestLog[] => [...logs];
const addLog = (entry: RequestLog) => {
  logs.unshift(entry);
  logs.splice(20);
};

export class ApiClient {
  constructor(private readonly token: string | null) {}
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        'X-Request-Id': crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload: unknown = await response.json().catch(() => null);
    addLog({
      at: new Date().toISOString(),
      method,
      url: path,
      body,
      status: response.status,
      response: payload,
    });
    if (!response.ok) {
      const data = (payload ?? {}) as Record<string, unknown>;
      throw {
        status: response.status,
        code: String(data.code ?? data.error ?? 'REQUEST_FAILED'),
        message: String(data.message ?? 'Request failed'),
      } satisfies ApiError;
    }
    return payload as T;
  }
  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
}
