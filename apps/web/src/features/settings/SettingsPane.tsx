import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { ProfilePhotoModal } from './ProfilePhotoModal.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { buildProfilePhotoUrl, useProfilePhoto } from '../../hooks/useProfilePhotos.ts'
import { BottomTabBar } from '../sidebar/BottomTabBar.tsx'
import type { useAuth } from '../../hooks/useAuth.ts'
import type { useChatSessions } from '../../hooks/useChatSessions.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useServers } from '../../hooks/useServers.ts'
import { type UserSettings } from '../../hooks/useSettings.ts'
import { listDevices, revokeDevice, updateProfile, fetchMe } from '../../lib/api.ts'
import { buildApiRoot } from '../../lib/api-request.ts'
import type { DeviceInfo } from '../../lib/api.ts'
import { getCallCapability } from '../../lib/media-e2ee.ts'
import { ThemePicker } from './ThemePicker.tsx'
import { ServerManagementSection } from './ServerManagementSection.tsx'
import {
  Toggle,
  ToggleRow,
  ChevronRow,
  RadioRow,
  InfoRow,
  ButtonRow,
  SectionLabel,
  GroupCard,
  rowStyle,
  lastRowMod,
} from './SettingsPrimitives.tsx'
import {
  BackIcon,
  RefreshIcon,
  SearchIcon,
  ChevronRightIcon,
  SettingsIcon,
  ShieldIcon,
  LockIcon,
  MonitorIcon,
} from '../../icons/index.tsx'
import {
  Bell,
  Database,
  Paintbrush,
  Cloud,
  Camera,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────────

type Section =
  | 'servers'
  | 'general'
  | 'my-profile'
  | 'notifications'
  | 'privacy'
  | 'data-storage'
  | 'active-sessions'
  | 'appearance'
  | 'encryption'

type SettingsPaneProps = {
  auth: ReturnType<typeof useAuth>
  chatSessions: ReturnType<typeof useChatSessions>
  chatList: ReturnType<typeof useChatList>
  servers: ReturnType<typeof useServers>
  settingsHook: SettingsHook
  onClose: () => void
}

// ─── Section title mapping ──────────────────────────────────────────────────────

const SECTION_TITLES: Record<Section, string> = {
  'servers': 'Servers',
  'general': 'General',
  'my-profile': 'My Profile',
  'notifications': 'Notifications and Sounds',
  'privacy': 'Privacy and Security',
  'data-storage': 'Data and Storage',
  'active-sessions': 'Active Sessions',
  'appearance': 'Appearance',
  'encryption': 'Encryption',
}

// ─── Nav item config ────────────────────────────────────────────────────────────

type NavEntry = { id: Section; label: string; icon: ReactNode; badge?: string; secondary?: string }

const LI = 20 // lucide icon size

const NAV_ITEMS: NavEntry[] = [
  { id: 'servers', label: 'Servers', icon: <Cloud size={LI} strokeWidth={1.75} /> },
  { id: 'general', label: 'General', icon: <SettingsIcon /> },
  { id: 'notifications', label: 'Notifications and Sounds', icon: <Bell size={LI} strokeWidth={1.75} /> },
  { id: 'privacy', label: 'Privacy and Security', icon: <LockIcon /> },
  { id: 'data-storage', label: 'Data and Storage', icon: <Database size={LI} strokeWidth={1.75} /> },
  { id: 'active-sessions', label: 'Active Sessions', icon: <MonitorIcon />, badge: '4' },
  { id: 'appearance', label: 'Appearance', icon: <Paintbrush size={LI} strokeWidth={1.75} /> },
]

const NAV_ITEMS_BOTTOM: NavEntry[] = [
  { id: 'encryption', label: 'Encryption', icon: <ShieldIcon /> },
]

// ─── Settings hook result type ──────────────────────────────────────────────────

type SettingsHook = {
  settings: UserSettings
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void
  toggle: (key: keyof UserSettings) => void
  resetGroup: (prefix: string) => void
  synced: boolean
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function SettingsPane({ auth, chatSessions, chatList, servers, settingsHook, onClose }: SettingsPaneProps) {
  const { setSidebarTab, setSettingsOverlayOpen, initialSettingsSection, setInitialSettingsSection } = useUIContext()
  const [activeSection, setActiveSection] = useState<Section>(() => {
    if (initialSettingsSection && initialSettingsSection in SECTION_TITLES) {
      return initialSettingsSection as Section
    }
    return 'general'
  })
  const [mobileShowDetail, setMobileShowDetail] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const token = servers.activeServerScope?.token ?? auth.authSession?.accessToken ?? null

  // Clear the initial section after it's consumed
  useEffect(() => {
    if (initialSettingsSection) setInitialSettingsSection(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track mobile viewport
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 600)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // In mobile, selecting a section shows the detail view
  function handleSelectSection(section: Section) {
    setActiveSection(section)
    if (isMobile) setMobileShowDetail(true)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const profileUsername = servers.activeServer?.auth?.user.username ?? auth.profileUsername
  const profileInitial = profileUsername?.[0]?.toUpperCase() ?? '?'
  const profileName = profileUsername ?? 'Unknown'
  const settingsUserId = servers.activeServer?.auth?.user.id ?? auth.authSession?.user.id
  const settingsPhotoUrl = useProfilePhoto(settingsUserId, servers.activeServer?.url)

  return (
    <div className="settings-pane" style={{ display: 'flex', height: '100%', width: '100%' }}>
      {/* ─── Sidebar (hidden in mobile when detail is shown) ──────────────── */}
      <aside style={{
        width: isMobile ? '100%' : 360,
        flexShrink: 0,
        display: isMobile && mobileShowDetail ? 'none' : 'flex',
        flexDirection: 'column',
        borderRight: isMobile ? 'none' : '1px solid var(--border-subtle)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 22, fontWeight: 700, flex: 1 }}>Settings</span>
        </div>

        {/* Search */}
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface-1)', borderRadius: 20, padding: '0 12px', height: 38 }}>
            <SearchIcon />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--label)' }}
            />
          </div>
        </div>

        {/* Scrollable nav */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          {/* Profile card */}
          <button
            type="button"
            onClick={() => handleSelectSection('my-profile')}
            className={`settings-profile-card${activeSection === 'my-profile' ? ' settings-profile-card--active' : ''}`}
          >
            {settingsPhotoUrl ? (
              <img src={settingsPhotoUrl} alt={profileName} className="settings-profile-card__avatar" />
            ) : (
              <div className="settings-profile-card__avatar settings-profile-card__avatar--fallback">
                {profileInitial}
              </div>
            )}
            <div className="settings-profile-card__info">
              <div className="settings-profile-card__name">{profileName}</div>
              <div className="settings-profile-card__handle">@{profileUsername ?? ''}</div>
            </div>
            <ChevronRightIcon />
          </button>

          {/* Nav items */}
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeSection === item.id}
              onClick={() => handleSelectSection(item.id)}
            />
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '8px 8px' }} />

          {NAV_ITEMS_BOTTOM.map((item) => (
            <NavButton
              key={item.id}
              item={item.id === 'servers'
                ? {
                    ...item,
                    secondary:
                      servers.servers.length > 1
                        ? `${servers.servers.length} servers connected`
                        : servers.activeServer?.label ?? 'No servers'
                  }
                : item}
              active={activeSection === item.id}
              onClick={() => handleSelectSection(item.id)}
            />
          ))}

        </div>

        {/* Bottom Nav — use the same BottomTabBar component for consistent layout */}
        <BottomTabBar
          activeTab="settings"
          onTabChange={(tab) => {
            if (tab === 'settings') return
            setSettingsOverlayOpen(false)
            setSidebarTab(tab)
          }}
        />
      </aside>

      {/* ─── Right Pane (full-width in mobile, hidden when list shown) ────── */}
      <div style={{
        flex: 1,
        display: isMobile && !mobileShowDetail ? 'none' : 'flex',
        flexDirection: 'column',
        minWidth: 0,
        width: isMobile ? '100%' : undefined
      }}>
        {/* Header */}
        <div style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileShowDetail(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', display: 'flex', padding: 4 }}
              aria-label="Back to settings list"
            >
              <BackIcon width={20} height={20} />
            </button>
          )}
          <span style={{ fontSize: 17, fontWeight: 600, flex: 1, textAlign: isMobile ? 'left' : 'center' }}>{SECTION_TITLES[activeSection]}</span>
        </div>

        {/* Scrollable body */}
        <div key={activeSection} className="settings-pane__body--animate" style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 32px' }}>
          <SectionContent
            section={activeSection}
            auth={auth}
            chatSessions={chatSessions}
            chatList={chatList}
            servers={servers}
            onClose={onClose}
            settingsHook={settingsHook}
            token={token}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar nav button ─────────────────────────────────────────────────────────

function NavButton({ item, active, onClick }: { item: NavEntry; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`settings-pane__nav-item${active ? ' settings-pane__nav-item--active' : ''}`}
      style={{ borderRadius: 12, padding: '0 16px', fontSize: 14, fontWeight: active ? 600 : 400 }}
    >
      <span className="settings-pane__nav-icon" style={{ color: active ? 'var(--accent)' : undefined }}>{item.icon}</span>
      <span className="settings-pane__nav-label">{item.label}</span>
      {item.badge && (
        <span style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '2px 7px', lineHeight: '16px' }}>
          {item.badge}
        </span>
      )}
      {item.secondary && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.secondary}</span>}
      <ChevronRightIcon />
    </button>
  )
}

