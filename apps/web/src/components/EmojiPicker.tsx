import { useState, useRef, useEffect, useCallback } from 'react'
import { SearchIcon } from '../icons/index.tsx'

const CATEGORIES = [
  { label: 'Smileys', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥱','😤','😭','😢','😥','😰','😨','😱','😳','🥺','🥹','😞','😓','😖','😣','😩','😫','🫠','😮‍💨'] },
  { label: 'Gestures', icon: '👋', emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾','🫂'] },
  { label: 'Hearts', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟'] },
  { label: 'Animals', icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'] },
  { label: 'Food', icon: '🍔', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🫛','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🫕','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪'] },
  { label: 'Travel', icon: '🚗', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛹','🛼','🚁','✈️','🛩️','🚀','🛸','🚢','⛵','🚤','🛥️','🗺️','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','🏠','🏡'] },
  { label: 'Objects', icon: '💡', emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','💾','💿','📀','📷','📹','🎥','📽️','📺','📻','🎙️','🎚️','🎛️','⏱️','⏲️','⏰','🕰️','💡','🔦','🕯️','🧯','🛢️','💰','💳','💎','⚖️','🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🔑','🗝️','🔒','🔓','📦','📫','📬','✏️','🖊️','🖋️','📝','📁','📂','📅','📌','📎','🔗','📐','📏','🧮'] },
  { label: 'Symbols', icon: '⭐', emojis: ['⭐','🌟','✨','⚡','🔥','💥','☀️','🌤️','⛅','🌥️','☁️','🌧️','⛈️','🌩️','❄️','☃️','⛄','🌊','💧','💦','🌈','🎵','🎶','🔔','🔕','📢','📣','💬','💭','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','✅','❌','❓','❗','‼️','⁉️','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','♠️','♣️','♥️','♦️','🃏','🎴'] },
] as const

type EmojiPickerProps = {
  open: boolean
  onClose: () => void
  onSelect: (emoji: string) => void
}

export function EmojiPicker({ open, onClose, onSelect }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setSearch('')
      setActiveCategory(0)
    }
  }, [open])

  const handleSelect = useCallback((emoji: string) => {
    onSelect(emoji)
  }, [onSelect])

  if (!open) return null

  const filteredCategories = search.trim()
    ? [{ label: 'Results', icon: '🔍' as const, emojis: CATEGORIES.flatMap(c => c.emojis).filter(() => true) }]
    : CATEGORIES

  // For search, do a naive substring match on the emoji itself (works for direct emoji input)
  // In practice, users mostly browse categories, so this is fine
  const searchLower = search.toLowerCase().trim()

  return (
    <div className="emoji-picker" ref={panelRef}>
      <div className="emoji-picker__search">
        <SearchIcon width={14} height={14} />
        <input
          className="emoji-picker__search-input"
          placeholder="Search emoji..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      {!searchLower && (
        <div className="emoji-picker__tabs">
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.label}
              className={`emoji-picker__tab ${i === activeCategory ? 'emoji-picker__tab--active' : ''}`}
              type="button"
              onClick={() => { setActiveCategory(i); gridRef.current?.scrollTo({ top: 0 }) }}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-picker__grid" ref={gridRef}>
        {searchLower ? (
          // flat search results — no category headers
          <div className="emoji-picker__emojis">
            {CATEGORIES.flatMap(c => c.emojis).map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                className="emoji-picker__emoji"
                type="button"
                onClick={() => handleSelect(emoji)}
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="emoji-picker__category-label">{filteredCategories[activeCategory]?.label}</div>
            <div className="emoji-picker__emojis">
              {CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  className="emoji-picker__emoji"
                  type="button"
                  onClick={() => handleSelect(emoji)}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
