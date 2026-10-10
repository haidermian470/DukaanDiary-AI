import { useEffect, useRef, useState } from 'react'

/** Runs an upload-and-analyse call with progress, processing and cancellation state. */
export function useUpload(send) {
  const [state, setState] = useState({ phase: 'idle', progress: 0, result: null, error: null })
  const controllerRef = useRef(null)
  useEffect(() => () => controllerRef.current?.abort(), [])
  async function run(file) {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ phase: 'uploading', progress: 0, result: null, error: null })
    try {
      const result = await send(file, {
        signal: controller.signal,
        onProgress: (progress) => setState((s) => ({ ...s, progress, phase: progress >= 1 ? 'processing' : 'uploading' })),
      })
      if (!controller.signal.aborted) setState({ phase: 'done', progress: 1, result, error: null })
    } catch (error) {
      if (!controller.signal.aborted) setState({ phase: 'error', progress: 0, result: null, error })
    }
  }
  const cancel = () => { controllerRef.current?.abort(); setState({ phase: 'idle', progress: 0, result: null, error: null }) }
  const reset = () => setState({ phase: 'idle', progress: 0, result: null, error: null })
  return { ...state, busy: state.phase === 'uploading' || state.phase === 'processing', run, cancel, reset }
}
