import { test, expect, type Page } from '@playwright/test'
import { seed } from './seed.mjs'

const API = process.env.E2E_API_URL || 'http://localhost:8080'
const SHOTS = process.env.E2E_SHOTS_DIR // optional: save screenshots for review

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function makeWebp(page: Page, w = 900, h = 600): Promise<Buffer> {
  const b64 = await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d')!
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#0ea5e9'); grd.addColorStop(1, '#6366f1')
    g.fillStyle = grd; g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 64px sans-serif'; g.fillText('focuz', w / 2 - 90, h / 2 + 20)
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/webp', 0.8))
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s)
  }, [w, h])
  return Buffer.from(b64, 'base64')
}

async function signIn(page: Page, token: string) {
  await page.goto('/')
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem('authToken', t); localStorage.setItem('authUsername', 'demo') }, token)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Sync status: Synced/ })).toBeVisible({ timeout: 20000 })
}

async function apiGet(token: string, path: string) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()).data
}

test('feed, compact layout and sync status', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API, undefined, await makeWebp(page))
  await signIn(page, s.token)
  await expect(page.getByText('Заметка про PWA')).toBeVisible()
  await expect(page.locator('img[alt="photo.webp"]').first()).toBeVisible({ timeout: 15000 })
  // Body text is desktop-sized now (was 24px).
  const fontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize)
  expect(fontSize).toBe('15px')
  await shot(page, '01-feed-1440')

  await page.getByRole('button', { name: /Sync status/ }).click()
  await expect(page.getByText('Everything is saved on the server.')).toBeVisible()
  await shot(page, '02-status-popover')
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1920, height: 1080 })
  await shot(page, '03-feed-1920')
  await page.setViewportSize({ width: 1280, height: 720 })
  await shot(page, '04-feed-1280')
  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '05-mobile')
  await page.getByRole('button', { name: 'Open spaces' }).click()
  await expect(page.getByRole('tree', { name: 'Saved filters' }).last()).toBeVisible()
  await shot(page, '06-mobile-drawer')
})

test('filter tree: collapsed by default, remembers expanded branches, scrolls', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API)
  await page.setViewportSize({ width: 1440, height: 640 })
  await signIn(page, s.token)
  const tree = page.getByRole('tree', { name: 'Saved filters' })
  // Only roots are visible by default.
  await expect(tree.getByRole('treeitem', { name: 'Работа' })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'Проекты' })).toHaveCount(0)

  await tree.getByRole('treeitem', { name: 'Работа' }).getByRole('button', { name: 'Expand' }).click()
  await tree.getByRole('treeitem', { name: 'Проекты' }).getByRole('button', { name: 'Expand' }).click()
  await tree.getByRole('treeitem', { name: 'Focuz' }).getByRole('button', { name: 'Expand' }).click()
  await tree.getByRole('treeitem', { name: 'Личное' }).getByRole('button', { name: 'Expand' }).click()
  await tree.getByRole('treeitem', { name: 'Здоровье' }).getByRole('button', { name: 'Expand' }).click()
  await tree.getByRole('treeitem', { name: 'Чтение' }).getByRole('button', { name: 'Expand' }).click()
  await expect(tree.getByRole('treeitem', { name: 'Синхронизация' })).toBeVisible()
  await shot(page, '07-filters-expanded')

  // The list scrolls when it is taller than the sidebar.
  const scroll = await tree.evaluate(el => { el.scrollTop = 10000; return { top: el.scrollTop, overflow: el.scrollHeight > el.clientHeight } })
  expect(scroll.overflow).toBe(true)
  expect(scroll.top).toBeGreaterThan(0)
  await expect(tree.getByRole('treeitem', { name: 'Входящие' })).toBeInViewport()
  await shot(page, '08-filters-scrolled')

  await page.reload()
  await expect(tree.getByRole('treeitem', { name: 'Синхронизация' })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: 'Кухня' })).toHaveCount(0)
})

