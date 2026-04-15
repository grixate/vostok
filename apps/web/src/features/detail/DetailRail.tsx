import { useEffect, useMemo, useState } from 'react'
import { ChatInfoPanel } from '@vostok/ui-chat'
import { useAppContext } from '../../contexts/AppContext.tsx'
import {
  createInviteLink,
  deleteChat,
  leaveChat,
  listInviteLinks,
  revokeInviteLink,
  type InviteLink
} from '../../lib/api.ts'
import { getRawChatId } from '../../lib/multi-server.ts'
import { t } from '../../lib/i18n.ts'
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import { MediaGallery } from './MediaGallery.tsx'
import { RemoteMembraneTrackPreview } from '../../components/RemoteMembraneTrackPreview.tsx'
import {
  toAttachmentDescriptor,
  isRoundVideoAttachment
} from '../../utils/attachment-helpers.ts'
import { pickDominantRemoteSpeakerEndpointId, pickFeaturedRemoteTrack } from '../../utils/call-helpers.ts'
import type { useViewportLayout } from '../../hooks/useViewportLayout.ts'
import type { useAuth } from '../../hooks/useAuth.ts'
import type { useChatSessions } from '../../hooks/useChatSessions.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { ChatSummary } from '../../lib/api.ts'

type DetailRailProps = {
  layout: ReturnType<typeof useViewportLayout>
  activeChat: ChatSummary | null
  auth: ReturnType<typeof useAuth>
  chatSessions: ReturnType<typeof useChatSessions>
  chatList: ReturnType<typeof useChatList>
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
}

