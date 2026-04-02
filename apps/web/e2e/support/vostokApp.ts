import { expect, type Page, type Route } from '@playwright/test'

type CapabilityMode = 'unsupported' | 'standard' | 'legacy'

type CallSessionRecord = {
  id: string
  chat_id: string | null
  call_room_id: string | null
  scope_type: 'chat' | 'call_room'
  scope_id: string
  started_by_device_id: string
  mode: 'voice' | 'video' | 'group'
  media_mode: 'voice' | 'video'
  status: 'ringing' | 'active' | 'ended'
  started_at: string
  ended_at: string | null
  display_title?: string
}

type MockScenario = {
  capability: CapabilityMode
  incomingCall?: boolean
  activeChatId?: string
  initialCall?: 'direct-active' | 'group-active'
}

const SERVER_ID = 'srv_e2e'
const SERVER_URL = 'http://127.0.0.1:4173'
const USER_ID = 'user-self'
const USERNAME = 'jamie'
const DEVICE_ID = 'device-self'
const CHAT_DIRECT_ID = 'chat-direct-1'
const CHAT_GROUP_ID = 'chat-group-1'
const ROOM_ID = 'room-1'
const OTHER_USER_ID = 'user-casey'

function createStoredDevice() {
  return {
    deviceId: DEVICE_ID,
    deviceName: 'Web Browser',
    privateKeyPkcs8Base64: 'cHJpdmF0ZS1rZXk=',
    publicKeyBase64: 'cHVibGljLWtleQ==',
    encryptionPrivateKeyPkcs8Base64: 'ZW5jcnlwdGlvbi1wcml2YXRl',
    encryptionPublicKeyBase64: 'ZW5jcnlwdGlvbi1wdWJsaWM=',
    signedPrekeyPublicKeyBase64: 'c2lnbmVkLXByZWtleS1wdWJsaWM=',
    signedPrekeyPrivateKeyPkcs8Base64: 'c2lnbmVkLXByZWtleS1wcml2YXRl',
    signedPrekeys: [],
    oneTimePrekeys: [],
    sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    sessionToken: 'token-access',
    username: USERNAME
  }
}

function createServerRecord() {
  return [{
    id: SERVER_ID,
    label: 'E2E Server',
    url: SERVER_URL,
    color: '#008BFF',
    auth: {
      accessToken: 'token-access',
      refreshToken: 'token-refresh',
      user: {
        id: USER_ID,
        username: USERNAME,
        display_name: 'Jamie',
        role: 'member',
        temp_password: false
      }
    },
    device: createStoredDevice(),
    serverInfo: {
      name: 'E2E Server',
      version: '1.0.0',
      auth_mode: 'open',
      access_requests_enabled: true,
      bootstrap: false
    },
    lastConnectedAt: null,
    sortOrder: 0,
    enabled: true
  }]
}

function directChat() {
  return {
    id: CHAT_DIRECT_ID,
    type: 'direct',
    title: 'Casey Direct',
    participant_usernames: [USERNAME, 'casey'],
    participant_user_ids: [USER_ID, OTHER_USER_ID],
    is_self_chat: false,
    latest_message_at: '2026-04-01T09:00:00Z',
    message_count: 0
  }
}

function selfChat() {
  return {
    id: 'chat-self',
    type: 'self',
    title: 'Saved Messages',
    participant_usernames: [USERNAME],
    participant_user_ids: [USER_ID],
    is_self_chat: true,
    latest_message_at: '2026-04-01T08:00:00Z',
    message_count: 0
  }
}

