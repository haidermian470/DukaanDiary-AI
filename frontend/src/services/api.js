// HTTP client for the DukaanDiary FastAPI backend.
//
// One place handles: the base URL, the Supabase access token, the optional workspace
// header, Idempotency-Key headers, timeouts, cancellation, the backend's error envelope
// ({"error": {"code", "message", "details", "request_id"}}), one session refresh on an
// expired token, JSON, multipart uploads (with progress) and file downloads.

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'request_failed', details = null, fieldErrors = {}, requestId = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.fieldErrors = fieldErrors
    this.requestId = requestId
    this.retryAfter = retryAfter
  }
}

const GENERIC_MESSAGES = {
  400: 'The request was not accepted. Check the details and try again.',
  401: 'Please sign in to continue.',
  403: 'You do not have access to this information.',
  404: 'The requested information is unavailable.',
  409: 'This conflicts with an existing record.',
  413: 'The file is too large.',
  415: 'This file type is not supported.',
  422: 'Check the information entered and try again.',
  429: 'Too many requests. Please try again shortly.',
  500: 'Something went wrong on the server. Nothing was saved.',
  502: 'The server is unavailable right now. Please try again shortly.',
  503: 'The service is unavailable right now. Please try again shortly.',
  504: 'The server took too long to respond. Please try again.',
}
const FALLBACK_MESSAGE = 'The request could not be completed. Please try again.'

/** Turn the backend's validation details into { fieldName: message }. */
function toFieldErrors(details) {
  if (!Array.isArray(details)) return {}
  const fields = {}
  for (const item of details) {
    if (!item || typeof item.message !== 'string') continue
    const field = String(item.field ?? '').replace(/^body\.?/, '') || '_form'
    fields[field] ??= item.message.replace(/^Value error, /, '')
  }
  return fields
}

/** Build an ApiError from a failed response. Only the backend's own envelope is trusted for text. */
export async function errorFromResponse(status, readText, headers) {
  let envelope = null
  try {
    const text = await readText()
    const parsed = text ? JSON.parse(text) : null
    if (parsed && typeof parsed.error === 'object' && parsed.error && typeof parsed.error.message === 'string') envelope = parsed.error
  } catch { /* not JSON: fall back to a generic message */ }
  const retry = Number(headers?.get?.('Retry-After'))
  const options = { status, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null }
  if (!envelope) return new ApiError(GENERIC_MESSAGES[status] ?? FALLBACK_MESSAGE, { ...options, code: 'http_error' })
  const message = envelope.message.trim().slice(0, 500) || GENERIC_MESSAGES[status] || FALLBACK_MESSAGE
  return new ApiError(message, {
    ...options,
    code: typeof envelope.code === 'string' ? envelope.code : 'http_error',
    details: envelope.details ?? null,
    fieldErrors: envelope.code === 'validation_error' ? toFieldErrors(envelope.details) : {},
    requestId: typeof envelope.request_id === 'string' ? envelope.request_id : null,
  })
}

function filenameFrom(disposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  return match ? decodeURIComponent(match[1]).replace(/[\\/]/g, '_') : null
}

