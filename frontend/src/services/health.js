import { api, ApiError } from './api.js'

export async function getHealth({ signal } = {}) {
  const result = await api.request('/health', { signal })
  if (result?.status !== 'healthy' || typeof result.application !== 'string') {
    throw new ApiError('The server returned an unexpected health response.', { code: 'invalid_response' })
  }
  return result
}