function groupChat() {
  return {
    id: CHAT_GROUP_ID,
    type: 'group',
    title: 'Design Circle',
    participant_usernames: [USERNAME, 'alex', 'blair'],
    participant_user_ids: [USER_ID, 'user-alex', 'user-blair'],
    is_self_chat: false,
    latest_message_at: '2026-04-01T07:00:00Z',
    message_count: 0
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

function buildIncomingDirectCall(): CallSessionRecord {
  return {
    id: 'call-incoming-1',
    chat_id: CHAT_DIRECT_ID,
    call_room_id: null,
    scope_type: 'chat',
    scope_id: CHAT_DIRECT_ID,
    started_by_device_id: 'device-remote',
    mode: 'voice',
    media_mode: 'voice',
    status: 'ringing',
    started_at: '2026-04-01T09:30:00Z',
    ended_at: null,
    display_title: 'Casey Direct'
  }
}

function buildActiveDirectCall(): CallSessionRecord {
  return {
    id: 'call-active-direct-1',
    chat_id: CHAT_DIRECT_ID,
    call_room_id: null,
    scope_type: 'chat',
    scope_id: CHAT_DIRECT_ID,
    started_by_device_id: DEVICE_ID,
    mode: 'video',
    media_mode: 'video',
    status: 'active',
    started_at: '2026-04-01T09:30:00Z',
    ended_at: null,
    display_title: 'Casey Direct'
  }
}

function buildActiveGroupRoomCall(): CallSessionRecord {
  return {
    id: 'call-active-group-1',
    chat_id: null,
    call_room_id: ROOM_ID,
    scope_type: 'call_room',
    scope_id: ROOM_ID,
    started_by_device_id: DEVICE_ID,
    mode: 'group',
    media_mode: 'voice',
    status: 'active',
    started_at: '2026-04-01T09:35:00Z',
    ended_at: null,
    display_title: 'Alex, Blair'
  }
}

export async function installMockBrowserCapability(page: Page, mode: CapabilityMode) {
  await page.addInitScript((capability: CapabilityMode) => {
    const win = window as typeof window & {
      __TAURI_INTERNALS__?: unknown
      __VOSTOK_TEST_DISABLE_REALTIME__?: boolean
      __VOSTOK_TEST_CALL_CAPABILITY__?: {
        state: 'supported' | 'unsupported_transform'
        reason: string | null
        transport: 'standard' | 'legacy' | 'unsupported'
        browserName: string
        hostKind: 'desktop' | 'browser'
      }
      RTCRtpScriptTransform?: unknown
      RTCRtpSender?: { prototype: Record<string, unknown> }
      RTCRtpReceiver?: { prototype: Record<string, unknown> }
    }

    win.__VOSTOK_TEST_CALL_CAPABILITY__ = capability === 'unsupported'
      ? {
          state: 'unsupported_transform',
          reason: 'Chrome does not support the WebRTC encoded transform APIs required for encrypted calls on this app version.',
          transport: 'unsupported',
          browserName: 'Chrome',
          hostKind: 'browser'
        }
      : {
          state: 'supported',
          reason: null,
          transport: capability === 'legacy' ? 'legacy' : 'standard',
          browserName: 'Chrome',
          hostKind: 'browser'
        }

    win.__VOSTOK_TEST_DISABLE_REALTIME__ = true

    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => new MediaStream()
        }
      })
    } else if (!navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia = async () => new MediaStream()
    }

    if (capability === 'standard') {
      class MockRTCRtpScriptTransform {
        constructor(..._args: unknown[]) {}
      }

      win.RTCRtpScriptTransform = MockRTCRtpScriptTransform
      win.RTCRtpSender = win.RTCRtpSender ?? { prototype: {} }
      win.RTCRtpReceiver = win.RTCRtpReceiver ?? { prototype: {} }

      Object.defineProperty(win.RTCRtpSender.prototype, 'transform', {
        configurable: true,
        writable: true,
        value: null
      })
      Object.defineProperty(win.RTCRtpReceiver.prototype, 'transform', {
        configurable: true,
        writable: true,
        value: null
      })
      return
    }

    win.RTCRtpScriptTransform = undefined
    win.RTCRtpSender = win.RTCRtpSender ?? { prototype: {} }
    win.RTCRtpReceiver = win.RTCRtpReceiver ?? { prototype: {} }

    if (capability === 'legacy') {
      Object.defineProperty(win.RTCRtpSender.prototype, 'createEncodedStreams', {
        configurable: true,
        writable: true,
        value: () => ({
          readable: new ReadableStream(),
          writable: new WritableStream()
        })
      })
      Object.defineProperty(win.RTCRtpReceiver.prototype, 'createEncodedStreams', {
        configurable: true,
        writable: true,
        value: () => ({
          readable: new ReadableStream(),
          writable: new WritableStream()
        })
      })
      return
    }

    delete win.RTCRtpSender.prototype.createEncodedStreams
    delete win.RTCRtpReceiver.prototype.createEncodedStreams
  }, mode)
}

