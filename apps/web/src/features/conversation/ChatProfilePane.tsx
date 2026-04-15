import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { t } from '../../lib/i18n.ts'
import { useAppContext } from '../../contexts/AppContext.tsx'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import { ProfilePhotoModal } from '../settings/ProfilePhotoModal.tsx'
import {
  createInviteLink,
  deleteChat,
  leaveChat,
  listInviteLinks,
  revokeInviteLink,
  type ChatSummary,
  type InviteLink
} from '../../lib/api.ts'
import { getRawChatId } from '../../lib/multi-server.ts'
import { getChannelCommentsNotify, setChannelCommentsNotify } from '../../lib/channel-prefs.ts'
import { ChevronLeftIcon } from '../../icons/index.tsx'
import { chatAvatarColor, peerColor } from '../../utils/avatar-colors.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import { resolveApiAssetUrl } from '../../hooks/useProfilePhotos.ts'

const PERMISSION_OPTIONS: Array<{ value: 'everyone' | 'admins'; labelKey: string }> = [
  { value: 'everyone', labelKey: 'permission_everyone' },
  { value: 'admins', labelKey: 'permission_admins' }
]

type ChatProfilePaneProps = {
  activeChat: ChatSummary
  chatList: ReturnType<typeof useChatList>
  groupChat: ReturnType<typeof useGroupChat>
  onClose: () => void
}

