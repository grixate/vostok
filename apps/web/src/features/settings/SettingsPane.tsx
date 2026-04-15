import { useState, useEffect, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
import { DEFAULT_AUTO_DOWNLOAD as DEFAULT_AUTO_DOWNLOAD_SETTINGS } from '../../lib/download-manager.ts'
import type { AutoDownloadSettings } from '../../types.ts'
import { listDevices, revokeDevice, updateProfile, fetchMe } from '../../lib/api.ts'
import { buildApiRoot } from '../../lib/api-request.ts'
import type { DeviceInfo } from '../../lib/api.ts'
import { getCallCapability } from '../../lib/media-e2ee.ts'
import { ThemePicker } from './ThemePicker.tsx'
import { ServerManagementSection } from './ServerManagementSection.tsx'
import {
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
  SearchIcon,
  ChevronRightIcon,
  ShieldIcon,
  LockIcon,
} from '../../icons/index.tsx'
import {
  Bell,
  Database,
  Paintbrush,
  Cloud,
  Camera,
  Keyboard,
  Copy,
  Check,
} from 'lucide-react'
import { VOSTOK_CLIENT_VERSION } from '../../constants.ts'
import { changePassword } from '../../lib/api.ts'
import { t } from '../../lib/i18n.ts'
import { useLocale } from '../../contexts/LocaleContext.tsx'
import { getAvailableLocales } from '../../lib/i18n.ts'

const settingsSlideVariants = {
  enter: (d: number) => ({ x: d < 0 ? '-100%' : '100%' }),
  center: { x: 0 },
  exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
}

// ─── Types ──────────────────────────────────────────────────────────────────────

type Section =
  | 'servers'
  | 'my-profile'
  | 'notifications'
  | 'privacy'
  | 'data-storage'
  | 'appearance'
  | 'about-debug'

type SettingsPaneProps = {
  auth: ReturnType<typeof useAuth>
  chatSessions: ReturnType<typeof useChatSessions>
  chatList: ReturnType<typeof useChatList>
  servers: ReturnType<typeof useServers>
  settingsHook: SettingsHook
  onClose: () => void
}

// ─── Section title mapping ──────────────────────────────────────────────────────

function sectionTitle(s: Section): string {
  switch (s) {
    case 'servers': return t('servers')
    case 'my-profile': return t('my_profile')
    case 'notifications': return t('notifications_and_sounds')
    case 'privacy': return t('privacy_and_security')
    case 'data-storage': return t('data_and_storage')
    case 'appearance': return t('appearance')
    case 'about-debug': return t('about_and_debug')
  }
}

// ─── Nav item config ────────────────────────────────────────────────────────────

type NavEntry = { id: Section; label: string; icon: ReactNode; badge?: string; secondary?: string }

const LI = 20 // lucide icon size

const NAV_ICONS: Record<Section, ReactNode> = {
  'servers': <Cloud size={LI} strokeWidth={1.75} />,
  'notifications': <Bell size={LI} strokeWidth={1.75} />,
  'privacy': <LockIcon />,
  'data-storage': <Database size={LI} strokeWidth={1.75} />,
  'appearance': <Paintbrush size={LI} strokeWidth={1.75} />,
  'about-debug': <ShieldIcon />,
  'my-profile': null,
}

const NAV_ITEM_IDS: Section[] = ['servers', 'notifications', 'privacy', 'data-storage', 'appearance']
const NAV_ITEM_BOTTOM_IDS: Section[] = ['about-debug']

function navItems(): NavEntry[] {
  return NAV_ITEM_IDS.map((id) => ({ id, label: sectionTitle(id), icon: NAV_ICONS[id] }))
}

function navItemsBottom(): NavEntry[] {
  return NAV_ITEM_BOTTOM_IDS.map((id) => ({ id, label: sectionTitle(id), icon: NAV_ICONS[id] }))
}

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
  const { setSidebarTab, setSettingsOverlayOpen, setShortcutsOpen, initialSettingsSection, setInitialSettingsSection } = useUIContext()
  const [activeSection, setActiveSection] = useState<Section>(() => {
    const validSections: Section[] = ['servers', 'my-profile', 'notifications', 'privacy', 'data-storage', 'appearance', 'about-debug']
    if (initialSettingsSection && validSections.includes(initialSettingsSection as Section)) {
      return initialSettingsSection as Section
    }
    return 'my-profile'
  })
  const [mobileShowDetail, setMobileShowDetailRaw] = useState(false)
  const settingsDirRef = useRef<1 | -1>(1)
  const setMobileShowDetail = (show: boolean) => {
    settingsDirRef.current = show ? 1 : -1
    setMobileShowDetailRaw(show)
  }
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

  // Detect desktop-class input (mouse + hover). True in desktop browsers even
  // when resized to a mobile-width window; false on touch devices.
  const [isDesktopDevice, setIsDesktopDevice] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)')
    const handler = (e: MediaQueryListEvent) => setIsDesktopDevice(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
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

  const settingsNav = (
    <aside style={{
      width: isMobile ? '100%' : 360,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: isMobile ? 'none' : '1px solid var(--border-subtle)',
      overflow: 'hidden',
      height: '100%',
    }}>
      <div style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 700, flex: 1 }}>{t('settings')}</span>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface-1)', borderRadius: 20, padding: '0 12px', height: 38 }}>
          <SearchIcon />
          <input
            type="text"
            placeholder={t('search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--label)' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
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

        {navItems().map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeSection === item.id}
            onClick={() => handleSelectSection(item.id)}
          />
        ))}

        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '8px 8px' }} />

        {navItemsBottom().map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={activeSection === item.id}
            onClick={() => handleSelectSection(item.id)}
          />
        ))}

        {isDesktopDevice && (
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '0 16px', height: 44, borderRadius: 12, border: 'none',
              background: 'none', cursor: 'pointer', color: 'var(--text-muted)',
              fontSize: 13, marginTop: 4,
            }}
          >
            <Keyboard size={18} strokeWidth={1.75} />
            <span>{t('keyboard_shortcuts')}</span>
          </button>
        )}
      </div>

      <BottomTabBar
        activeTab="settings"
        onTabChange={(tab) => {
          if (tab === 'settings') return
          setSettingsOverlayOpen(false)
          setSidebarTab(tab)
        }}
        chatUnreadCount={chatList.chatItems.reduce((sum, c) => sum + (c.is_self_chat ? 0 : (c.message_count ?? 0)), 0)}
      />
    </aside>
  )

  const settingsDetail = (
    <div style={{
      flex: isMobile ? undefined : 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      width: isMobile ? '100%' : undefined,
      height: '100%',
    }}>
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
        <span style={{ fontSize: 17, fontWeight: 600, flex: 1, textAlign: isMobile ? 'left' : 'center' }}>{sectionTitle(activeSection)}</span>
      </div>

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
  )

  if (isMobile) {
    return (
      <div className="settings-pane" style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
        <AnimatePresence initial={false} mode="popLayout" custom={settingsDirRef.current}>
          {!mobileShowDetail ? (
            <motion.div
              key="settings-nav"
              custom={settingsDirRef.current}
              variants={settingsSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'tween', duration: 0.25, ease: [0.2, 0, 0, 1] }}
              style={{ width: '100%', height: '100%' }}
            >
              {settingsNav}
            </motion.div>
          ) : (
            <motion.div
              key="settings-detail"
              custom={settingsDirRef.current}
              variants={settingsSlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'tween', duration: 0.25, ease: [0.2, 0, 0, 1] }}
              style={{ width: '100%', height: '100%' }}
            >
              {settingsDetail}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="settings-pane" style={{ display: 'flex', height: '100%', width: '100%' }}>
      {settingsNav}
      {settingsDetail}
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
    case 'my-profile': return (
      <MyProfileSection
        token={token}
        serverUrl={servers.activeServer?.url ?? null}
        userId={servers.activeServer?.auth?.user.id ?? auth.authSession?.user.id ?? null}
        profileUsername={servers.activeServer?.auth?.user.username ?? auth.profileUsername}
      />
    )
    case 'notifications': return <NotificationsSection s={s} />
    case 'privacy': return <PrivacySection s={s} chatSessions={chatSessions} chatList={chatList} />
    case 'data-storage': return <DataStorageSection s={s} serverUrl={servers.activeServer?.url ?? null} />
    case 'appearance': return <AppearanceSection s={s} />
    case 'servers': return <ServerManagementSection servers={servers} />
    case 'about-debug': return <AboutDebugSection serverUrl={servers.activeServer?.url ?? null} />
  }
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

  // ── Change Password state ──
  const [pwExpanded, setPwExpanded] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'mismatch'>('idle')
  const pwTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Active Sessions state ──
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  // Check if profile photo exists (public URL, no auth needed)
  useEffect(() => {
    if (!userId) return
    const url = buildProfilePhotoUrl(userId, serverUrl)
    fetch(url)
      .then((r) => r.ok ? setProfilePhotoUrl(`${url}?v=${Date.now()}`) : null)
      .catch(() => null)
  }, [serverUrl, userId])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load profile and devices on mount
  useEffect(() => {
    if (!token) return
    Promise.all([
      fetchMe(token),
      listDevices(token),
    ]).then(([me, devsResp]) => {
      setDisplayName(me.user.display_name ?? '')
      setBio(me.user.bio ?? '')
      setUname(me.user.username ?? '')
      setDevices(devsResp.devices.filter((d) => !d.revoked_at))
      setCurrentDeviceId(me.device?.id ?? null)
      setSessionsLoading(false)
    }).catch(() => {
      setDisplayName(profileUsername ?? '')
      setUname(profileUsername ?? '')
      setSessionsLoading(false)
    })
  }, [profileUsername, token, userId])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

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

  const handleChangePassword = async () => {
    if (!token || !newPassword.trim()) return
    if (newPassword !== confirmPassword) {
      setPwStatus('mismatch')
      return
    }
    setPwStatus('saving')
    try {
      await changePassword(token, newPassword)
      setPwStatus('saved')
      setNewPassword('')
      setConfirmPassword('')
      if (pwTimerRef.current) clearTimeout(pwTimerRef.current)
      pwTimerRef.current = setTimeout(() => { setPwExpanded(false); setPwStatus('idle') }, 1500)
    } catch {
      setPwStatus('error')
    }
  }

  const handleRevoke = async (deviceId: string) => {
    if (!token) return
    setRevoking(deviceId)
    try {
      await revokeDevice(token, deviceId)
      setDevices((prev) => prev.filter((d) => d.id !== deviceId))
    } catch { /* failed */ }
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

  const initial = (displayName || uname)?.[0]?.toUpperCase() ?? '?'
  const currentDevice = devices.find((d) => d.id === currentDeviceId)
  const otherDevices = devices.filter((d) => d.id !== currentDeviceId)

  const inputStyle: CSSProperties = {
    width: '100%', height: 44, border: 'none', borderBottom: '1px solid var(--border-subtle)',
    background: 'none', outline: 'none', fontSize: 14, color: 'var(--label)', padding: '0 20px',
  }

  return (
    <>
      <SectionLabel>{t('profile_photo')}</SectionLabel>
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
            {t('change_photo')}
          </button>
        </div>
      </GroupCard>
      {saveStatus !== 'idle' && (
        <div style={{ fontSize: 12, padding: '4px 20px', color: saveStatus === 'error' ? 'var(--status-error)' : saveStatus === 'saving' ? 'var(--text-secondary)' : 'var(--green, #34C759)' }}>
          {saveStatus === 'saving' ? t('saving') : saveStatus === 'saved' ? t('saved') : t('error_saving_profile')}
        </div>
      )}
      <SectionLabel>{t('display_name')}</SectionLabel>
      <GroupCard>
        <input placeholder={t('display_name')} value={displayName} onChange={(e) => handleDisplayNameChange(e.target.value)} style={{ ...inputStyle, borderBottom: 'none' }} />
      </GroupCard>
      <SectionLabel>{t('bio')}</SectionLabel>
      <GroupCard>
        <textarea
          placeholder={t('bio_placeholder')}
          value={bio}
          onChange={(e) => handleBioChange(e.target.value)}
          maxLength={256}
          style={{ ...inputStyle, height: 80, resize: 'none', paddingTop: 12, borderBottom: 'none', fontFamily: 'inherit' }}
        />
      </GroupCard>
      <SectionLabel>{t('username')}</SectionLabel>
      <GroupCard>
        <input placeholder={t('username')} value={uname} onChange={(e) => handleUsernameChange(e.target.value)} style={{ ...inputStyle, borderBottom: 'none' }} />
      </GroupCard>

      {/* ── Account ── */}
      <SectionLabel>{t('account')}</SectionLabel>
      <GroupCard>
        {!pwExpanded ? (
          <ChevronRow label={t('change_password')} onClick={() => setPwExpanded(true)} last />
        ) : (
          <div style={{ padding: '12px 20px' }}>
            <input
              type="password"
              placeholder={t('new_password')}
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); if (pwStatus === 'mismatch') setPwStatus('idle') }}
              style={{ ...inputStyle, padding: '0', marginBottom: 8 }}
            />
            <input
              type="password"
              placeholder={t('confirm_password')}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); if (pwStatus === 'mismatch') setPwStatus('idle') }}
              style={{ ...inputStyle, padding: '0', marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwStatus === 'saving' || !newPassword.trim() || !confirmPassword.trim()}
                style={{
                  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  opacity: pwStatus === 'saving' || !newPassword.trim() || !confirmPassword.trim() ? 0.5 : 1,
                }}
              >
                {pwStatus === 'saving' ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                onClick={() => { if (pwTimerRef.current) clearTimeout(pwTimerRef.current); setPwExpanded(false); setNewPassword(''); setConfirmPassword(''); setPwStatus('idle') }}
                style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--label)' }}
              >
                {t('cancel')}
              </button>
            </div>
            {pwStatus === 'mismatch' && <div style={{ fontSize: 12, color: 'var(--status-error)', marginTop: 8 }}>{t('passwords_mismatch')}</div>}
            {pwStatus === 'saved' && <div style={{ fontSize: 12, color: 'var(--green, #34C759)', marginTop: 8 }}>{t('password_changed')}</div>}
            {pwStatus === 'error' && <div style={{ fontSize: 12, color: 'var(--status-error)', marginTop: 8 }}>{t('password_change_failed')}</div>}
          </div>
        )}
      </GroupCard>

      {/* ── Active Sessions ── */}
      <SectionLabel>{t('active_sessions')}</SectionLabel>
      <GroupCard>
        {sessionsLoading ? (
          <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>{t('loading')}</div>
        ) : currentDevice ? (
          <div style={{ ...rowStyle, height: 'auto', padding: '12px 20px', gap: 8 }}>
            <span style={{ color: 'var(--green, #34C759)', fontSize: 10, lineHeight: 1 }}>{'\u25CF'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{currentDevice.device_name || t('this_device')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{t('last_active_now')}</div>
            </div>
          </div>
        ) : null}
        {otherDevices.map((d, i) => (
          <div key={d.id} style={{ ...rowStyle, ...(i === otherDevices.length - 1 && otherDevices.length > 0 ? lastRowMod : {}), height: 'auto', padding: '12px 20px', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, lineHeight: 1 }}>{'\u25CB'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{d.device_name || t('unknown_device')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{t('last_active', formatTime(d.last_active_at))}</div>
            </div>
            <button
              type="button"
              onClick={() => handleRevoke(d.id)}
              disabled={revoking === d.id}
              style={{ background: 'none', border: '1px solid var(--status-error)', borderRadius: 6, padding: '4px 10px', color: 'var(--status-error)', fontSize: 12, cursor: 'pointer', fontWeight: 600, opacity: revoking === d.id ? 0.5 : 1 }}
            >
              {revoking === d.id ? t('revoking') : t('revoke')}
            </button>
          </div>
        ))}
        {!sessionsLoading && otherDevices.length === 0 && (
          <div style={{ ...rowStyle, ...lastRowMod, color: 'var(--text-secondary)', fontSize: 13 }}>{t('no_other_sessions')}</div>
        )}
      </GroupCard>
      {otherDevices.length > 0 && (
        <GroupCard>
          <ButtonRow label={t('terminate_all_sessions')} color="danger" onClick={handleRevokeAll} last />
        </GroupCard>
      )}

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
  const { settings, toggle } = s

  return (
    <>
      <SectionLabel>{t('notifications')}</SectionLabel>
      <GroupCard>
        <ToggleRow label={t('notifications')} on={settings.notif_desktop} onToggle={() => toggle('notif_desktop')} />
        <ToggleRow label={t('sound')} on={settings.notif_sound} onToggle={() => toggle('notif_sound')} />
        <ToggleRow label={t('badge_count')} on={settings.notif_badge} onToggle={() => toggle('notif_badge')} />
        <ToggleRow label={t('message_preview')} on={settings.notif_preview} onToggle={() => toggle('notif_preview')} last />
      </GroupCard>
    </>
  )
}

// ─── Privacy ────────────────────────────────────────────────────────────────────

function PrivacySection(
  { s, chatSessions, chatList }:
  { s: SettingsHook; chatSessions: ReturnType<typeof useChatSessions>; chatList: ReturnType<typeof useChatList> }
) {
  const { settings, toggle } = s

  return (
    <>
      <SectionLabel>{t('privacy')}</SectionLabel>
      <GroupCard>
        <ToggleRow label={t('last_seen')} on={settings.privacy_last_seen} onToggle={() => toggle('privacy_last_seen')} />
        <ToggleRow label={t('read_receipts')} on={settings.privacy_read_receipts} onToggle={() => toggle('privacy_read_receipts')} />
        <ToggleRow label={t('typing_indicators')} on={settings.privacy_typing_indicators} onToggle={() => toggle('privacy_typing_indicators')} last />
      </GroupCard>
      {chatSessions.safetyNumbers.length > 0 && (
        <>
          <SectionLabel>{t('safety_numbers')}</SectionLabel>
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
                      {t('verify')}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>{t('verified')}</span>
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
        <span>{t('server_storage')}</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{usedGB} GB / {maxGB} GB</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-surface-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 3, background: barColor, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

// ─── Auto-Download Settings Group ───────────────────────────────────────────────

function sizePresets() {
  return [
    { label: t('off'), bytes: 0 },
    { label: '5 MB', bytes: 5 * 1024 * 1024 },
    { label: '15 MB', bytes: 15 * 1024 * 1024 },
    { label: '50 MB', bytes: 50 * 1024 * 1024 },
    { label: '100 MB', bytes: 100 * 1024 * 1024 },
    { label: t('no_limit'), bytes: Number.MAX_SAFE_INTEGER },
  ]
}

function sizePresetLabel(bytes: number): string {
  if (bytes === 0) return t('off')
  if (bytes >= Number.MAX_SAFE_INTEGER) return t('no_limit')
  const mb = bytes / (1024 * 1024)
  return t('up_to', `${mb} MB`)
}

function mediaKindLabels(): Record<string, string> {
  return {
    photos: t('photos'),
    videos: t('videos'),
    files: t('files'),
    voice_messages: t('voice_messages'),
    round_videos: t('round_videos'),
  }
}

const MEDIA_KINDS = ['photos', 'videos', 'files', 'voice_messages', 'round_videos'] as const

function AutoDownloadGroup({
  label,
  chatKey,
  settings,
  updateSetting,
}: {
  label: string
  chatKey: 'private_chats' | 'group_chats'
  settings: UserSettings
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void
}) {
  const { auto_download } = settings
  const defaults = DEFAULT_AUTO_DOWNLOAD_SETTINGS
  const chatConfig = auto_download?.[chatKey] ?? defaults[chatKey]
  const [expandedKind, setExpandedKind] = useState<string | null>(null)

  function updateKind(kind: string, maxBytes: number) {
    const current = auto_download ?? defaults
    const updated: AutoDownloadSettings = {
      ...current,
      [chatKey]: {
        ...current[chatKey],
        [kind]: { ...current[chatKey][kind as keyof typeof current.private_chats], max_size_bytes: maxBytes },
      },
    }
    updateSetting('auto_download', updated)
  }

  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <GroupCard>
        {MEDIA_KINDS.map((kind) => {
          const config = chatConfig[kind]
          const isExpanded = expandedKind === kind
          return (
            <div key={kind}>
              <ChevronRow
                label={mediaKindLabels()[kind]}
                secondary={sizePresetLabel(config.max_size_bytes)}
                onClick={() => setExpandedKind(isExpanded ? null : kind)}
              />
              {isExpanded && (
                <div style={{ padding: '4px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sizePresets().map((preset) => (
                    <RadioRow
                      key={preset.label}
                      label={preset.label}
                      active={config.max_size_bytes === preset.bytes}
                      onSelect={() => { updateKind(kind, preset.bytes); setExpandedKind(null) }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </GroupCard>
    </>
  )
}

// ─── Data & Storage ─────────────────────────────────────────────────────────────

const KEEP_MEDIA_PRESETS = [
  { label: '3 days', seconds: 259200 },
  { label: '1 week', seconds: 604800 },
  { label: '1 month', seconds: 2592000 },
  { label: '3 months', seconds: 7776000 },
  { label: 'Forever', seconds: 0 },
]

const CACHE_LIMIT_PRESETS = [
  { label: '256 MB', bytes: 256 * 1024 * 1024 },
  { label: '512 MB', bytes: 512 * 1024 * 1024 },
  { label: '1 GB', bytes: 1024 * 1024 * 1024 },
  { label: '2 GB', bytes: 2 * 1024 * 1024 * 1024 },
  { label: '5 GB', bytes: 5 * 1024 * 1024 * 1024 },
  { label: 'No limit', bytes: 0 },
]

function keepMediaLabel(seconds: number): string {
  const preset = KEEP_MEDIA_PRESETS.find((p) => p.seconds === seconds)
  return preset?.label ?? 'Custom'
}

function cacheLimitLabel(bytes: number): string {
  const preset = CACHE_LIMIT_PRESETS.find((p) => p.bytes === bytes)
  return preset?.label ?? 'Custom'
}

function DataStorageSection({ s, serverUrl }: { s: SettingsHook; serverUrl: string | null }) {
  const { settings, updateSetting } = s
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [expandedSetting, setExpandedSetting] = useState<'keep' | 'limit' | null>(null)

  const handleClearAll = async () => {
    setClearing(true)
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      const dbs = await indexedDB.databases?.() ?? []
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
    } catch {
      // best effort
    }
    setClearing(false)
    setClearConfirm(false)
  }

  return (
    <>
      <SectionLabel>{t('storage')}</SectionLabel>
      <GroupCard>
        <ServerStorageBar serverUrl={serverUrl} />
        <ChevronRow
          label={t('keep_media')}
          secondary={keepMediaLabel(settings.data_keep_media_seconds)}
          onClick={() => setExpandedSetting(expandedSetting === 'keep' ? null : 'keep')}
        />
        {expandedSetting === 'keep' && (
          <div style={{ padding: '4px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {KEEP_MEDIA_PRESETS.map((preset) => (
              <RadioRow
                key={preset.label}
                label={preset.label}
                active={settings.data_keep_media_seconds === preset.seconds}
                onSelect={() => { updateSetting('data_keep_media_seconds', preset.seconds); setExpandedSetting(null) }}
              />
            ))}
          </div>
        )}
        <ChevronRow
          label={t('cache_limit')}
          secondary={cacheLimitLabel(settings.data_cache_limit_bytes)}
          onClick={() => setExpandedSetting(expandedSetting === 'limit' ? null : 'limit')}
        />
        {expandedSetting === 'limit' && (
          <div style={{ padding: '4px 20px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {CACHE_LIMIT_PRESETS.map((preset) => (
              <RadioRow
                key={preset.label}
                label={preset.label}
                active={settings.data_cache_limit_bytes === preset.bytes}
                onSelect={() => { updateSetting('data_cache_limit_bytes', preset.bytes); setExpandedSetting(null) }}
              />
            ))}
          </div>
        )}
        {clearConfirm ? (
          <>
            <div style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
              {t('clear_confirm_body')}
            </div>
            <ButtonRow label={t('cancel')} color="accent" onClick={() => setClearConfirm(false)} />
            <ButtonRow label={clearing ? t('loading') : t('clear_everything')} color="danger" onClick={handleClearAll} />
          </>
        ) : (
          <ButtonRow label={t('clear_all_local_data')} color="danger" onClick={() => setClearConfirm(true)} />
        )}
      </GroupCard>

      <AutoDownloadGroup label={t('auto_download_private')} chatKey="private_chats" settings={settings} updateSetting={s.updateSetting} />
      <AutoDownloadGroup label={t('auto_download_group')} chatKey="group_chats" settings={settings} updateSetting={s.updateSetting} />
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
      <SectionLabel>{t('storage_admin')}</SectionLabel>
      <GroupCard>
        <InfoRow label={t('hot_cache')} value={`${usageMB} MB / ${maxGB} GB (${pct}%)`} />
        <InfoRow label={t('object_storage')} value={status.object_store?.enabled ? t('enabled') : t('disabled')} />
        <InfoRow label={t('alert_level')} value={status.monitor?.alert_level ?? t('normal')} last />
      </GroupCard>
      <SectionLabel>{t('retention_profile')}</SectionLabel>
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
          label={evicting ? t('loading') : t('run_eviction')}
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


// ─── Appearance ─────────────────────────────────────────────────────────────────

function AppearanceSection({ s }: { s: SettingsHook }) {
  const { locale, setLocale } = useLocale()

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <ThemePicker />
      </div>
      <SectionLabel>{t('language')}</SectionLabel>
      <GroupCard>
        {getAvailableLocales().map((loc, i, arr) => (
          <RadioRow
            key={loc.code}
            label={loc.label}
            active={locale === loc.code}
            onSelect={() => setLocale(loc.code)}
            last={i === arr.length - 1}
          />
        ))}
      </GroupCard>
    </>
  )
}

// ─── Stickers and Emoji ─────────────────────────────────────────────────────────

// ─── About & Debug ──────────────────────────────────────────────────────────────

function AboutDebugSection({ serverUrl }: { serverUrl: string | null }) {
  const callCapability = getCallCapability()
  const mediaE2eeEnabled = callCapability.state === 'supported'
  const supportTone =
    callCapability.state === 'supported'
      ? 'var(--green, #34C759)'
      : 'var(--status-warning, #f0a030)'
  const userAgent = typeof navigator === 'undefined' ? 'Unknown' : navigator.userAgent
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const resolvedServerUrl = serverUrl ?? window.location.origin

  useEffect(() => {
    fetch(`${resolvedServerUrl}/api/v1/server/info`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.version) setServerVersion(data.version) })
      .catch(() => {})
  }, [resolvedServerUrl])

  const browserName = callCapability.browserName ?? 'Unknown'
  const platform = typeof navigator !== 'undefined' ? navigator.platform : 'Unknown'
  const serverHost = (() => { try { return new URL(resolvedServerUrl).host } catch { return resolvedServerUrl } })()

  const handleCopyDebugInfo = () => {
    const transportLabel =
      callCapability.transport === 'standard' ? t('standard_transforms')
        : callCapability.transport === 'legacy' ? t('legacy_streams')
        : t('unsupported')
    const text = [
      'Vostok Debug Info',
      String.fromCharCode(0x2500).repeat(17),
      `Client: ${VOSTOK_CLIENT_VERSION}`,
      `Server: ${serverVersion ?? 'Unknown'} (${serverHost})`,
      `E2EE: Enabled (Signal protocol, Curve25519)`,
      `Call: ${mediaE2eeEnabled ? 'Supported' : 'Unavailable'} (${transportLabel})`,
      `Browser: ${browserName} (${platform})`,
      `User Agent: ${userAgent}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <>
      <SectionLabel>{t('vostok')}</SectionLabel>
      <GroupCard>
        <InfoRow label={t('client_version')} value={VOSTOK_CLIENT_VERSION} />
        <InfoRow label={t('server_version')} value={serverVersion ?? '...'} />
        <InfoRow label={t('server_url_label')} value={serverHost} last />
      </GroupCard>

      <SectionLabel>{t('encryption')}</SectionLabel>
      <GroupCard>
        <div style={{ ...rowStyle }}>
          <span style={{ flex: 1 }}>{t('end_to_end')}</span>
          <span style={{ fontSize: 13, color: 'var(--green, #34C759)', fontWeight: 600 }}>{'\u25CF'} {t('e2ee_enabled')}</span>
        </div>
        <InfoRow label={t('protocol')} value={t('e2ee_protocol')} />
        <InfoRow label={t('curve')} value="Curve25519" />
        <InfoRow label={t('library')} value="libsignal-ts" last />
      </GroupCard>

      <SectionLabel>{t('call_compatibility')}</SectionLabel>
      <GroupCard>
        <div style={{ ...rowStyle }}>
          <span style={{ flex: 1 }}>{t('encrypted_calling')}</span>
          <span style={{ fontSize: 13, color: supportTone, fontWeight: 600 }}>
            {mediaE2eeEnabled ? `\u25CF ${t('supported')}` : `\u25CB ${t('unavailable')}`}
          </span>
        </div>
        <InfoRow label={t('host')} value={callCapability.hostKind === 'desktop' ? t('desktop_shell') : t('browser')} />
        <InfoRow
          label={t('transport')}
          value={
            callCapability.transport === 'standard'
              ? t('standard_transforms')
              : callCapability.transport === 'legacy'
                ? t('legacy_streams')
                : t('unsupported')
          }
        />
        <div style={{ ...rowStyle, ...lastRowMod, height: 'auto', minHeight: 56, alignItems: 'flex-start', padding: '12px 20px' }}>
          <span style={{ flex: 1 }}>{t('status')}</span>
          <span style={{ fontSize: 13, color: mediaE2eeEnabled ? 'var(--text-secondary)' : 'var(--status-warning, #f0a030)', textAlign: 'right', maxWidth: 280 }}>
            {callCapability.reason ?? t('can_place_calls')}
          </span>
        </div>
      </GroupCard>

      <SectionLabel>{t('device')}</SectionLabel>
      <GroupCard>
        <InfoRow label={t('browser')} value={browserName} />
        <InfoRow label={t('platform')} value={platform} />
        <div style={{ ...rowStyle, ...lastRowMod, height: 'auto', minHeight: 56, alignItems: 'flex-start', padding: '12px 20px' }}>
          <span style={{ flex: 1 }}>{t('user_agent')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', maxWidth: 280, wordBreak: 'break-word' }}>
            {userAgent}
          </span>
        </div>
      </GroupCard>

      <GroupCard>
        <button
          type="button"
          onClick={handleCopyDebugInfo}
          style={{
            ...rowStyle, ...lastRowMod,
            cursor: 'pointer', background: 'none', border: 'none',
            color: copied ? 'var(--green, #34C759)' : 'var(--accent)',
            fontWeight: 600, fontSize: 14, gap: 8, width: '100%', justifyContent: 'center',
          }}
        >
          {copied ? <Check size={16} strokeWidth={2} /> : <Copy size={16} strokeWidth={1.75} />}
          {copied ? t('copied') : t('copy_debug_info')}
        </button>
      </GroupCard>
    </>
  )
}