// ─── Section Content Router ─────────────────────────────────────────────────────

function SectionContent({ section, auth, chatSessions, chatList, servers, onClose, settingsHook, token }: { section: Section; settingsHook: SettingsHook; token: string | null } & SettingsPaneProps) {
  const s = settingsHook
  switch (section) {
    case 'general': return <GeneralSection s={s} />
    case 'my-profile': return (
      <MyProfileSection
        token={token}
        serverUrl={servers.activeServer?.url ?? null}
        userId={servers.activeServer?.auth?.user.id ?? auth.authSession?.user.id ?? null}
        profileUsername={servers.activeServer?.auth?.user.username ?? auth.profileUsername}
      />
    )
    case 'notifications': return <NotificationsSection s={s} />
    case 'privacy': return <PrivacySection s={s} auth={auth} chatSessions={chatSessions} chatList={chatList} onClose={onClose} />
    case 'data-storage': return <DataStorageSection s={s} serverUrl={servers.activeServer?.url ?? null} />
    case 'active-sessions': return <ActiveSessionsSection token={token} />
    case 'appearance': return <AppearanceSection s={s} />
    case 'servers': return <ServerManagementSection servers={servers} />
    case 'encryption': return <EncryptionSection />
  }
}

// ─── General ────────────────────────────────────────────────────────────────────

