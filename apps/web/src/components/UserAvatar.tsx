import { useProfilePhoto } from '../hooks/useProfilePhotos.ts'

type UserAvatarProps = {
  userId?: string | null
  name: string
  serverUrl?: string | null
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
  online?: boolean
}

/**
 * Shared avatar component. Shows profile photo if available,
 * falls back to colored initial circle.
 */
export function UserAvatar({
  userId,
  name,
  serverUrl,
  size = 40,
  color,
  className,
  style,
  online,
}: UserAvatarProps) {
  const photoUrl = useProfilePhoto(userId, serverUrl)
  const initial = name.slice(0, 1).toUpperCase() || '?'
  const radius = size / 2

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: photoUrl ? undefined : (color || 'var(--gradient-button)'),
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        ...style,
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          style={{ width: size, height: size, objectFit: 'cover', borderRadius: radius }}
        />
      ) : (
        initial
      )}
      {online && (
        <span style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: Math.max(8, size * 0.2),
          height: Math.max(8, size * 0.2),
          borderRadius: '50%',
          background: 'var(--green, #4CAF50)',
          border: '2px solid var(--bg-panel)',
        }} />
      )}
    </div>
  )
}