export async function seedAuthenticatedApp(page: Page, activeChatId = `${SERVER_ID}::${CHAT_DIRECT_ID}`) {
  await page.addInitScript(({ servers, serverId, activeChatId }) => {
    window.localStorage.setItem('vostok.servers', JSON.stringify(servers))
    window.localStorage.setItem('vostok.active_server', serverId)
    window.localStorage.setItem('vostok.layout.active_chat_id', activeChatId)
    window.localStorage.setItem('vostok.settings', JSON.stringify({}))
  }, {
    servers: createServerRecord(),
    serverId: SERVER_ID,
    activeChatId
  })
}

export async function installMockApi(page: Page, scenario: MockScenario) {
  const state: {
    activeCall: CallSessionRecord | null
    roomTitle: string
    endpointExists: boolean
  } = {
    activeCall: scenario.initialCall === 'direct-active'
      ? buildActiveDirectCall()
      : scenario.initialCall === 'group-active'
        ? buildActiveGroupRoomCall()
        : scenario.incomingCall
          ? buildIncomingDirectCall()
          : null,
    roomTitle: 'Alex, Blair',
    endpointExists: scenario.initialCall === 'direct-active' || scenario.initialCall === 'group-active'
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const method = request.method()

    if (path === '/server/info' && method === 'GET') {
      return fulfillJson(route, {
        name: 'E2E Server',
        version: '1.0.0',
        auth_mode: 'open',
        access_requests_enabled: true,
        bootstrap: false
      })
    }

    if (path === '/auth/refresh' && method === 'POST') {
      return fulfillJson(route, {
        access_token: 'token-access',
        user: {
          id: USER_ID,
          username: USERNAME,
          display_name: 'Jamie',
          role: 'member',
          temp_password: false
        }
      })
    }

    if (path === '/me' && method === 'GET') {
      return fulfillJson(route, {
        user: {
          id: USER_ID,
          username: USERNAME,
          display_name: 'Jamie',
          bio: null,
          role: 'member'
        },
        device: {
          id: DEVICE_ID,
          device_name: 'Web Browser'
        },
        session: {
          expires_at: '2026-04-02T09:00:00Z'
        },
        settings: null
      })
    }

    if (path === '/devices' && method === 'GET') {
      return fulfillJson(route, {
        devices: [
          {
            id: DEVICE_ID,
            device_name: 'Web Browser',
            is_current: true,
            revoked_at: null,
            last_active_at: '2026-04-01T09:00:00Z',
            inserted_at: '2026-04-01T08:00:00Z',
            one_time_prekey_count: 0
          }
        ]
      })
    }

    if (path === '/devices/link' && method === 'POST') {
      return fulfillJson(route, {
        user: {
          id: USER_ID,
          username: USERNAME
        },
        device: {
          id: DEVICE_ID,
          device_name: 'Web Browser',
          inserted_at: '2026-04-01T08:00:00Z'
        },
        session: {
          token: 'token-access'
        },
        prekey_count: 0
      })
    }

    if (path === '/chats' && method === 'GET') {
      return fulfillJson(route, {
        chats: [directChat(), selfChat(), groupChat()]
      })
    }

    if (path === '/users' && method === 'GET') {
      return fulfillJson(route, {
        users: [
          { id: 'user-alex', username: 'alex' },
          { id: 'user-blair', username: 'blair' },
          { id: OTHER_USER_ID, username: 'casey' }
        ]
      })
    }

    if (path.startsWith('/users/') && path.endsWith('/devices/prekeys') && method === 'GET') {
      return fulfillJson(route, {
        user: { username: 'casey' },
        devices: []
      })
    }

    if (path.startsWith('/users/') && path.endsWith('/photo') && method === 'GET') {
      return fulfillJson(route, { error: 'not_found' }, 404)
    }

    if (path === '/settings' && method === 'GET') {
      return fulfillJson(route, {})
    }

    if (path === '/settings' && method === 'PUT') {
      return fulfillJson(route, { ok: true })
    }

    if (path === '/calls/history' && method === 'GET') {
      return fulfillJson(route, { calls: [] })
    }

    if (path === '/test/incoming-call' && method === 'POST') {
      state.activeCall = buildIncomingDirectCall()
      state.endpointExists = false
      return fulfillJson(route, { call: state.activeCall })
    }

    if (path === '/test/end-active-call' && method === 'POST') {
      state.activeCall = null
      state.endpointExists = false
      return fulfillJson(route, { ok: true })
    }

    if (path === '/calls/turn-credentials' && method === 'POST') {
      return fulfillJson(route, {
        turn: {
          urls: ['turn:turn.example.test:3478?transport=udp'],
          username: 'turn-user',
          credential: 'turn-password',
          expires_at: '2026-04-01T10:30:00Z'
        }
      })
    }

    if (path === '/calls/active' && method === 'GET') {
      return fulfillJson(route, {
        calls: state.activeCall
          ? [{
              ...state.activeCall,
              display_title: state.activeCall.display_title ?? 'Casey Direct',
              participant_count: state.activeCall.mode === 'group' ? 3 : 2
            }]
          : []
      })
    }

    if (path === `/chats/${CHAT_DIRECT_ID}/calls/active` && method === 'GET') {
      return fulfillJson(route, { call: state.activeCall?.scope_type === 'chat' ? state.activeCall : null })
    }

    if (path === `/call-rooms/${ROOM_ID}` && method === 'GET') {
      return fulfillJson(route, {
        room: {
          id: ROOM_ID,
          title: state.roomTitle,
          created_by_user_id: USER_ID,
          expires_at: null,
          closed_at: null
        },
        members: [
          { id: 'member-self', user_id: USER_ID, username: USERNAME, display_name: 'Jamie' },
          { id: 'member-alex', user_id: 'user-alex', username: 'alex', display_name: 'Alex' },
          { id: 'member-blair', user_id: 'user-blair', username: 'blair', display_name: 'Blair' }
        ],
        active_call: state.activeCall?.call_room_id === ROOM_ID ? state.activeCall : null
      })
    }

    if (path === `/call-rooms/${ROOM_ID}/calls/active` && method === 'GET') {
      return fulfillJson(route, { call: state.activeCall?.call_room_id === ROOM_ID ? state.activeCall : null })
    }

    if (path === '/call-rooms' && method === 'POST') {
      return fulfillJson(route, {
        room: {
          id: ROOM_ID,
          title: state.roomTitle,
          created_by_user_id: USER_ID,
          expires_at: null,
          closed_at: null
        },
        members: [
          { id: 'member-self', user_id: USER_ID, username: USERNAME, display_name: 'Jamie' },
          { id: 'member-alex', user_id: 'user-alex', username: 'alex', display_name: 'Alex' },
          { id: 'member-blair', user_id: 'user-blair', username: 'blair', display_name: 'Blair' }
        ]
      })
    }

    if (path === `/call-rooms/${ROOM_ID}/calls` && method === 'POST') {
      state.activeCall = {
        id: 'call-group-1',
        chat_id: null,
        call_room_id: ROOM_ID,
        scope_type: 'call_room',
        scope_id: ROOM_ID,
        started_by_device_id: DEVICE_ID,
        mode: 'group',
        media_mode: 'voice',
        status: 'ringing',
        started_at: '2026-04-01T09:35:00Z',
        ended_at: null,
        display_title: state.roomTitle
      }
      return fulfillJson(route, { call: state.activeCall })
    }

    if (path === `/chats/${CHAT_DIRECT_ID}/calls` && method === 'POST') {
      const body = request.postDataJSON() as { mode?: 'voice' | 'video' | 'group'; media_mode?: 'voice' | 'video' }
      const mode = body.mode === 'video' ? 'video' : body.mode === 'group' ? 'group' : 'voice'
      const mediaMode = body.media_mode ?? (mode === 'video' ? 'video' : 'voice')
      state.activeCall = {
        id: 'call-direct-1',
        chat_id: CHAT_DIRECT_ID,
        call_room_id: null,
        scope_type: 'chat',
        scope_id: CHAT_DIRECT_ID,
        started_by_device_id: DEVICE_ID,
        mode,
        media_mode: mediaMode,
        status: 'ringing',
        started_at: '2026-04-01T09:32:00Z',
        ended_at: null,
        display_title: 'Casey Direct'
      }
      return fulfillJson(route, { call: state.activeCall })
    }

    if (path.startsWith('/calls/') && method === 'GET') {
      const parts = path.split('/').filter(Boolean)
      const callId = parts[1]

      if (parts.length === 2) {
        return fulfillJson(route, {
          call: state.activeCall ?? {
            id: callId,
            chat_id: CHAT_DIRECT_ID,
            call_room_id: null,
            scope_type: 'chat',
            scope_id: CHAT_DIRECT_ID,
            started_by_device_id: DEVICE_ID,
            mode: 'voice',
            media_mode: 'voice',
            status: 'ringing',
            started_at: '2026-04-01T09:32:00Z',
            ended_at: null
          },
          participants: state.activeCall?.mode === 'group'
            ? [
                { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'ringing', track_kind: 'audio', joined_at: null, left_at: null },
                { device_id: 'device-alex', user_id: 'user-alex', username: 'alex', status: 'ringing', track_kind: 'audio', joined_at: null, left_at: null },
                { device_id: 'device-blair', user_id: 'user-blair', username: 'blair', status: 'ringing', track_kind: 'audio', joined_at: null, left_at: null }
              ]
            : [
                { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'ringing', track_kind: 'audio', joined_at: null, left_at: null },
                { device_id: 'device-remote', user_id: OTHER_USER_ID, username: 'casey', status: 'ringing', track_kind: 'audio', joined_at: null, left_at: null }
              ],
          signals: [],
          room: null
        })
      }

      if (parts[2] === 'webrtc-endpoint') {
        return fulfillJson(route, {
          call: state.activeCall,
          endpoint: {
            exists: state.endpointExists,
            endpoint_id: state.endpointExists ? 'endpoint-self' : null,
            token: state.endpointExists ? 'endpoint-token' : null,
            inserted_at: state.endpointExists ? '2026-04-01T09:33:00Z' : null,
            updated_at: state.endpointExists ? '2026-04-01T09:33:00Z' : null
          },
          room: null,
          media_events: []
        })
      }
    }

    if (path.startsWith('/chats/') && path.endsWith('/messages') && method === 'GET') {
      return fulfillJson(route, { messages: [], has_more: false })
    }

    if (path.startsWith('/chats/') && path.endsWith('/recipient-devices') && method === 'GET') {
      return fulfillJson(route, {
        recipient_devices: [
          {
            device_id: 'device-remote',
            user_id: OTHER_USER_ID,
            encryption_public_key: 'remote-public-key'
          }
        ]
      })
    }

    if (path.startsWith('/chats/') && path.endsWith('/safety-numbers') && method === 'GET') {
      return fulfillJson(route, { safety_numbers: [] })
    }

    if (path.startsWith('/chats/') && path.endsWith('/session-bootstrap') && method === 'POST') {
      return fulfillJson(route, { sessions: [] })
    }

    if (path.startsWith('/chats/') && path.endsWith('/read') && method === 'POST') {
      return fulfillJson(route, { ok: true })
    }

    if (path.startsWith('/call-rooms/') && path.endsWith('/recipient-devices') && method === 'GET') {
      return fulfillJson(route, {
        recipient_devices: [
          { device_id: 'device-alex', user_id: 'user-alex', encryption_public_key: 'alex-public-key' },
          { device_id: 'device-blair', user_id: 'user-blair', encryption_public_key: 'blair-public-key' }
        ]
      })
    }

    if (path.startsWith('/calls/') && method === 'POST') {
      const parts = path.split('/').filter(Boolean)
      const callId = parts[1]
      const action = parts[2]

      if (action === 'accept' || action === 'join') {
        if (state.activeCall && state.activeCall.id === callId) {
          state.activeCall = {
            ...state.activeCall,
            status: 'active'
          }
          state.endpointExists = true
        }

        const participants = state.activeCall?.mode === 'group'
          ? [
              { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'joined', track_kind: 'audio', joined_at: '2026-04-01T09:33:30Z', left_at: null },
              { device_id: 'device-alex', user_id: 'user-alex', username: 'alex', status: 'joined', track_kind: 'audio', joined_at: '2026-04-01T09:33:31Z', left_at: null },
              { device_id: 'device-blair', user_id: 'user-blair', username: 'blair', status: 'joined', track_kind: 'audio', joined_at: '2026-04-01T09:33:31Z', left_at: null }
            ]
          : [
              { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'joined', track_kind: 'audio_video', joined_at: '2026-04-01T09:33:30Z', left_at: null },
              { device_id: 'device-remote', user_id: OTHER_USER_ID, username: 'casey', status: 'joined', track_kind: 'audio_video', joined_at: '2026-04-01T09:33:31Z', left_at: null }
            ]

        if (action === 'accept') {
          return fulfillJson(route, { call: state.activeCall })
        }

        return fulfillJson(route, {
          call: state.activeCall,
          participant: participants[0],
          participants,
          room: null
        })
      }

      if (action === 'end' || action === 'decline') {
        const endedCall = state.activeCall
          ? {
              ...state.activeCall,
              status: 'ended' as const,
              ended_at: '2026-04-01T09:36:00Z'
            }
          : {
              id: callId,
              chat_id: CHAT_DIRECT_ID,
              call_room_id: null,
              scope_type: 'chat' as const,
              scope_id: CHAT_DIRECT_ID,
              started_by_device_id: DEVICE_ID,
              mode: 'voice' as const,
              media_mode: 'voice' as const,
              status: 'ended' as const,
              started_at: '2026-04-01T09:32:00Z',
              ended_at: '2026-04-01T09:36:00Z',
              display_title: 'Casey Direct'
            }

        state.activeCall = null
        state.endpointExists = false
        return fulfillJson(route, { call: endedCall })
      }

      if (action === 'leave') {
        const participants = state.activeCall?.mode === 'group'
          ? [
              { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'left', track_kind: 'audio', joined_at: '2026-04-01T09:33:30Z', left_at: '2026-04-01T09:35:00Z' },
              { device_id: 'device-alex', user_id: 'user-alex', username: 'alex', status: 'joined', track_kind: 'audio', joined_at: '2026-04-01T09:33:31Z', left_at: null },
              { device_id: 'device-blair', user_id: 'user-blair', username: 'blair', status: 'joined', track_kind: 'audio', joined_at: '2026-04-01T09:33:31Z', left_at: null }
            ]
          : [
              { device_id: DEVICE_ID, user_id: USER_ID, username: USERNAME, status: 'left', track_kind: 'audio_video', joined_at: '2026-04-01T09:33:30Z', left_at: '2026-04-01T09:35:00Z' },
              { device_id: 'device-remote', user_id: OTHER_USER_ID, username: 'casey', status: 'joined', track_kind: 'audio_video', joined_at: '2026-04-01T09:33:31Z', left_at: null }
            ]
        state.endpointExists = false
        return fulfillJson(route, {
          call: state.activeCall,
          participant: participants[0],
          participants,
          room: null
        })
      }

      if (action === 'webrtc-endpoint') {
        state.endpointExists = true
        return fulfillJson(route, {
          call: state.activeCall,
          endpoint: {
            exists: true,
            endpoint_id: 'endpoint-self',
            token: 'endpoint-token',
            inserted_at: '2026-04-01T09:33:00Z',
            updated_at: '2026-04-01T09:33:00Z'
          },
          room: null
        })
      }

      if (action === 'signals') {
        return fulfillJson(route, {
          call: state.activeCall,
          signal: {
            id: `signal-${Date.now()}`,
            from_device_id: DEVICE_ID,
            to_device_id: null,
            signal_type: 'heartbeat',
            payload: request.postDataJSON()?.payload ?? '{}',
            inserted_at: '2026-04-01T09:33:00Z'
          }
        })
      }
    }

    if (path.startsWith('/calls/') && path.endsWith('/webrtc-endpoint/poll') && method === 'POST') {
      return fulfillJson(route, {
        call: state.activeCall,
        endpoint: {
          exists: state.endpointExists,
          endpoint_id: state.endpointExists ? 'endpoint-self' : null,
          token: state.endpointExists ? 'endpoint-token' : null,
          inserted_at: state.endpointExists ? '2026-04-01T09:33:00Z' : null,
          updated_at: state.endpointExists ? '2026-04-01T09:33:00Z' : null
        },
        media_events: []
      })
    }

    return fulfillJson(route, {})
  })
}

