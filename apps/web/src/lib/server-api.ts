import type {
  ChatSummary,
  DeviceInfo,
  InviteValidation,
  LoginResponse,
  MeResponse
} from './api.ts'
import type { RegisterPayload, LinkDevicePayload } from './api.ts'
import type { ServerInfo } from '../types.ts'
import { createApiRequest } from './api-request.ts'

export type ServerApiClient = {
  getServerInfo: () => Promise<ServerInfo>
  login: (username: string, password: string) => Promise<LoginResponse>
  register: (payload: {
    invite_code?: string
    username: string
    display_name?: string
    password: string
  }) => Promise<LoginResponse>
  bootstrap: (payload: {
    username: string
    display_name?: string
    password: string
  }) => Promise<LoginResponse>
  devQuickLogin: (username: string) => Promise<LoginResponse>
  checkUsername: (username: string) => Promise<{ available: boolean }>
  validateInvite: (code: string) => Promise<InviteValidation>
  requestAccess: (name: string, message?: string) => Promise<{ ok: boolean }>
  requestPasswordReset: (username: string, message?: string) => Promise<{ ok: boolean }>
  logout: (accessToken: string, refreshToken: string) => Promise<void>
  changePassword: (accessToken: string, newPassword: string) => Promise<{ ok: boolean }>
  refreshAccessToken: (refreshToken: string) => Promise<{
    access_token: string
    user: {
      id: string
      username: string
      display_name: string | null
      role: string
      temp_password: boolean
    }
  }>
  fetchMe: (token: string) => Promise<MeResponse>
  listChats: (token: string) => Promise<{ chats: ChatSummary[] }>
  createSelfChat: (token: string) => Promise<{ chat: ChatSummary }>
  markChatRead: (token: string, chatId: string, lastMessageId?: string) => Promise<{ ok: boolean }>
  listDevices: (token: string) => Promise<{ devices: DeviceInfo[] }>
  linkDevice: (token: string, payload: LinkDevicePayload) => Promise<{
    user: { id: string; username: string }
    device: { id: string; device_name: string }
    session: { token: string }
    prekey_count: number
  }>
  registerDevice: (payload: RegisterPayload) => Promise<{
    user: { id: string; username: string }
    device: { id: string; device_name: string }
    session: { token: string }
    prekey_count: number
  }>
}

function authHeader(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  }
}

export function createServerApiClient(baseUrl: string): ServerApiClient {
  const request = createApiRequest(baseUrl)

  return {
    getServerInfo: () => request<ServerInfo>('/server/info'),

    login: (username, password) =>
      request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      }),

    register: (payload) =>
      request<LoginResponse>('/register/account', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),

    bootstrap: (payload) =>
      request<LoginResponse>('/register/bootstrap', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),

    devQuickLogin: (username) =>
      request<LoginResponse>('/dev/login', {
        method: 'POST',
        body: JSON.stringify({ username })
      }),

    checkUsername: (username) =>
      request<{ available: boolean }>(`/auth/check-username/${encodeURIComponent(username)}`),

    validateInvite: (code) =>
      request<InviteValidation>(`/invites/${encodeURIComponent(code)}/validate`),

    requestAccess: (name, message) =>
      request<{ ok: boolean }>('/auth/access-request', {
        method: 'POST',
        body: JSON.stringify({ name, message })
      }),

    requestPasswordReset: (username, message) =>
      request<{ ok: boolean }>('/auth/password-reset-request', {
        method: 'POST',
        body: JSON.stringify({ username, message })
      }),

    logout: async (accessToken, refreshToken) => {
      await request<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
        headers: authHeader(accessToken),
        body: JSON.stringify({ refresh_token: refreshToken })
      })
    },

    changePassword: (accessToken, newPassword) =>
      request<{ ok: boolean }>('/auth/change-password', {
        method: 'POST',
        headers: authHeader(accessToken),
        body: JSON.stringify({ new_password: newPassword })
      }),

    refreshAccessToken: (refreshToken) =>
      request<{
        access_token: string
        user: {
          id: string
          username: string
          display_name: string | null
          role: string
          temp_password: boolean
        }
      }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken })
      }),

    fetchMe: (token) =>
      request<MeResponse>('/me', {
        method: 'GET',
        headers: authHeader(token)
      }),

    listChats: (token) =>
      request<{ chats: ChatSummary[] }>('/chats', {
        method: 'GET',
        headers: authHeader(token)
      }),

    createSelfChat: (token) =>
      request<{ chat: ChatSummary }>('/chats/self', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({})
      }),

    markChatRead: async (token, chatId, lastMessageId) => {
      await request<{ ok: boolean }>(`/chats/${chatId}/read`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(lastMessageId ? { last_message_id: lastMessageId } : {})
      })

      return { ok: true }
    },

    listDevices: (token) =>
      request<{ devices: DeviceInfo[] }>('/devices', {
        method: 'GET',
        headers: authHeader(token)
      }),

    linkDevice: (token, payload) =>
      request<{
        user: { id: string; username: string }
        device: { id: string; device_name: string }
        session: { token: string }
        prekey_count: number
      }>('/devices/link', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(payload)
      }),

    registerDevice: (payload) =>
      request<{
        user: { id: string; username: string }
        device: { id: string; device_name: string }
        session: { token: string }
        prekey_count: number
      }>('/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
  }
}
