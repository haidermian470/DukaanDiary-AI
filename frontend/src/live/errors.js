/** Field error from a backend validation response, for showing under the matching input. */
export function fieldError(error, ...names) {
  if (!error?.fieldErrors) return undefined
  for (const name of names) if (error.fieldErrors[name]) return error.fieldErrors[name]
  return undefined
}
