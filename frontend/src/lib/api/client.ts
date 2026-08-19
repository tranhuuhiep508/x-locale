const BASE_URL = '/api'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type QueryParams = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, params?: QueryParams): string {
  const url = `${BASE_URL}${path}`
  if (!params) return url

  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v))
    }
  }
  const qs = sp.toString()
  return qs ? `${url}?${qs}` : url
}

function errorMessage(errBody: unknown, statusText: string): string {
  const detail = (errBody as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined
    if (first?.msg) return first.msg
  }
  return statusText
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(header)
  return match?.[1] ? decodeURIComponent(match[1]) : fallback
}

async function request<T>(
  method: string,
  path: string,
  opts?: { body?: unknown; params?: QueryParams },
): Promise<T> {
  const url = buildUrl(path, opts?.params)

  const headers: Record<string, string> = {}
  let body: string | undefined
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    throw new ApiError(res.status, errorMessage(errBody, res.statusText), errBody)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, params?: QueryParams) =>
    request<T>('GET', path, { params }),

  post: <T>(path: string, body?: unknown, params?: QueryParams) =>
    request<T>('POST', path, { body, params }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, { body }),

  put: <T>(path: string, body?: unknown) =>
    request<T>('PUT', path, { body }),

  delete: <T>(path: string, body?: unknown) =>
    request<T>('DELETE', path, { body }),

  upload: <T>(path: string, formData: FormData, params?: QueryParams): Promise<T> => {
    const url = buildUrl(path, params)
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new ApiError(res.status, errorMessage(errBody, res.statusText), errBody)
      }
      return res.json() as Promise<T>
    })
  },

  download: async (
    path: string,
    params?: QueryParams,
    fallbackName = 'download',
  ): Promise<{ blob: Blob; filename: string }> => {
    const url = buildUrl(path, params)
    const res = await fetch(url, { method: 'GET', credentials: 'include' })
    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      throw new ApiError(res.status, errorMessage(errBody, res.statusText), errBody)
    }
    const blob = await res.blob()
    return {
      blob,
      filename: filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName),
    }
  },
}
