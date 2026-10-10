import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, children, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" title="Close" onClick={onClose}><X size={20} /></button></header>
    {children}
  </dialog>
}
