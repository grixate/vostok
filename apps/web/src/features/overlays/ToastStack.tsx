import { useUIContext } from '../../contexts/UIContext.tsx'

export function ToastStack() {
  const { toasts } = useUIContext()

  if (toasts.length === 0) {
    return null
  }

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}