function GeneralSection({ s }: { s: SettingsHook }) {
  const { settings, toggle, updateSetting } = s
  const { setShortcutsOpen } = useUIContext()

  return (
    <>
      <SectionLabel>Spelling and Grammar</SectionLabel>
      <GroupCard>
        <ToggleRow label="Autocorrect" on={settings.general_autocorrect} onToggle={() => toggle('general_autocorrect')} />
        <ToggleRow label="Capitalize Words" on={settings.general_capitalize} onToggle={() => toggle('general_capitalize')} />
        <ToggleRow label="Spelling Suggestions" on={settings.general_spelling} onToggle={() => toggle('general_spelling')} last />
      </GroupCard>
      <SectionLabel>Emoji</SectionLabel>
      <GroupCard>
        <ToggleRow label="Replace Emoji Codes" on={settings.general_replace_emoji} onToggle={() => toggle('general_replace_emoji')} />
        <ToggleRow label="Suggest Emoji" on={settings.general_suggest_emoji} onToggle={() => toggle('general_suggest_emoji')} />
        <ToggleRow label="Large Emoji" on={settings.general_large_emoji} onToggle={() => toggle('general_large_emoji')} last />
      </GroupCard>
      <SectionLabel>Interface</SectionLabel>
      <GroupCard>
        <ToggleRow label="Show Unread Counter" on={settings.general_unread_counter} onToggle={() => toggle('general_unread_counter')} />
        <ToggleRow label="Compact Mode" on={settings.general_compact} onToggle={() => toggle('general_compact')} />
        <ToggleRow label="Show Avatars" on={settings.general_show_avatars} onToggle={() => toggle('general_show_avatars')} />
        <ToggleRow label="Animations" on={settings.general_animations} onToggle={() => toggle('general_animations')} last />
      </GroupCard>
      <SectionLabel>Shortcuts</SectionLabel>
      <GroupCard>
        <ButtonRow label="View Keyboard Shortcuts" color="accent" onClick={() => setShortcutsOpen(true)} last />
      </GroupCard>
      <SectionLabel>Send Key</SectionLabel>
      <GroupCard>
        <RadioRow label="Enter" active={settings.general_send_key === 'enter'} onSelect={() => updateSetting('general_send_key', 'enter')} />
        <RadioRow label="Ctrl + Enter" active={settings.general_send_key === 'ctrl-enter'} onSelect={() => updateSetting('general_send_key', 'ctrl-enter')} last />
      </GroupCard>
    </>
  )
}

// ─── My Profile ─────────────────────────────────────────────────────────────────

