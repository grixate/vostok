/**
 * Shown in the right panel when no chat is selected.
 * Replaces the fake "Vostok" conversation header + reaction bar.
 */
export function NoConversation() {
  return (
    <div className="no-conversation">
      <div className="no-conversation__icon" aria-hidden="true">
        {/* Vostok logo mark — a simple paper plane */}
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M6 6L42 22L24 26L18 42L6 6Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M24 26L32 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="no-conversation__label">Select a chat to start messaging</p>
    </div>
  )
}
