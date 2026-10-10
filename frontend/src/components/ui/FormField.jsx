import { useId } from 'react'

export default function FormField({ label, error, hint, id, ...inputProps }) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const description = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(' ')

  return (
    <div className="form-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        {...inputProps}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[inputProps['aria-describedby'], description].filter(Boolean).join(' ') || undefined}
      />
      {hint && <p id={`${inputId}-hint`}>{hint}</p>}
      {error && <p id={`${inputId}-error`} role="alert">{error}</p>}
    </div>
  )
}