test('paste an image from the clipboard into a new note', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API)
  await signIn(page, s.token)
  const webp = await makeWebp(page, 800, 600)

  await page.getByRole('button', { name: 'Add note…' }).click()
  const textarea = page.getByPlaceholder(/Add note/)
  await textarea.fill('Скриншот из буфера обмена')
  await textarea.evaluate((el, b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'image.png', { type: 'image/webp' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, webp.toString('base64'))
  await expect(page.getByRole('button', { name: 'Remove attachment' })).toHaveCount(1, { timeout: 10000 })
  await shot(page, '09-paste-image')
  await page.getByRole('button', { name: 'Create' }).click()

  // Note is shown immediately and the image reaches the server.
  await expect(page.getByText('Скриншот из буфера обмена')).toBeVisible()
  await expect.poll(async () => {
    const data = await apiGet(s.token, '/sync?since=1970-01-01T00:00:00Z')
    const n = (data.notes ?? []).find((x: any) => x.text === 'Скриншот из буфера обмена')
    return n?.attachments?.length ?? 0
  }, { timeout: 20000 }).toBe(1)
})

test('server loss: data stays local, status explains it, sync resumes', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API)
  await signIn(page, s.token)

  await page.route(`${API}/**`, r => r.abort('connectionrefused'))
  await page.routeWebSocket(/\/ws/, ws => ws.close())
  await page.getByRole('button', { name: 'Add note…' }).click()
  await page.getByPlaceholder(/Add note/).fill('Написано без сервера')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Написано без сервера')).toBeVisible()
  await expect(page.getByRole('button', { name: /Sync status: Server unreachable/ })).toBeVisible({ timeout: 15000 })
  // Connection state is shown by the status chip only, not by popups.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await page.getByRole('button', { name: /Sync status/ }).click()
  await expect(page.getByText('Cannot reach the server.', { exact: false }).first()).toBeVisible()
  await shot(page, '10-server-unreachable')

  await page.unroute(`${API}/**`)
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByRole('button', { name: /Sync status: Synced/ })).toBeVisible({ timeout: 20000 })
  const data = await apiGet(s.token, '/sync?since=1970-01-01T00:00:00Z')
  expect((data.notes ?? []).filter((n: any) => n.text === 'Написано без сервера')).toHaveLength(1)
})

test('replies stay attached to their parent on another device', async ({ page, browser }) => {
  await page.goto('/')
  const s = await seed(API)
  await signIn(page, s.token)
  // Reply to a note on device A.
  await page.locator('li', { hasText: 'Купить: молоко' }).getByRole('button', { name: 'Open note' }).click({ force: true })
  await page.getByRole('button', { name: 'Reply…' }).click()
  await page.getByPlaceholder('Reply…').fill('И ещё сыр')
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.getByRole('button', { name: /Sync status: Synced/ })).toBeVisible({ timeout: 20000 })

  // Device B: fresh browser profile.
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
  const b = await ctx.newPage()
  await signIn(b, s.token)
  await b.locator('li', { hasText: 'Купить: молоко' }).getByRole('button', { name: 'Open note' }).click({ force: true })
  await expect(b.getByText('И ещё сыр')).toBeVisible()
  await ctx.close()
})

test.describe('sign in page', () => {
  test('works with the keyboard only: Tab between fields, Enter submits', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    const name = `kb${Date.now().toString(36)}`
    // Create an account without touching the mouse.
    await page.getByRole('tab', { name: 'Create account' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    await page.getByLabel('Username').focus()
    await page.keyboard.type(name)
    await page.keyboard.press('Tab')
    await page.keyboard.type('weak')
    await page.keyboard.press('Enter')
    // Validation is announced and focus goes to the field to fix.
    await expect(page.getByText('Password does not meet the requirements')).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
    await shot(page, '13-register-validation')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Password123')
    await page.keyboard.press('Tab') // show/hide button
    await page.keyboard.press('Tab')
    await page.keyboard.type('Password123')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /Sync status/ })).toBeVisible({ timeout: 20000 })
  })

  test('explains wrong credentials and keeps the username', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await expect(page.getByLabel('Username')).toBeFocused()
    await shot(page, '14-sign-in')
    await page.getByLabel('Username').fill('nobody-here')
    await page.getByLabel('Password', { exact: true }).fill('wrong-password')
    await page.getByLabel('Password', { exact: true }).press('Enter')
    await expect(page.getByText('Wrong username or password.')).toBeVisible()
    await expect(page.getByLabel('Username')).toHaveValue('nobody-here')
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
    await shot(page, '15-sign-in-error')
    // Password managers need these to fill the right fields.
    await expect(page.getByLabel('Username')).toHaveAttribute('autocomplete', 'username')
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  })
})