function MyProfileSection({
  token,
  serverUrl,
  userId,
  profileUsername
}: {
  token: string | null
  serverUrl: string | null
  userId: string | null
  profileUsername: string | null
}) {
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [uname, setUname] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [photoModalOpen, setPhotoModalOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)

  // Check if profile photo exists (public URL, no auth needed)
  useEffect(() => {
    if (!userId) return
    const url = buildProfilePhotoUrl(userId, serverUrl)
    fetch(url)
      .then((r) => r.ok ? setProfilePhotoUrl(`${url}?v=${Date.now()}`) : null)
      .catch(() => null)
  }, [serverUrl, userId])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load profile from /me on mount
  useEffect(() => {
    if (!token) return
    fetchMe(token).then((data) => {
      setDisplayName(data.user.display_name ?? '')
      setBio(data.user.bio ?? '')
      setUname(data.user.username ?? '')
    }).catch(() => {
      // Fall back to what we have locally
      setDisplayName(profileUsername ?? '')
      setUname(profileUsername ?? '')
    })
  }, [profileUsername, token, userId])

  const debouncedSave = useCallback((fields: { display_name?: string; bio?: string; username?: string }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(() => {
      if (!token) return
      updateProfile(token, fields)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    }, 1000)
  }, [token])

  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val)
    debouncedSave({ display_name: val, bio, username: uname })
  }
  const handleBioChange = (val: string) => {
    setBio(val)
    debouncedSave({ display_name: displayName, bio: val, username: uname })
  }
  const handleUsernameChange = (val: string) => {
    setUname(val)
    debouncedSave({ display_name: displayName, bio, username: val })
  }

  const initial = (displayName || uname)?.[0]?.toUpperCase() ?? '?'

  const inputStyle: CSSProperties = {
    width: '100%', height: 44, border: 'none', borderBottom: '1px solid var(--border-subtle)',
    background: 'none', outline: 'none', fontSize: 14, color: 'var(--label)', padding: '0 20px',
  }

  return (
    <>
      <SectionLabel>Profile Photo</SectionLabel>
      <GroupCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20 }}>
          {profilePhotoUrl ? (
            <img src={profilePhotoUrl} alt={displayName || uname} style={{
              width: 80, height: 80, borderRadius: 40, objectFit: 'cover', flexShrink: 0,
            }} />
          ) : (
            <div style={{
              width: 80, height: 80, borderRadius: 40,
              background: 'linear-gradient(135deg, var(--accent), #FF9500)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, fontWeight: 700, color: '#fff', position: 'relative', flexShrink: 0,
            }}>
              {initial}
            </div>
          )}
          <button type="button" onClick={() => setPhotoModalOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid var(--border-subtle)',
            borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600,
          }}>
            <Camera size={16} strokeWidth={1.75} />
            Change Photo
          </button>
        </div>
      </GroupCard>
      {saveStatus !== 'idle' && (
        <div style={{ fontSize: 12, padding: '4px 20px', color: saveStatus === 'error' ? 'var(--status-error)' : saveStatus === 'saving' ? 'var(--text-secondary)' : 'var(--green, #34C759)' }}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error saving profile'}
        </div>
      )}
      <SectionLabel>Display Name</SectionLabel>
      <GroupCard>
        <input placeholder="Display Name" value={displayName} onChange={(e) => handleDisplayNameChange(e.target.value)} style={{ ...inputStyle, borderBottom: 'none' }} />
      </GroupCard>
      <SectionLabel>Bio</SectionLabel>
      <GroupCard>
        <textarea
          placeholder="Write something about yourself..."
          value={bio}
          onChange={(e) => handleBioChange(e.target.value)}
          maxLength={256}
          style={{ ...inputStyle, height: 80, resize: 'none', paddingTop: 12, borderBottom: 'none', fontFamily: 'inherit' }}
        />
      </GroupCard>
      <SectionLabel>Username</SectionLabel>
      <GroupCard>
        <input placeholder="Username" value={uname} onChange={(e) => handleUsernameChange(e.target.value)} style={{ ...inputStyle, borderBottom: 'none' }} />
      </GroupCard>
      {photoModalOpen && (
        <ProfilePhotoModal
          initial={initial}
          hasExistingPhoto={!!profilePhotoUrl}
          onClose={() => setPhotoModalOpen(false)}
          onPhotoUpdated={(url) => {
            if (url && userId) {
              setProfilePhotoUrl(buildProfilePhotoUrl(userId, serverUrl, true))
            } else {
              setProfilePhotoUrl(null)
            }
          }}
        />
      )}
    </>
  )
}

// ─── Notifications ──────────────────────────────────────────────────────────────