export function buildQuery(query) {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.append(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** A fresh Idempotency-Key. Create one per user action and reuse it for retries of that action. */
export function newIdempotencyKey() {
  return crypto.randomUUID()
}

export function createApiClient({
  baseUrl = '',
  timeoutMs = 15000,
  fetchImpl = (...args) => fetch(...args),
  xhrFactory = () => new XMLHttpRequest(),
  getAccessToken = async () => null,
  getWorkspaceId = () => null,
  refreshSession = null,
  onAuthError = null,
} = {}) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '')

  function checkPath(path) {
    if (!base) throw new ApiError('The server address has not been configured.', { code: 'not_configured' })
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new ApiError('Invalid request path.', { code: 'invalid_path' })
  }

  async function buildHeaders({ headers, auth, idempotencyKey, json }) {
    const result = new Headers(headers)
    if (!result.has('Accept')) result.set('Accept', 'application/json')
    if (json !== undefined) result.set('Content-Type', 'application/json')
    if (idempotencyKey) result.set('Idempotency-Key', idempotencyKey)
    if (auth) {
      const token = await getAccessToken()
      if (token && !result.has('Authorization')) result.set('Authorization', `Bearer ${token}`)
      const workspaceId = getWorkspaceId()
      if (workspaceId && !result.has('X-Workspace-Id')) result.set('X-Workspace-Id', workspaceId)
    }
    return result
  }

  // Retry once after refreshing the session when the backend reports an invalid/expired token.
  async function withAuthRetry(run, auth) {
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !auth) throw error
      if (refreshSession) {
        const refreshed = await Promise.resolve().then(refreshSession).catch(() => false)
        if (refreshed) {
          try { return await run() } catch (retryError) {
            if (retryError instanceof ApiError && retryError.status === 401) onAuthError?.(retryError)
            throw retryError
          }
        }
      }
      onAuthError?.(error)
      throw error
    }
  }

  async function send(path, { signal, method = 'GET', query, json, body, headers, idempotencyKey, responseType = 'json', auth = true, timeoutMs: requestTimeout = timeoutMs } = {}) {
    checkPath(path)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (signal?.aborted) cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const response = await fetchImpl(`${base}${path}${buildQuery(query)}`, {
        method,
        headers: await buildHeaders({ headers, auth, idempotencyKey, json }),
        body: json !== undefined ? JSON.stringify(json) : body,
        signal: controller.signal,
      })
      if (!response.ok) throw await errorFromResponse(response.status, () => response.text(), response.headers)
      if (response.status === 204) return null
      if (responseType === 'blob') {
        const blob = await response.blob()
        return { blob, filename: filenameFrom(response.headers.get('Content-Disposition')), contentType: response.headers.get('Content-Type') }
      }
      if (responseType === 'text') return await response.text()
      try {
        return await response.json()
      } catch (error) {
        if (controller.signal.aborted) throw error
        throw new ApiError('The server returned an unreadable response.', { code: 'invalid_response' })
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (signal?.aborted) throw new ApiError('Request cancelled.', { code: 'cancelled' })
      if (timedOut) throw new ApiError('The server took too long to respond. Please try again.', { code: 'timeout' })
      throw new ApiError('Cannot reach the server. Check your connection and try again.', { code: 'network_error' })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }

  // Multipart upload through XMLHttpRequest, because fetch cannot report upload progress.
  async function sendUpload(path, { formData, onProgress, signal, auth = true, timeoutMs: requestTimeout = 60000 } = {}) {
    checkPath(path)
    const headers = await buildHeaders({ auth })
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory()
      let settled = false
      const finish = (fn, value) => { if (!settled) { settled = true; signal?.removeEventListener('abort', abort); fn(value) } }
      const abort = () => xhr.abort()
      xhr.open('POST', `${base}${path}`)
      xhr.timeout = requestTimeout
      headers.forEach((value, key) => xhr.setRequestHeader(key, value))
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(1, event.loaded / event.total)) }
      }
      xhr.onload = async () => {
        const read = async () => xhr.responseText
        const responseHeaders = { get: (name) => xhr.getResponseHeader(name) }
        if (xhr.status < 200 || xhr.status >= 300) return finish(reject, await errorFromResponse(xhr.status, read, responseHeaders))
        try { finish(resolve, JSON.parse(xhr.responseText)) } catch { finish(reject, new ApiError('The server returned an unreadable response.', { code: 'invalid_response' })) }
      }
      xhr.onerror = () => finish(reject, new ApiError('Cannot reach the server. Check your connection and try again.', { code: 'network_error' }))
      xhr.ontimeout = () => finish(reject, new ApiError('The server took too long to respond. Please try again.', { code: 'timeout' }))
      xhr.onabort = () => finish(reject, new ApiError('Request cancelled.', { code: 'cancelled' }))
      if (signal?.aborted) { xhr.abort(); return }
      signal?.addEventListener('abort', abort, { once: true })
      xhr.send(formData)
    })
  }

  return {
    baseUrl: base,
    request(path, options = {}) {
      return withAuthRetry(() => send(path, options), options.auth ?? true)
    },
    upload(path, options = {}) {
      return withAuthRetry(() => sendUpload(path, options), options.auth ?? true)
    },
  }
}

// Default unauthenticated client, used only for the public health check in demo mode.
export const api = createApiClient({ baseUrl: import.meta.env?.VITE_API_BASE_URL })
