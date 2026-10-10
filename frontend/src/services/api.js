export class ApiError extends Error {
  constructor(message, { status = 0, code = 'request_failed' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function createApiClient({ baseUrl = '', timeoutMs = 15000, fetchImpl = fetch } = {}) {
  const base = baseUrl.trim().replace(/\/+$/, '')

  return {
    async request(path, { signal, ...options } = {}) {
      if (!base) {
        throw new ApiError('The server address has not been configured.', { code: 'not_configured' })
      }
      if (!path.startsWith('/') || path.startsWith('//')) {
        throw new ApiError('Invalid request path.', { code: 'invalid_path' })
      }

      const controller = new AbortController()
      const cancel = () => controller.abort()
      if (signal?.aborted) cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)

      try {
        const headers = new Headers(options.headers)
        if (!headers.has('Accept')) headers.set('Accept', 'application/json')
        const response = await fetchImpl(`${base}${path}`, {
          ...options,
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          const messages = {
            401: 'Please sign in to continue.',
            403: 'You do not have access to this information.',
            404: 'The requested information is unavailable.',
            422: 'Check the information entered and try again.',
            429: 'Too many requests. Please try again shortly.',
          }
          throw new ApiError(messages[response.status] ?? 'The request could not be completed. Please try again.', {
            status: response.status,
            code: 'http_error',
          })
        }
        if (response.status === 204) return null
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
    },
  }
}

export const api = createApiClient({ baseUrl: import.meta.env?.VITE_API_BASE_URL })