function NotificationsSection({ s }: { s: SettingsHook }) {
  const { settings, toggle, resetGroup } = s

  return (
    <>
      <SectionLabel description="Control how you receive alerts">Desktop Notifications</SectionLabel>
      <GroupCard>
        <ToggleRow label="Desktop Notifications" on={settings.notif_desktop} onToggle={() => toggle('notif_desktop')} />
        <ToggleRow label="Notification Sound" on={settings.notif_sound} onToggle={() => toggle('notif_sound')} />
        <ToggleRow label="Badge Count" on={settings.notif_badge} onToggle={() => toggle('notif_badge')} />
        <ToggleRow label="Message Preview" on={settings.notif_preview} onToggle={() => toggle('notif_preview')} />
        <ToggleRow label="In-App Notifications" on={settings.notif_in_app} onToggle={() => toggle('notif_in_app')} />
        <ToggleRow label="Flash Window" on={settings.notif_flash_window} onToggle={() => toggle('notif_flash_window')} last />
      </GroupCard>
      <SectionLabel>Private Chats</SectionLabel>
      <GroupCard>
        <ToggleRow label="Notifications" on={settings.notif_private_msg} onToggle={() => toggle('notif_private_msg')} />
        <ToggleRow label="Mentions Only" on={settings.notif_private_mention} onToggle={() => toggle('notif_private_mention')} />
        <ToggleRow label="Show Preview" on={settings.notif_private_preview} onToggle={() => toggle('notif_private_preview')} last />
      </GroupCard>
      <SectionLabel>Groups</SectionLabel>
      <GroupCard>
        <ToggleRow label="Notifications" on={settings.notif_group_msg} onToggle={() => toggle('notif_group_msg')} />
        <ToggleRow label="Mentions Only" on={settings.notif_group_mention} onToggle={() => toggle('notif_group_mention')} />
        <ToggleRow label="Show Preview" on={settings.notif_group_preview} onToggle={() => toggle('notif_group_preview')} last />
      </GroupCard>
      <SectionLabel>Channels</SectionLabel>
      <GroupCard>
        <ToggleRow label="Notifications" on={settings.notif_chan_msg} onToggle={() => toggle('notif_chan_msg')} />
        <ToggleRow label="Mentions Only" on={settings.notif_chan_mention} onToggle={() => toggle('notif_chan_mention')} />
        <ToggleRow label="Show Preview" on={settings.notif_chan_preview} onToggle={() => toggle('notif_chan_preview')} last />
      </GroupCard>
      <SectionLabel>Reset</SectionLabel>
      <GroupCard>
        <ButtonRow label="Reset All Notifications" color="danger" onClick={() => resetGroup('notif_')} last />
      </GroupCard>
    </>
  )
}

// ─── Privacy ────────────────────────────────────────────────────────────────────

function PrivacySection(
  { s, auth, chatSessions, chatList, onClose }:
  { s: SettingsHook; auth: ReturnType<typeof useAuth>; chatSessions: ReturnType<typeof useChatSessions>; chatList: ReturnType<typeof useChatList>; onClose: () => void }
) {
  const { settings, toggle } = s

  return (
    <>
      <SectionLabel description="Control who can see your information">Privacy</SectionLabel>
      <GroupCard>
        <ToggleRow label="Last Seen" on={settings.privacy_last_seen} onToggle={() => toggle('privacy_last_seen')} />
        <ToggleRow label="Profile Photo" on={settings.privacy_profile_photo} onToggle={() => toggle('privacy_profile_photo')} />
        <ToggleRow label="Online Status" on={settings.privacy_online_status} onToggle={() => toggle('privacy_online_status')} />
        <ToggleRow label="Read Receipts" on={settings.privacy_read_receipts} onToggle={() => toggle('privacy_read_receipts')} />
        <ToggleRow label="Typing Indicators" on={settings.privacy_typing_indicators} onToggle={() => toggle('privacy_typing_indicators')} last />
      </GroupCard>
      <SectionLabel description="Manage your account protection">Security</SectionLabel>
      <GroupCard>
        <ToggleRow label="Two-Factor Authentication" on={settings.privacy_two_factor} onToggle={() => toggle('privacy_two_factor')} />
        <ToggleRow label="Login Alerts" on={settings.privacy_login_alerts} onToggle={() => toggle('privacy_login_alerts')} />
        <ToggleRow label="Session Logging" on={settings.privacy_session_log} onToggle={() => toggle('privacy_session_log')} last />
      </GroupCard>
      <GroupCard>
        <button
          type="button"
          onClick={() => { onClose(); auth.handleReauthenticate() }}
          style={{ ...rowStyle, cursor: 'pointer', border: 'none', textAlign: 'left', color: 'var(--accent)', fontWeight: 600, borderBottom: 'none' }}
        >
          <RefreshIcon />
          Refresh Session
        </button>
      </GroupCard>
      {chatSessions.safetyNumbers.length > 0 && (
        <>
          <SectionLabel>Safety Numbers</SectionLabel>
          <GroupCard>
            {chatSessions.safetyNumbers.map((entry, i) => (
              <div key={entry.peerDeviceId} style={{ ...rowStyle, height: 'auto', padding: '12px 20px', flexDirection: 'column', alignItems: 'stretch', gap: 4, ...(i === chatSessions.safetyNumbers.length - 1 ? lastRowMod : {}) }}>
                <strong style={{ fontSize: 13 }}>{entry.label}</strong>
                <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--label2)' }}>{entry.fingerprint}</span>
                <div style={{ marginTop: 4 }}>
                  {!entry.verified ? (
                    <button
                      type="button"
                      className="mini-action"
                      disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId}
                      onClick={() => {
                        if (!chatList.activeChatId) return
                        void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)
                      }}
                    >
                      Verify
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>Verified</span>
                  )}
                </div>
              </div>
            ))}
          </GroupCard>
        </>
      )}
    </>
  )
}

