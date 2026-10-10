import { api, ApiError } from './api.js'

export async function getHealth({ signal, client = api } = {}) {
  const result = await client.request('/health', { signal, auth: false })
  if (result?.status !== 'healthy' || typeof result.application !== 'string') {
    throw new ApiError('The server returned an unexpected health response.', { code: 'invalid_response' })
  }
  return result
}
