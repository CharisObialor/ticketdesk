export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Body = Record<string, unknown> | FormData | undefined;

// Where the API runs. Empty when the API is on the same address as the website (local development and the
// single-app setup); "https://api.dateheightsupport.com" when the website and API are on different addresses.
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
// Addresses for files, exports and logos that the server gives as "/api/...".
export const apiHref = <T extends string | null | undefined>(path: T): T =>
  (typeof path === 'string' && path.startsWith('/api/') ? `${API_BASE}${path}` : path) as T;
const credentials: RequestCredentials = API_BASE ? 'include' : 'same-origin';

// The server's CSRF token, from the cookie it sets at sign-in. Sent back with every change (POST, PUT, PATCH, DELETE).
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)td_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function request<T>(method: string, url: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken() };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}/api${url}`, { method, credentials, headers, body: payload }).catch(() => {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : {};
  if ([502, 503, 504].includes(res.status) && !data.error) {
    throw new ApiError(res.status, 'The server is restarting or unreachable. Please try again in a moment.');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: Body) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: Body) => request<T>('PATCH', url, body),
  put: <T>(url: string, body?: Body) => request<T>('PUT', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

// Posts form data and reports upload progress (0-100). Used for large email attachments.
export function uploadWithProgress<T>(url: string, body: FormData, onProgress: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api${url}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', csrfToken());
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        // Non-JSON response; fall through with an empty body.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data.error || `Request failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Connection lost while uploading. Please try again.'));
    xhr.send(body);
  });
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