// ─── Data and Storage ───────────────────────────────────────────────────────────

function ServerStorageBar({ serverUrl }: { serverUrl: string | null }) {
  const { sessionToken } = useAppContext()
  const [usage, setUsage] = useState<{ usage_bytes: number; max_bytes: number; usage_ratio: number } | null>(null)

  useEffect(() => {
    if (!sessionToken) return
    const apiRoot = buildApiRoot(serverUrl ?? window.location.origin)

    fetch(`${apiRoot}/server/storage`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    })
      .then((r) => r.ok ? r.json() : null)
      .then(setUsage)
      .catch(() => {})
  }, [serverUrl, sessionToken])

  if (!usage) return null

  const usedGB = (usage.usage_bytes / (1024 * 1024 * 1024)).toFixed(1)
  const maxGB = (usage.max_bytes / (1024 * 1024 * 1024)).toFixed(0)
  const pct = Math.round(usage.usage_ratio * 100)
  const barColor = pct >= 90 ? 'var(--status-error)' : pct >= 70 ? 'var(--status-warning, #f0a030)' : 'var(--accent)'

  return (
    <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--label)', marginBottom: 6 }}>
        <span>Server Storage</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{usedGB} GB / {maxGB} GB</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 3, background: barColor, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function DataStorageSection({ s, serverUrl }: { s: SettingsHook; serverUrl: string | null }) {
  const { settings, toggle } = s
  const [storageEstimate, setStorageEstimate] = useState<string>(() => (
    typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function'
      ? '...'
      : 'Unknown'
  ))
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        const usageMB = Math.round((est.usage ?? 0) / (1024 * 1024))
        setStorageEstimate(`${usageMB} MB`)
      }).catch(() => setStorageEstimate('Unknown'))
    }
  }, [clearing])

  const handleClearCache = async () => {
    setClearing(true)
    try {
      // Clear Cache API
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      // Clear IndexedDB stores
      const dbs = await indexedDB.databases?.() ?? []
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
    } catch {
      // best effort
    }
    setClearing(false)
  }

  return (
    <>
      <SectionLabel>Storage Usage</SectionLabel>
      <GroupCard>
        <ServerStorageBar serverUrl={serverUrl} />
        <InfoRow label="Local Storage" value={storageEstimate} />
        <ChevronRow label="Cache Limit" secondary="2 GB" />
        <ChevronRow label="Keep Media" secondary="Forever" />
        <ButtonRow label={clearing ? 'Clearing...' : 'Clear Cache'} color="danger" onClick={handleClearCache} last />
      </GroupCard>
      <SectionLabel>Auto Download - Private Chats</SectionLabel>
      <GroupCard>
        <ToggleRow label="Photos" on={settings.data_auto_photos} onToggle={() => toggle('data_auto_photos')} />
        <ToggleRow label="Videos" on={settings.data_auto_videos} onToggle={() => toggle('data_auto_videos')} />
        <ToggleRow label="Documents" on={settings.data_auto_documents} onToggle={() => toggle('data_auto_documents')} />
        <ToggleRow label="Voice Messages" on={settings.data_auto_voice} onToggle={() => toggle('data_auto_voice')} last />
      </GroupCard>
      <ServerStorageAdmin serverUrl={serverUrl} />
    </>
  )
}

const STORAGE_PROFILES = {
  minimal: { label: 'Minimal', desc: '7-day retention, evict after delivery, no object store' },
  standard: { label: 'Standard', desc: '30-day hot, offload to object store (90 days)' },
  archival: { label: 'Archival', desc: 'Keep everything, offload to object store indefinitely' },
} as const

type ProfileKey = keyof typeof STORAGE_PROFILES

