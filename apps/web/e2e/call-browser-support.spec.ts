import { expect, test, type Page } from '@playwright/test'
import { gotoSeededChatApp, triggerRemoteActiveCallEnd } from './support/vostokApp'

test.describe('browser-level calling support', () => {
  test('blocks calling on unsupported browsers and shows compatibility details in settings', async ({ page }) => {
    await gotoSeededChatApp(page, { capability: 'unsupported' })

    await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Video call', exact: true })).toBeDisabled()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Encryption' }).click()

    await expect(page.getByText('Call Media Compatibility')).toBeVisible()
    await expect(page.getByText('Encrypted Calling')).toBeVisible()
    await expect(page.getByText('Unavailable')).toBeVisible()
    await expect(page.getByText(/does not support the WebRTC encoded transform APIs/i)).toBeVisible()
  })

  test('starts a direct video call from the real browser UI when capability is supported', async ({ page }) => {
    await gotoSeededChatApp(page, { capability: 'standard' })

    await expect(page.getByRole('button', { name: 'Video call', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Video call', exact: true }).click()

    await expect(page.locator('.outgoing-call-screen__name')).toHaveText('Casey Direct')
    await expect(page.getByText(/Starting video call/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'End call' })).toBeVisible()
  })

  test('starts an ad-hoc group call from the Calls tab in a supported browser', async ({ page }) => {
    await gotoSeededChatApp(page, { capability: 'standard' })

    await page.getByRole('button', { name: 'Calls' }).click()
    await expect(page.getByRole('button', { name: 'New group call' })).toBeEnabled()
    await page.getByRole('button', { name: 'New group call' }).click()

    await page.getByRole('button', { name: /alex/i }).click()
    await page.getByRole('button', { name: /blair/i }).click()
    await page.getByRole('button', { name: 'Voice (2)' }).click()

    await expect(page.locator('.ac__header-name')).toHaveText('Alex, Blair')
    await expect(page.getByText('Group call ringing…')).toBeVisible()
  })

  test('shows incoming calls but keeps accept blocked on unsupported browsers', async ({ page }) => {
    await gotoSeededChatApp(page, { capability: 'unsupported', incomingCall: true })

    await expect(page.getByRole('button', { name: 'Accept call' })).toBeDisabled()
    await expect(page.getByText(/does not support the WebRTC encoded transform APIs/i)).toBeVisible()
  })

  test('restores an already active direct call after app startup on a different selected chat', async ({ page }) => {
    await gotoSeededChatApp(page, {
      capability: 'standard',
      activeChatId: 'srv_e2e::chat-group-1',
      initialCall: 'direct-active'
    })

    await expect(page.locator('.ac__header-name')).toHaveText('Casey Direct')
    await expect(page.getByRole('button', { name: 'End call' })).toBeVisible()
    await expect(page.locator('.ac__placeholder-hint, .ac__timer').first()).toBeVisible()
  })

  test('restores an already active group room call after app startup', async ({ page }) => {
    await gotoSeededChatApp(page, {
      capability: 'standard',
      activeChatId: 'srv_e2e::chat-direct-1',
      initialCall: 'group-active'
    })

    await expect(page.locator('.ac__header-name')).toHaveText('Alex, Blair')
    await expect(page.getByRole('button', { name: 'End call' })).toBeVisible()
    await expect(page.getByText('jamie')).toBeVisible()
  })

  test.fixme('clears an active call after a focus-triggered remote end refresh', async ({ page }) => {
    await gotoSeededChatApp(page, {
      capability: 'standard',
      activeChatId: 'srv_e2e::chat-group-1',
      initialCall: 'direct-active'
    })

    await expect(page.locator('.ac__header-name')).toHaveText('Casey Direct')
    await triggerRemoteActiveCallEnd(page)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await expect(page.locator('.ac__header-name')).toHaveCount(0)
    await expect(page.locator('.active-call-bar')).toHaveCount(0)
    await expect(page.locator('.call-ended-screen')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('.conversation-header__name')).toHaveText('Design Circle', { timeout: 10_000 })
  })
})