export function ChatProfilePane({ activeChat, chatList, groupChat, onClose }: ChatProfilePaneProps) {
  const { sessionToken, setBanner, storedDevice } = useAppContext()
  const [memberInput, setMemberInput] = useState('')
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [commentsNotify, setCommentsNotifyState] = useState(() => getChannelCommentsNotify(activeChat.id))

  useEffect(() => {
    setCommentsNotifyState(getChannelCommentsNotify(activeChat.id))
  }, [activeChat.id])

  const handleToggleCommentsNotify = () => {
    const next = !commentsNotify
    setChannelCommentsNotify(activeChat.id, next)
    setCommentsNotifyState(next)
  }

  // Escape closes the profile pane
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    setMemberInput('')
  }, [activeChat.id])

  const rawChatId = getRawChatId(activeChat.id)
  const serverUrl =
    'serverUrl' in activeChat && typeof activeChat.serverUrl === 'string'
      ? activeChat.serverUrl
      : chatList.activeServerUrl
  const avatarColor = chatAvatarColor(activeChat.title, activeChat.is_self_chat)
  const chatAvatarUrl =
    !activeChat.is_self_chat && activeChat.type !== 'direct'
      ? resolveApiAssetUrl(activeChat.avatar_url, serverUrl)
      : null
  const currentUsername = storedDevice?.username ?? null
  const memberCount = activeChat.member_count ?? groupChat.groupMembers.length
  const showMemberIdentities =
    activeChat.type === 'group' ||
    activeChat.membership_role === 'owner' ||
    activeChat.membership_role === 'admin'
  const canManageMembers = Boolean(activeChat.can_manage_members)
  const canEditInfo = Boolean(activeChat.can_edit_info)
  const canManageInviteLinks = Boolean(
    sessionToken &&
      rawChatId &&
      !activeChat.is_self_chat &&
      activeChat.type !== 'direct' &&
      activeChat.can_manage_members
  )

  const avatarInitial = activeChat.is_self_chat
    ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
    : activeChat.title.slice(0, 1)

  const subtitle = activeChat.is_self_chat
    ? t('your_saved_messages')
    : activeChat.type === 'channel'
      ? t('n_subscribers', memberCount)
    : activeChat.type === 'group'
      ? t('n_members', memberCount)
      : t('last_seen_recently')

  const descriptionText = useMemo(() => {
    if (activeChat.type === 'channel') {
      return activeChat.description ?? t('channel_read_only_hint')
    }

    if (activeChat.type === 'group') {
      return activeChat.description ?? t('group_manage_hint')
    }

    return null
  }, [activeChat.description, activeChat.type])

  const visibleInviteLinks = useMemo(
    () => inviteLinks.filter((inviteLink) => inviteLink.revoked_at == null),
    [inviteLinks]
  )

  useEffect(() => {
    if (!canManageInviteLinks || !sessionToken || !rawChatId) {
      setInviteLinks([])
      setInviteLinksLoading(false)
      return
    }

    let cancelled = false
    setInviteLinksLoading(true)

    listInviteLinks(sessionToken, rawChatId)
      .then((response) => {
        if (!cancelled) {
          setInviteLinks(response.invite_links)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setInviteLinks([])
          setBanner({
            tone: 'error',
            message: error instanceof Error ? error.message : 'Failed to load invite links.'
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInviteLinksLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [canManageInviteLinks, rawChatId, sessionToken, setBanner])

  function handleAddMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const usernames = memberInput
      .split(',')
      .map((username) => username.trim())
      .filter(Boolean)

    if (usernames.length === 0) {
      return
    }

    void groupChat.handleAddActiveGroupMembers(usernames)
    setMemberInput('')
  }

  function handlePermissionChange(key: string, value: 'everyone' | 'admins') {
    groupChat.setChatPermissions((current) => ({
      ...current,
      [key]: value
    }))
  }

  async function handleCopyInviteLink() {
    if (!sessionToken || !rawChatId) {
      return
    }

    try {
      const response = await createInviteLink(sessionToken, rawChatId)
      const absoluteUrl = new URL(response.invite_link.url, window.location.origin).toString()
      setInviteLinks((current) => [response.invite_link, ...current.filter((link) => link.id !== response.invite_link.id)])
      await navigator.clipboard.writeText(absoluteUrl)
      setBanner({ tone: 'success', message: t('invite_link_copied') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to create invite link.' })
    }
  }

  async function handleCopyExistingInviteLink(inviteLink: InviteLink) {
    try {
      await navigator.clipboard.writeText(new URL(inviteLink.url, window.location.origin).toString())
      setBanner({ tone: 'success', message: t('invite_link_copied') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to copy invite link.' })
    }
  }

  async function handleRevokeInviteLink(inviteLink: InviteLink) {
    if (!sessionToken || !rawChatId) {
      return
    }

    try {
      const response = await revokeInviteLink(sessionToken, rawChatId, inviteLink.id)
      setInviteLinks((current) =>
        current.map((entry) => (entry.id === response.invite_link.id ? response.invite_link : entry))
      )
      setBanner({ tone: 'success', message: t('invite_link_revoked') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to revoke invite link.' })
    }
  }

  async function handleLeaveActiveChat() {
    if (!sessionToken || !rawChatId) {
      return
    }

    try {
      await leaveChat(sessionToken, rawChatId)
      chatList.setChatItems((current) => current.filter((chat) => chat.id !== activeChat.id))
      chatList.setActiveChatId(null)
      onClose()
      setBanner({ tone: 'success', message: t('left_chat') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to leave chat.' })
    }
  }

  async function handleDeleteActiveChat() {
    if (!sessionToken || !rawChatId) {
      return
    }

    try {
      await deleteChat(sessionToken, rawChatId)
      chatList.setChatItems((current) => current.filter((chat) => chat.id !== activeChat.id))
      chatList.setActiveChatId(null)
      onClose()
      setBanner({ tone: 'success', message: t('chat_deleted') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete chat.' })
    }
  }

  return (
    <div className="chat-profile-pane">
      <div className="chat-profile-pane__header">
        <button
          type="button"
          className="vostok-icon-button"
          onClick={onClose}
          aria-label={t('back')}
        >
          <ChevronLeftIcon />
        </button>
        <span className="chat-profile-pane__header-title">{t('info')}</span>
      </div>

      <div className="chat-profile-pane__body">
        <div className="chat-profile-pane__avatar-wrap">
          <button
            type="button"
            className="chat-profile-pane__avatar-button"
            onClick={() => {
              if (canEditInfo && (activeChat.type === 'group' || activeChat.type === 'channel')) {
                setAvatarModalOpen(true)
              }
            }}
            disabled={!canEditInfo || (activeChat.type !== 'group' && activeChat.type !== 'channel')}
            aria-label={t('change_chat_photo')}
          >
            <div
              className="chat-profile-pane__avatar"
              style={{ background: chatAvatarUrl ? undefined : avatarColor }}
            >
              {chatAvatarUrl ? (
                <img src={chatAvatarUrl} alt={activeChat.title} className="chat-profile-pane__avatar-image" />
              ) : (
                avatarInitial
              )}
            </div>
            {canEditInfo && (activeChat.type === 'group' || activeChat.type === 'channel') ? (
              <span className="chat-profile-pane__avatar-edit-badge">{t('edit')}</span>
            ) : null}
          </button>
          <h2 className="chat-profile-pane__title">{activeChat.title}</h2>
          <p className="chat-profile-pane__subtitle">{subtitle}</p>
        </div>

        {descriptionText ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('about')}</div>
            <div className="chat-profile-pane__text-block">{descriptionText}</div>
          </div>
        ) : null}

        {canEditInfo && (activeChat.type === 'group' || activeChat.type === 'channel') ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('chat_details')}</div>
            <form className="chat-profile-pane__form" onSubmit={(event) => void groupChat._handleRenameActiveGroupChat(event)}>
              <input
                className="chat-profile-pane__input"
                type="text"
                value={groupChat.groupRenameTitle}
                onChange={(event) => groupChat.setGroupRenameTitle(event.target.value)}
                placeholder={t('chat_name')}
              />
              <button className="secondary-action" type="submit" disabled={groupChat.groupRenameTitle.trim() === ''}>
                {t('save')}
              </button>
            </form>
          </div>
        ) : null}

        {canEditInfo && (activeChat.type === 'group' || activeChat.type === 'channel') ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('chat_settings')}</div>
            <form className="chat-profile-pane__form" onSubmit={(event) => void groupChat.handleUpdateActiveChatSettings(event)}>
              <textarea
                className="chat-profile-pane__textarea"
                value={groupChat.groupDescription}
                onChange={(event) => groupChat.setGroupDescription(event.target.value)}
                placeholder={t('chat_description')}
                rows={4}
              />

              {activeChat.type === 'channel' ? (
                <>
                  <label className="chat-profile-pane__toggle-row">
                    <span>{t('public_channel')}</span>
                    <input
                      type="checkbox"
                      checked={groupChat.chatIsPublic}
                      onChange={(event) => groupChat.setChatIsPublic(event.target.checked)}
                    />
                  </label>
                  <label className="chat-profile-pane__toggle-row">
                    <span>{t('allow_comments')}</span>
                    <input
                      type="checkbox"
                      checked={groupChat.chatAllowComments}
                      onChange={(event) => groupChat.setChatAllowComments(event.target.checked)}
                    />
                  </label>
                </>
              ) : null}

              <div className="chat-profile-pane__permission-grid">
                <label className="chat-profile-pane__select-row">
                  <span>{t('who_can_send')}</span>
                  <select
                    className="chat-profile-pane__select"
                    value={groupChat.chatPermissions.who_can_send ?? 'everyone'}
                    onChange={(event) => handlePermissionChange('who_can_send', event.target.value as 'everyone' | 'admins')}
                  >
                    {PERMISSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chat-profile-pane__select-row">
                  <span>{t('who_can_add_members')}</span>
                  <select
                    className="chat-profile-pane__select"
                    value={groupChat.chatPermissions.who_can_add_members ?? 'admins'}
                    onChange={(event) => handlePermissionChange('who_can_add_members', event.target.value as 'everyone' | 'admins')}
                  >
                    {PERMISSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chat-profile-pane__select-row">
                  <span>{t('who_can_edit_info')}</span>
                  <select
                    className="chat-profile-pane__select"
                    value={groupChat.chatPermissions.who_can_edit_info ?? 'admins'}
                    onChange={(event) => handlePermissionChange('who_can_edit_info', event.target.value as 'everyone' | 'admins')}
                  >
                    {PERMISSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chat-profile-pane__select-row">
                  <span>{t('who_can_pin_messages')}</span>
                  <select
                    className="chat-profile-pane__select"
                    value={groupChat.chatPermissions.who_can_pin_messages ?? 'admins'}
                    onChange={(event) => handlePermissionChange('who_can_pin_messages', event.target.value as 'everyone' | 'admins')}
                  >
                    {PERMISSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button className="secondary-action" type="submit">
                {t('save_settings')}
              </button>
            </form>
          </div>
        ) : null}

        {activeChat.type === 'channel' ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('notifications')}</div>
            <label className="chat-profile-pane__toggle">
              <span className="chat-profile-pane__toggle-label">{t('notify_on_comments')}</span>
              <input
                type="checkbox"
                checked={commentsNotify}
                onChange={handleToggleCommentsNotify}
              />
            </label>
          </div>
        ) : null}

        {canManageMembers && (activeChat.type === 'group' || activeChat.type === 'channel') ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('add_members')}</div>
            <form className="chat-profile-pane__form" onSubmit={handleAddMembers}>
              <input
                className="chat-profile-pane__input"
                type="text"
                value={memberInput}
                onChange={(event) => setMemberInput(event.target.value)}
                placeholder={t('member_usernames_placeholder')}
              />
              <button className="secondary-action" type="submit" disabled={memberInput.trim() === ''}>
                {t('add')}
              </button>
            </form>
          </div>
        ) : null}

        {(activeChat.type === 'group' || activeChat.type === 'channel') && (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">
              {activeChat.type === 'channel' ? t('n_subscribers', memberCount) : t('n_members', memberCount)}
            </div>
            {showMemberIdentities ? (
              groupChat.groupMembers.length > 0 ? (
                groupChat.groupMembers.map((member) => {
                  const isSelf = member.username === currentUsername
                  const canPromote = canManageMembers && member.role === 'member' && !isSelf
                  const canDemote =
                    activeChat.membership_role === 'owner' && member.role === 'admin' && !isSelf
                  const canTransfer =
                    activeChat.membership_role === 'owner' && member.role !== 'owner' && !isSelf
                  const canRemove =
                    canManageMembers && member.role !== 'owner' && !isSelf

                  return (
                    <div key={member.username} className="chat-profile-pane__member">
                      <div
                        className="chat-profile-pane__member-avatar"
                        style={{ background: peerColor(member.username) }}
                      >
                        {member.username.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="chat-profile-pane__member-main">
                        <span className="chat-profile-pane__member-name">{member.username}</span>
                        <span className="chat-profile-pane__member-meta">
                          {member.role === 'owner'
                            ? t('owner')
                            : member.role === 'admin'
                              ? t('admin')
                              : t('member_role')}
                          {isSelf ? ` · ${t('you')}` : ''}
                        </span>
                      </div>
                      <div className="chat-profile-pane__member-actions">
                        {canPromote ? (
                          <button
                            className="mini-action"
                            type="button"
                            onClick={() => void groupChat._handleUpdateActiveGroupMemberRole(member, 'admin')}
                          >
                            {t('make_admin')}
                          </button>
                        ) : null}
                        {canDemote ? (
                          <button
                            className="mini-action"
                            type="button"
                            onClick={() => void groupChat._handleUpdateActiveGroupMemberRole(member, 'member')}
                          >
                            {t('make_member')}
                          </button>
                        ) : null}
                        {canTransfer ? (
                          <button
                            className="mini-action"
                            type="button"
                            onClick={() => void groupChat.handleTransferActiveGroupOwnership(member)}
                          >
                            {t('transfer_ownership')}
                          </button>
                        ) : null}
                        {canRemove ? (
                          <button
                            className="mini-action"
                            type="button"
                            onClick={() => void groupChat.handleRemoveActiveGroupMember(member)}
                          >
                            {t('remove')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="chat-profile-pane__text-block">{t('loading_members')}</div>
              )
            ) : (
              <div className="chat-profile-pane__text-block">{t('subscriber_identities_hidden')}</div>
            )}
          </div>
        )}

        {canManageInviteLinks ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('invite_links')}</div>
            <div className="chat-profile-pane__section-actions">
              <button className="secondary-action" type="button" onClick={() => void handleCopyInviteLink()}>
                {t('copy_invite_link')}
              </button>
            </div>
            {inviteLinksLoading ? (
              <div className="chat-profile-pane__text-block">{t('loading')}</div>
            ) : visibleInviteLinks.length > 0 ? (
              visibleInviteLinks.map((inviteLink) => (
                <div key={inviteLink.id} className="chat-profile-pane__member">
                  <div className="chat-profile-pane__member-main">
                    <span className="chat-profile-pane__member-name">
                      {new URL(inviteLink.url, window.location.origin).pathname}
                    </span>
                    <span className="chat-profile-pane__member-meta">
                      {inviteLink.max_uses
                        ? t('invite_link_uses_limited', inviteLink.use_count, inviteLink.max_uses)
                        : t('invite_link_uses', inviteLink.use_count)}
                    </span>
                  </div>
                  <div className="chat-profile-pane__member-actions">
                    <button className="mini-action" type="button" onClick={() => void handleCopyExistingInviteLink(inviteLink)}>
                      {t('copy')}
                    </button>
                    <button className="mini-action" type="button" onClick={() => void handleRevokeInviteLink(inviteLink)}>
                      {t('revoke_invite_link')}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="chat-profile-pane__text-block">{t('no_invite_links')}</div>
            )}
          </div>
        ) : null}

        {!activeChat.is_self_chat && activeChat.type !== 'direct' ? (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">{t('actions')}</div>
            <div className="chat-profile-pane__section-actions">
              {activeChat.can_leave_chat ? (
                <button className="secondary-action" type="button" onClick={() => void handleLeaveActiveChat()}>
                  {t('leave_chat')}
                </button>
              ) : null}
              {activeChat.can_delete_chat ? (
                <button className="danger-action" type="button" onClick={() => void handleDeleteActiveChat()}>
                  {t('delete_chat')}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!activeChat.is_self_chat && activeChat.type === 'direct' && (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__info-row">
              <span className="chat-profile-pane__info-label">{t('username')}</span>
              <span className="chat-profile-pane__info-value">@{activeChat.title}</span>
            </div>
          </div>
        )}
      </div>

      {avatarModalOpen ? (
        <ProfilePhotoModal
          initial={activeChat.title.slice(0, 1).toUpperCase() || '?'}
          hasExistingPhoto={Boolean(chatAvatarUrl)}
          title={t('chat_photo')}
          hint={t('chat_photo_hint')}
          adjustTitle={t('adjust_chat_photo')}
          uploadingTitle={t('uploading_chat_photo')}
          successTitle={t('chat_photo_updated')}
          successText={t('chat_photo_updated_hint')}
          uploadButtonLabel={t('upload_chat_photo')}
          saveButtonLabel={t('save_chat_photo')}
          onClose={() => setAvatarModalOpen(false)}
          onPhotoUpdated={() => {}}
          onUploadPhoto={(photoBase64, contentType) =>
            groupChat.handleUpdateActiveChatAvatar(photoBase64, contentType)
          }
          onDeletePhoto={() => groupChat.handleRemoveActiveChatAvatar()}
        />
      ) : null}
    </div>
  )
}
