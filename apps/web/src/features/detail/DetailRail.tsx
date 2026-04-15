import { ChatInfoPanel } from '@vostok/ui-chat'
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
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(call.membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(call.membraneRemoteTracks, dominantRemoteEndpointId)

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
      {activeChat?.type === 'group' ? (
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>{t('members')}</h3>
          </div>
          <div className="settings-card__list">
            {groupChat.groupMembers.length > 0 ? (
              groupChat.groupMembers.map((member) => (
                <div key={member.user_id} className="settings-card__row">
                  <div className="settings-card__row-main">
                    <strong>{member.username}</strong>
                    <span>{member.role}{member.username === auth.profileUsername ? ' \u00b7 you' : ''}</span>
                  </div>
                  {member.username !== auth.profileUsername ? (
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
