export default function UploadProgress({ phase, progress, onCancel }) {
  if (phase !== 'uploading' && phase !== 'processing') return null
  return <div className="upload-progress" role="status">
    <progress max={1} value={phase === 'uploading' ? progress : undefined} aria-label={phase === 'uploading' ? 'Upload progress' : 'Analysing'} />
    <span>{phase === 'uploading' ? `Uploading ${Math.round(progress * 100)}%` : 'Uploaded. Reading the image...'}</span>
    <button type="button" className="button compact" onClick={onCancel}>Cancel</button>
  </div>
}
