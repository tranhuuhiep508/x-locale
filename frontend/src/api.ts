export type TranslationStatus = "draft" | "live";

export interface Translation {
  locale: string;
  value: string;
  status: TranslationStatus;
  updated_at?: string;
}

export interface StringEntry {
  id: string;
  key: string;
  source_text: string;
  description: string | null;
  updated_at: string | null;
  translations: Translation[];
}

export interface Project {
  id: string;
  name: string;
  base_language: string;
  target_languages: string[];
  string_count: number;
}

// Dev: Vite proxies /api → backend. Prod: same origin, API routes at /.
const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "/api" : "");
const API_KEY = import.meta.env.VITE_API_KEY || "demo-api-key-change-me";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(API_KEY)}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}

export function setProjectId(id: string) {
  localStorage.setItem("tms_project_id", id);
}

export async function fetchProject(projectId: string): Promise<Project> {
  return request<Project>(`/projects/${projectId}`);
}

export async function fetchStrings(projectId: string): Promise<StringEntry[]> {
  return request<StringEntry[]>(`/projects/${projectId}/strings`);
}

export async function createString(
  projectId: string,
  data: { key: string; source_text: string; description?: string }
): Promise<StringEntry> {
  return request<StringEntry>(`/projects/${projectId}/strings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateString(
  projectId: string,
  key: string,
  data: { source_text?: string; description?: string }
): Promise<StringEntry> {
  return request<StringEntry>(`/projects/${projectId}/strings/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function updateTranslation(
  projectId: string,
  key: string,
  locale: string,
  data: { value: string; status?: TranslationStatus }
): Promise<StringEntry> {
  return request<StringEntry>(
    `/projects/${projectId}/strings/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
}

export async function deleteString(projectId: string, key: string): Promise<void> {
  await request<void>(`/projects/${projectId}/strings/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

export async function translateMissing(projectId: string): Promise<{ translated_count: number }> {
  return request(`/projects/${projectId}/translate-missing`, { method: "POST" });
}

export async function translateString(
  projectId: string,
  key: string
): Promise<{ translated_count: number }> {
  return request(`/projects/${projectId}/strings/${encodeURIComponent(key)}/translate`, {
    method: "POST",
  });
}

export async function discoverProjectId(): Promise<string> {
  const response = await fetch(`${API_URL}/bootstrap/project?api_key=${encodeURIComponent(API_KEY)}`);
  if (!response.ok) throw new Error("Could not discover project");
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "Backend API not reachable. Make sure the backend is running on port 8000 and only one frontend dev server is active."
    );
  }
  const data = await response.json();
  setProjectId(data.id);
  return data.id;
}