test('toasts: undo after deleting a note, nothing else pops up', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API)
  await signIn(page, s.token)
  const card = page.locator('li', { hasText: 'Купить: молоко' })
  await card.hover()
  await card.getByRole('button', { name: 'Open actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const toast = page.locator('[data-sonner-toast]')
  await expect(toast).toHaveCount(1)
  await expect(toast).toContainText('Note deleted')
  await shot(page, '16-toast-undo')
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Купить: молоко')).toBeVisible()
  await expect(toast).toHaveCount(0)
})

// Needs a second API in e-mail mode: E2E_EMAIL_API_URL (e.g. http://localhost:8091) and the
// file its log mailer writes to: E2E_MAIL_LOG (MAIL_LOG_FILE of that server).
test.describe('custom server with e-mail accounts', () => {
  const emailApi = process.env.E2E_EMAIL_API_URL
  const mailLog = process.env.E2E_MAIL_LOG
  test.skip(!emailApi || !mailLog, 'E2E_EMAIL_API_URL / E2E_MAIL_LOG not set')

  async function lastCode(to: string): Promise<string> {
    const { readFileSync } = await import('node:fs')
    for (let i = 0; i < 20; i++) {
      const lines = readFileSync(mailLog!, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter((m: any) => m.to === to)
      if (lines.length) return lines[lines.length - 1].text.match(/\b(\d{6})\b/)[1]
      await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`no mail to ${to}`)
  }

  async function chooseServer(page: Page, address: string) {
    await page.getByRole('button', { name: 'Change' }).click()
    await expect(page.getByRole('heading', { name: 'Choose your server' })).toBeVisible()
    await page.getByLabel('Server address').fill(address)
    await page.getByLabel('Server address').press('Enter')
  }

  test('pick a server, sign up with e-mail, confirm with the code', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    // Wrong address: explained, stays on the server step.
    await chooseServer(page, 'localhost:9')
    await expect(page.getByText(/Cannot reach this server/)).toBeVisible()
    await shot(page, '17-server-error')
    await page.getByLabel('Server address').fill(new URL(emailApi!).host)
    await page.getByLabel('Server address').press('Enter')
    // The form adapts to the server: e-mail instead of username.
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByText(new URL(emailApi!).host)).toBeVisible()

    const email = `e2e.${Date.now()}@example.org`
    await page.getByRole('tab', { name: 'Create account' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('Password123')
    await page.getByLabel('Repeat password').fill('Password123')
    await shot(page, '18-email-register')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()
    await shot(page, '19-check-email')
    await page.getByLabel('Confirmation code').fill('000000')
    await expect(page.getByText(/not correct|expired|Too many/)).toBeVisible()
    await page.getByLabel('Confirmation code').fill(await lastCode(email)) // auto-submits at 6 digits
    await expect(page.getByRole('button', { name: /Sync status/ })).toBeVisible({ timeout: 20000 })
    // Notes go to the chosen server.
    await page.getByRole('button', { name: 'Add note…' }).click()
    await page.getByPlaceholder(/Add note/).fill('stored on the custom server')
    await page.getByRole('button', { name: 'Create' }).click()
    const token = await page.evaluate(() => localStorage.getItem('authToken'))
    await expect.poll(async () => {
      const res = await fetch(`${emailApi}/sync?since=1970-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${token}` } })
      const notes = ((await res.json()).data.notes ?? []) as any[]
      return notes.some(n => n.text === 'stored on the custom server')
    }, { timeout: 20000 }).toBe(true)
  })

  test('signing in before confirming leads to the code step', async ({ page }) => {
    const email = `later.${Date.now()}@example.org`
    await fetch(`${emailApi}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password123' }) })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await chooseServer(page, emailApi!)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('Password123')
    await page.getByLabel('Password', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await page.getByLabel('Confirmation code').fill(await lastCode(email))
    await expect(page.getByRole('button', { name: /Sync status/ })).toBeVisible({ timeout: 20000 })
  })
})
