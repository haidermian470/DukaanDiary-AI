import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'

export default function ImageUpload({ label, onChange }) {
  const [{ file, url }, setImage] = useState({ file: null, url: '' })
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  function select(next) {
    setError('')
    if (!next) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 5 * 1024 * 1024 || !next.size) {
      setError('Choose a non-empty JPG, PNG, or WebP image up to 5 MB.')
      input.current.value = ''
      return
    }
    setImage({ file: next, url: URL.createObjectURL(next) }); onChange(next)
  }
  function remove() { setImage({ file: null, url: '' }); onChange(null); input.current.value = '' }
  return <div className="image-upload"><label className="upload-target" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); select(e.dataTransfer.files[0]) }}><ImagePlus size={28} /><strong>{label}</strong><span>JPG, PNG, WebP · Up to 5 MB</span><input ref={input} aria-label={label} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => select(e.target.files[0])} /></label>{file && url && <figure className="image-preview"><img src={url} alt="Selected image preview" onError={() => { remove(); setError('This file could not be decoded as an image. Choose another file.') }} /><figcaption><span>{file.name}</span><button className="icon-button" aria-label="Remove image" title="Remove image" onClick={remove}><X size={18} /></button></figcaption></figure>}{error && <p role="alert" className="error-message">{error}</p>}</div>
}