function ServerStorageAdmin({ serverUrl }: { serverUrl: string | null }) {
  const { sessionToken } = useAppContext()
  const [status, setStatus] = useState<{
    hot_cache?: { usage_bytes: number; max_bytes: number; usage_ratio: number; path: string }
    object_store?: { enabled: boolean; adapter: string }
    retention_profile?: string
    monitor?: { alert_level: string; uploads_allowed: boolean }
  } | null>(null)
  const [evicting, setEvicting] = useState(false)
  const [switching, setSwitching] = useState(false)

  const fetchStatus = useCallback(() => {
    if (!sessionToken) return
    const apiRoot = buildApiRoot(serverUrl ?? window.location.origin)

    fetch(`${apiRoot}/admin/storage/status`, {
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' }
    })
      .then((r) => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [serverUrl, sessionToken])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  if (!status) return null

  const hot = status.hot_cache
  if (!hot) return null

  const usageMB = Math.round(hot.usage_bytes / (1024 * 1024))
  const maxGB = Math.round(hot.max_bytes / (1024 * 1024 * 1024))
  const pct = Math.round(hot.usage_ratio * 100)
  const activeProfile = (status.retention_profile ?? 'standard') as ProfileKey

  const handleProfileSwitch = (profile: ProfileKey) => {
    if (!sessionToken || switching || profile === activeProfile) return
    const apiRoot = buildApiRoot(serverUrl ?? window.location.origin)
    setSwitching(true)
    fetch(`${apiRoot}/admin/storage/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile })
    })
      .then((r) => { if (r.ok) fetchStatus() })
      .finally(() => setSwitching(false))
  }

  return (
    <>
      <SectionLabel>Server Storage (Admin)</SectionLabel>
      <GroupCard>
        <InfoRow label="Hot Cache" value={`${usageMB} MB / ${maxGB} GB (${pct}%)`} />
        <InfoRow label="Object Storage" value={status.object_store?.enabled ? 'Enabled' : 'Disabled'} />
        <InfoRow label="Alert Level" value={status.monitor?.alert_level ?? 'normal'} last />
      </GroupCard>
      <SectionLabel>Retention Profile</SectionLabel>
      <GroupCard>
        {(Object.keys(STORAGE_PROFILES) as ProfileKey[]).map((key, i, arr) => (
          <button
            key={key}
            type="button"
            onClick={() => handleProfileSwitch(key)}
            disabled={switching}
            style={{
              ...rowStyle,
              ...(i === arr.length - 1 ? lastRowMod : {}),
              cursor: switching ? 'wait' : 'pointer',
              border: 'none',
              textAlign: 'left',
              opacity: switching ? 0.6 : 1,
            }}
          >
            <div style={{ flex: 1 }}>
              <div>{STORAGE_PROFILES[key].label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{STORAGE_PROFILES[key].desc}</div>
            </div>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                border: key === activeProfile ? 'none' : '2px solid var(--text-secondary)',
                background: key === activeProfile ? 'var(--accent)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {key === activeProfile && <span style={{ width: 8, height: 8, borderRadius: 4, background: '#fff' }} />}
            </span>
          </button>
        ))}
      </GroupCard>
      <SectionLabel>Actions</SectionLabel>
      <GroupCard>
        <ButtonRow
          label={evicting ? 'Running...' : 'Run Eviction Now'}
          color="accent"
          onClick={() => {
            if (!sessionToken || evicting) return
            const apiRoot = buildApiRoot(serverUrl ?? window.location.origin)
            setEvicting(true)
            fetch(`${apiRoot}/admin/storage/evict`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
              body: '{}'
            }).finally(() => setTimeout(() => { setEvicting(false); fetchStatus() }, 1000))
          }}
          last
        />
      </GroupCard>
    </>
  )
}

// ─── Active Sessions ────────────────────────────────────────────────────────────

function ActiveSessionsSection({ token }: { token: string | null }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  useEffect(() => {
    if (!token) return
    // Fetch both device list and current device id in parallel
    Promise.all([
      listDevices(token),
      fetchMe(token),
    ]).then(([devsResp, me]) => {
      setDevices(devsResp.devices.filter((d) => !d.revoked_at))
      setCurrentDeviceId(me.device?.id ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [token])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleRevoke = async (deviceId: string) => {
    if (!token) return
    setRevoking(deviceId)
    try {
      await revokeDevice(token, deviceId)
      setDevices((prev) => prev.filter((d) => d.id !== deviceId))
    } catch {
      // failed
    }
    setRevoking(null)
  }

  const handleRevokeAll = async () => {
    if (!token) return
    const others = devices.filter((d) => d.id !== currentDeviceId)
    for (const d of others) {
      try { await revokeDevice(token, d.id) } catch { /* skip */ }
    }
    setDevices((prev) => prev.filter((d) => d.id === currentDeviceId))
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Unknown'
    const d = new Date(iso)
    const diff = nowTs - d.getTime()
    if (diff < 60_000) return 'Just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hours ago`
    return `${Math.floor(diff / 86400_000)} days ago`
  }

  const currentDevice = devices.find((d) => d.id === currentDeviceId)
  const otherDevices = devices.filter((d) => d.id !== currentDeviceId)

  return (
    <>
      <SectionLabel>Current Session</SectionLabel>
      <GroupCard>
        {loading ? (
          <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>
        ) : currentDevice ? (
          <div style={{ padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{currentDevice.device_name || 'This Device'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Last active: Just now</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>Registered: {currentDevice.inserted_at ? new Date(currentDevice.inserted_at).toLocaleDateString() : 'Unknown'}</div>
          </div>
        ) : (
          <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>Current device not found</div>
        )}
      </GroupCard>
      <SectionLabel>Other Sessions ({otherDevices.length})</SectionLabel>
      <GroupCard>
        {otherDevices.length === 0 ? (
          <div style={{ ...rowStyle, ...lastRowMod, color: 'var(--text-secondary)', fontSize: 13 }}>No other sessions</div>
        ) : (
          otherDevices.map((d, i) => (
            <div key={d.id} style={{ ...rowStyle, ...(i === otherDevices.length - 1 ? lastRowMod : {}), height: 'auto', padding: '12px 20px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{d.device_name || 'Unknown Device'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Last active: {formatTime(d.last_active_at)}</div>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(d.id)}
                disabled={revoking === d.id}
                style={{ background: 'none', border: '1px solid var(--status-error)', borderRadius: 6, padding: '4px 10px', color: 'var(--status-error)', fontSize: 12, cursor: 'pointer', fontWeight: 600, opacity: revoking === d.id ? 0.5 : 1 }}
              >
                {revoking === d.id ? 'Revoking...' : 'Terminate'}
              </button>
            </div>
          ))
        )}
      </GroupCard>
      {otherDevices.length > 0 && (
        <GroupCard>
          <ButtonRow label="Terminate All Other Sessions" color="danger" onClick={handleRevokeAll} last />
        </GroupCard>
      )}
    </>
  )
}

// ─── Appearance ─────────────────────────────────────────────────────────────────

function AppearanceSection({ s }: { s: SettingsHook }) {
  const { settings, toggle } = s

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <ThemePicker />
      </div>
      <SectionLabel>Chat Display</SectionLabel>
      <GroupCard>
        <ToggleRow label="Compact Mode" on={settings.general_compact} onToggle={() => toggle('general_compact')} />
        <ToggleRow label="Show Avatars" on={settings.general_show_avatars} onToggle={() => toggle('general_show_avatars')} />
        <ToggleRow label="Show Timestamps" on={settings.appearance_timestamps} onToggle={() => toggle('appearance_timestamps')} last />
      </GroupCard>
    </>
  )
}

// ─── Language (removed — no i18n system) ────────────────────────────────────────

// ─── Stickers and Emoji ─────────────────────────────────────────────────────────

// ─── Encryption ─────────────────────────────────────────────────────────────────

function EncryptionSection() {
  const callCapability = getCallCapability()
  const mediaE2eeEnabled = callCapability.state === 'supported'
  const supportTone =
    callCapability.state === 'supported'
      ? 'var(--green, #34C759)'
      : 'var(--status-warning, #f0a030)'
  const userAgent =
    typeof navigator === 'undefined'
      ? 'Unknown'
      : navigator.userAgent

  return (
    <>
      <SectionLabel description="End-to-end encryption protects your messages">Encryption Status</SectionLabel>
      <GroupCard>
        <div style={{ ...rowStyle }}>
          <span style={{ flex: 1 }}>End-to-End Encryption</span>
          <span style={{ fontSize: 13, color: 'var(--green, #34C759)', fontWeight: 600 }}>Enabled</span>
        </div>
        <InfoRow label="Algorithm" value="Double Ratchet (X3DH)" last />
      </GroupCard>

      <SectionLabel description="Direct, group, and room calls require browser support for encrypted media transforms">
        Call Media Compatibility
      </SectionLabel>
      <GroupCard>
        <div style={{ ...rowStyle }}>
          <span style={{ flex: 1 }}>Encrypted Calling</span>
          <span style={{ fontSize: 13, color: supportTone, fontWeight: 600 }}>
            {mediaE2eeEnabled ? 'Supported' : 'Unavailable'}
          </span>
        </div>
        <InfoRow label="Host" value={callCapability.hostKind === 'desktop' ? 'Desktop shell' : 'Browser'} />
        <InfoRow label="Browser" value={callCapability.browserName} />
        <InfoRow
          label="Transport"
          value={
            callCapability.transport === 'standard'
              ? 'Standard encoded transforms'
              : callCapability.transport === 'legacy'
                ? 'Legacy encoded streams'
                : 'Unsupported'
          }
        />
        <div style={{ ...rowStyle, height: 'auto', minHeight: 56, alignItems: 'flex-start', padding: '12px 20px' }}>
          <span style={{ flex: 1 }}>Status</span>
          <span style={{ fontSize: 13, color: mediaE2eeEnabled ? 'var(--text-secondary)' : 'var(--status-warning, #f0a030)', textAlign: 'right', maxWidth: 280 }}>
            {callCapability.reason ?? 'This browser can place and join encrypted calls.'}
          </span>
        </div>
        <div style={{ ...rowStyle, ...lastRowMod, height: 'auto', minHeight: 56, alignItems: 'flex-start', padding: '12px 20px' }}>
          <span style={{ flex: 1 }}>User Agent</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', maxWidth: 280, wordBreak: 'break-word' }}>
            {userAgent}
          </span>
        </div>
      </GroupCard>
    </>
  )
}