export async function gotoSeededChatApp(page: Page, scenario: MockScenario) {
  await seedAuthenticatedApp(page, scenario.activeChatId ?? `${SERVER_ID}::${CHAT_DIRECT_ID}`)
  await installMockBrowserCapability(page, scenario.capability)
  await installMockApi(page, scenario)
  await page.goto('/')

  if (scenario.initialCall) {
    await Promise.any([
      page.locator('.ac__header-name').waitFor({ timeout: 15_000 }),
      page.locator('.active-call-bar').waitFor({ timeout: 15_000 }),
      page.getByRole('button', { name: 'End call' }).waitFor({ timeout: 15_000 })
    ])
    return
  }

  if (scenario.incomingCall) {
    await Promise.any([
      page.getByRole('button', { name: 'Accept call' }).waitFor({ timeout: 15_000 }),
      page.getByText(/does not support the WebRTC encoded transform APIs/i).waitFor({ timeout: 15_000 }),
      page.locator('.active-call-bar').waitFor({ timeout: 15_000 })
    ])
    return
  }

  const videoCallButton = page.getByRole('button', { name: 'Video call', exact: true })
  await videoCallButton.waitFor()
  if (scenario.capability === 'unsupported') {
    await expect(videoCallButton).toBeDisabled({ timeout: 15_000 })
    return
  }

  await expect(videoCallButton).toBeEnabled({ timeout: 15_000 })
}

export async function triggerIncomingDirectCall(page: Page) {
  await page.evaluate(async () => {
    await fetch('/api/v1/test/incoming-call', { method: 'POST' })
  })
}

export async function triggerRemoteActiveCallEnd(page: Page) {
  await page.evaluate(async () => {
    await fetch('/api/v1/test/end-active-call', { method: 'POST' })
  })
}