export function DetailRail({
  layout,
  activeChat,
  auth,
  chatSessions,
  chatList,
  groupChat,
  call,
  messages,
  media
}: DetailRailProps) {
  const { sessionToken, setBanner } = useAppContext()
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(call.membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(call.membraneRemoteTracks, dominantRemoteEndpointId)
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([])
  const [inviteLinksLoading, setInviteLinksLoading] = useState(false)
  const rawActiveChatId = activeChat ? getRawChatId(activeChat.id) : null
  const canManageInviteLinks = Boolean(
    sessionToken &&
      rawActiveChatId &&
      activeChat &&
      activeChat.type !== 'direct' &&
      activeChat.can_manage_members
  )
  const shouldShowMemberIdentities = activeChat?.type === 'group' || Boolean(activeChat?.can_manage_members)
  const visibleInviteLinks = useMemo(
    () => inviteLinks.filter((inviteLink) => inviteLink.revoked_at == null),
    [inviteLinks]
  )

  useEffect(() => {
    if (!canManageInviteLinks || !sessionToken || !rawActiveChatId) {
      setInviteLinks([])
      setInviteLinksLoading(false)
      return
    }

    let cancelled = false
    setInviteLinksLoading(true)

    listInviteLinks(sessionToken, rawActiveChatId)
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
  }, [canManageInviteLinks, rawActiveChatId, sessionToken, setBanner])

  async function handleCopyInviteLink() {
    if (!sessionToken || !activeChat || !rawActiveChatId) {
      return
    }

    try {
      const response = await createInviteLink(sessionToken, rawActiveChatId)
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
    if (!sessionToken || !rawActiveChatId) {
      return
    }

    try {
      const response = await revokeInviteLink(sessionToken, rawActiveChatId, inviteLink.id)
      setInviteLinks((current) =>
        current.map((entry) => (entry.id === response.invite_link.id ? response.invite_link : entry))
      )
      setBanner({ tone: 'success', message: t('invite_link_revoked') })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to revoke invite link.' })
    }
  }

  async function handleLeaveActiveChat() {
    if (!sessionToken || !activeChat || !rawActiveChatId) {
      return
    }

    try {
      await leaveChat(sessionToken, rawActiveChatId)
      chatList.setChatItems((current) => current.filter((chat) => chat.id !== activeChat.id))
      chatList.setActiveChatId(null)
      setBanner({ tone: 'success', message: 'You left the chat.' })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to leave chat.' })
    }
  }

  async function handleDeleteActiveChat() {
    if (!sessionToken || !activeChat || !rawActiveChatId) {
      return
    }

    try {
      await deleteChat(sessionToken, rawActiveChatId)
      chatList.setChatItems((current) => current.filter((chat) => chat.id !== activeChat.id))
      chatList.setActiveChatId(null)
      setBanner({ tone: 'success', message: 'Chat deleted.' })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete chat.' })
    }
  }

  return (
    <aside className={layout.detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
      <ChatInfoPanel
        title={activeChat?.title ?? auth.profileUsername ?? 'User'}
        handle={`@${activeChat?.title?.toLowerCase().replace(/\s+/g, '_') ?? auth.profileUsername ?? 'user'}`}
        avatarColor={chatAvatarColor(activeChat?.title ?? '', activeChat?.is_self_chat ?? false)}
      />
      <div className="settings-card">
        <div className="settings-card__header">
          <h3>{t('media')}</h3>
        </div>
        <MediaGallery messageItems={messages.messageItems} media={media} />
      </div>
      {activeChat && activeChat.type !== 'direct' ? (
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>{activeChat.type === 'channel' ? 'Subscribers' : t('members')}</h3>
          </div>
          {activeChat.description ? (
            <div style={{ padding: '0 16px 12px', color: 'var(--label2)', fontSize: 13 }}>
              {activeChat.description}
            </div>
          ) : null}
          <div style={{ padding: '0 16px 12px', color: 'var(--label2)', fontSize: 12 }}>
            {activeChat.type === 'channel'
              ? `${activeChat.member_count ?? groupChat.groupMembers.length} subscribers`
              : `${activeChat.member_count ?? groupChat.groupMembers.length} members`}
          </div>
          {shouldShowMemberIdentities ? (
            <div className="settings-card__list">
              {groupChat.groupMembers.length > 0 ? (
              groupChat.groupMembers.map((member) => (
                <div key={member.user_id} className="settings-card__row">
                  <div className="settings-card__row-main">
                    <strong>{member.username}</strong>
                    <span>{member.role}{member.username === auth.profileUsername ? ' \u00b7 you' : ''}</span>
                  </div>
                  {activeChat.can_manage_members && member.username !== auth.profileUsername && member.role !== 'owner' ? (
                    <div className="settings-card__row-actions">
                      <button className="mini-action" onClick={() => void groupChat.handleRemoveActiveGroupMember(member)} type="button">{t('remove')}</button>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <span className="settings-card__muted">{t('loading_members')}</span>
              )}
            </div>
          ) : (
            <div style={{ padding: '0 16px 16px', color: 'var(--label2)', fontSize: 12 }}>
              {t('subscriber_identities_hidden')}
            </div>
          )}
        </div>
      ) : null}
      {activeChat && activeChat.type !== 'direct' ? (
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Actions</h3>
          </div>
          <div className="settings-card__actions">
            {canManageInviteLinks ? (
              <button className="secondary-action" type="button" onClick={() => void handleCopyInviteLink()}>
                {t('copy_invite_link')}
              </button>
            ) : null}
            {activeChat.can_leave_chat ? (
              <button className="secondary-action" type="button" onClick={() => void handleLeaveActiveChat()}>
                Leave Chat
              </button>
            ) : null}
            {activeChat.can_delete_chat ? (
              <button className="danger-action" type="button" onClick={() => void handleDeleteActiveChat()}>
                Delete Chat
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {activeChat && activeChat.type !== 'direct' && canManageInviteLinks ? (
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>{t('invite_links')}</h3>
          </div>
          {inviteLinksLoading ? (
            <div style={{ padding: '0 16px 16px', color: 'var(--label2)', fontSize: 12 }}>{t('loading')}</div>
          ) : visibleInviteLinks.length > 0 ? (
            <div className="settings-card__list">
              {visibleInviteLinks.map((inviteLink) => (
                <div key={inviteLink.id} className="settings-card__row">
                  <div className="settings-card__row-main">
                    <strong>{new URL(inviteLink.url, window.location.origin).pathname}</strong>
                    <span>
                      {inviteLink.max_uses ? `${inviteLink.use_count}/${inviteLink.max_uses} uses` : `${inviteLink.use_count} uses`}
                    </span>
                  </div>
                  <div className="settings-card__row-actions">
                    <button className="mini-action" onClick={() => void handleCopyExistingInviteLink(inviteLink)} type="button">
                      {t('copy')}
                    </button>
                    <button className="mini-action" onClick={() => void handleRevokeInviteLink(inviteLink)} type="button">
                      {t('revoke_invite_link')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '0 16px 16px', color: 'var(--label2)', fontSize: 12 }}>
              {t('no_invite_links')}
            </div>
          )}
        </div>
      ) : null}
      <div className="settings-card">
        <div className="settings-card__header">
          <h3>{t('settings')}</h3>
        </div>
        <div className="settings-card__actions">
          <button className="secondary-action" onClick={auth.handleReauthenticate} type="button">
            {t('refresh_session')}
          </button>
          <button className="secondary-action" type="button" disabled>
            {t('link_device')}
          </button>
          <button className="danger-action" onClick={auth.handleForgetDevice} type="button">
            {t('sign_out')}
          </button>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-card__header">
          <h3>{t('encryption')}</h3>
        </div>
        {chatSessions.safetyNumbers.length > 0 ? (
          <div className="settings-card__list">
            {chatSessions.safetyNumbers.map((entry) => (
              <div className="settings-card__row" key={entry.peerDeviceId}>
                <div className="settings-card__row-main">
                  <strong>{entry.label}</strong>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{entry.fingerprint}</span>
                </div>
                <div className="settings-card__row-actions">
                  {!entry.verified ? (
                    <button className="mini-action" disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId} onClick={() => void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)} type="button">{t('verify')}</button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--green)' }}>{t('verified')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="settings-card__muted">{t('no_safety_numbers')}</span>
        )}
      </div>
      {call.activeCall ? (
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>{t('active_call')}</h3>
          </div>
          <div className="settings-card__actions">
            <button className="danger-action" onClick={call.handleEndCall} type="button">{t('end_call')}</button>
          </div>
          {featuredRemoteTrack ? (
            <div style={{ padding: '0 16px 16px' }}>
              <RemoteMembraneTrackPreview featured track={featuredRemoteTrack} />
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}
