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
  await expect(page.getByRole('tree', { name: 'Folders' }).last()).toBeVisible()
  await shot(page, '06-mobile-drawer')
})

test('filter tree: collapsed by default, remembers expanded branches, scrolls', async ({ page }) => {
  await page.goto('/')
  const s = await seed(API)
  await page.setViewportSize({ width: 1440, height: 640 })
  await signIn(page, s.token)
  const tree = page.getByRole('tree', { name: 'Folders' })
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
  await page.locator('li', { hasText: 'Купить: молоко' }).filter({ hasNot: page.locator('.pill-reply-preview') }).getByRole('button', { name: 'Open note' }).click({ force: true })
  await page.getByRole('button', { name: 'Reply…' }).click()
  await page.getByPlaceholder('Reply…').fill('И ещё сыр')
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.getByRole('button', { name: /Sync status: Synced/ })).toBeVisible({ timeout: 20000 })

  // Device B: fresh browser profile.
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
  const b = await ctx.newPage()
  await signIn(b, s.token)
  // The reply shows its parent's text in a preview; open the note itself.
  await b.locator('li', { hasText: 'Купить: молоко' }).filter({ hasNot: b.locator('.pill-reply-preview') }).getByRole('button', { name: 'Open note' }).click({ force: true })
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

test.describe('full-screen editor', () => {
  test('write a checklist note with formatting, tick items in the feed', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)
    await page.getByRole('button', { name: 'Add note…' }).click()
    await page.getByRole('button', { name: 'Open full-screen editor' }).click()
    const editor = page.getByRole('textbox', { name: 'Note text' })
    await expect(editor).toBeFocused()

    // Heading via the Aa menu, then a checklist via the "[ ] " shortcut and bold via Ctrl+B.
    await page.getByRole('button', { name: 'Text style' }).click()
    await page.getByRole('menuitem', { name: /Heading/ }).hover()
    await page.getByRole('menuitem', { name: /Heading 2/ }).click()
    // The menu hands focus back to the editor a frame after it closes.
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(editor).toBeFocused()
    await page.keyboard.type('Weekend trip')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[ ] ')
    await page.keyboard.type('tickets')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type('passport')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.press('Enter')
    await page.keyboard.type('charger')
    await shot(page, '22-fullscreen-editor')
    await page.keyboard.press('ControlOrMeta+Enter')

    const card = page.locator('li', { hasText: 'Weekend trip' }).first()
    await expect(card.getByRole('heading', { name: 'Weekend trip' })).toBeVisible()
    const boxes = card.locator('input.note-task-box')
    await expect(boxes).toHaveCount(3)
    await expect(card.locator('strong', { hasText: 'passport' })).toBeVisible()
    await boxes.nth(1).click()
    await expect(boxes.nth(1)).toBeChecked()
    await shot(page, '23-checklist-card')

    const token = s.token
    await expect.poll(async () => {
      const res = await fetch(`${API}/sync?since=1970-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${token}` } })
      const note = ((await res.json()).data.notes ?? []).find((n: any) => n.text.startsWith('## Weekend trip'))
      return note?.text
    }, { timeout: 20000 }).toBe('## Weekend trip\n\n- [ ] tickets\n- [x] **passport**\n- [ ] charger')
  })

  test('opening an old plain-text note in the editor does not change it', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)
    const card = page.locator('li', { hasText: 'Купить: молоко' })
    await card.hover()
    await card.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('button', { name: 'Open full-screen editor' }).click()
    await expect(page.getByRole('textbox', { name: 'Note text' })).toContainText('Купить: молоко')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0)
    await expect(page.locator('textarea').first()).toHaveValue('Купить: молоко, хлеб, кофе в зёрнах, батарейки AA.')
  })
})

test.describe('folders', () => {
  async function serverNote(token: string, text: string) {
    const data = await apiGet(token, '/sync?since=1970-01-01T00:00:00Z')
    return (data.notes ?? []).find((x: any) => x.text === text)
  }
  async function serverFilters(token: string) {
    const data = await apiGet(token, '/sync?since=1970-01-01T00:00:00Z')
    return (data.filters ?? []).filter((f: any) => !f.is_deleted && !f.deleted_at)
  }
  const tree = (page: Page) => page.getByRole('tree', { name: 'Folders' }).first()

  test('create a folder, write a note in it, sort an unsorted note into a folder', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)

    // New folder: the name suggests its tag, Enter creates and opens it.
    await page.getByRole('button', { name: 'New folder' }).click()
    await page.getByLabel('New folder name').fill('Ремонт кухни')
    await expect(page.getByRole('radio', { name: /Notes tagged #ремонт-кухни/ })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '24-new-folder')
    await page.getByLabel('New folder name').press('Enter')
    await expect(page.getByRole('heading', { name: 'Ремонт кухни' })).toBeVisible()
    await expect(page.getByText('Notes tagged #ремонт-кухни')).toBeVisible()
    await expect(page.getByText('No notes here yet.')).toBeVisible()

    // A note written inside gets the folder's tag.
    await page.getByRole('button', { name: 'Add note…' }).click()
    await page.getByPlaceholder(/Add note/).fill('Выбрать плитку для фартука')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.locator('li', { hasText: 'Выбрать плитку' })).toBeVisible()
    await expect(tree(page).getByRole('treeitem', { name: 'Ремонт кухни' })).toContainText('1')
    await expect.poll(async () => (await serverNote(s.token, 'Выбрать плитку для фартука'))?.tags ?? [], { timeout: 20000 }).toEqual(['ремонт-кухни'])

    // A note without tags written in All notes lands in Unsorted.
    await page.getByRole('button', { name: 'All notes' }).click()
    await page.getByRole('button', { name: 'Add note…' }).click()
    await page.getByPlaceholder(/Add note/).fill('Позвонить в сервис')
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByRole('button', { name: 'Unsorted' }).click()
    await expect(page.getByRole('heading', { name: 'Unsorted' })).toBeVisible()
    const card = page.locator('li', { hasText: 'Позвонить в сервис' })
    await expect(card).toBeVisible()
    await expect(page.locator('li', { hasText: 'Выбрать плитку' })).toHaveCount(0)

    // ⋮ → Folders…: tick "Дом", the note gets #home and leaves Unsorted.
    await card.hover()
    await card.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Folders…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Folders' })
    await dialog.getByRole('checkbox', { name: /^Дом/ }).check()
    await shot(page, '25-note-folders')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(card).toHaveCount(0)
    await expect(page.getByText('Everything is in a folder.')).toBeVisible()
    await expect.poll(async () => (await serverNote(s.token, 'Позвонить в сервис'))?.tags ?? [], { timeout: 20000 }).toEqual(['home'])
  })

  test('save a search as a smart folder, edit its rule, delete the parent keeping subfolders', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)
    await tree(page).getByRole('treeitem', { name: 'Работа' }).click()
    await expect(page.getByRole('heading', { name: 'Работа' })).toBeVisible()

    // Subfolders are included by default; "Only this folder" leaves out what they already show.
    await tree(page).getByRole('treeitem', { name: 'Работа' }).getByRole('button', { name: 'Expand' }).click()
    await expect(page.locator('li', { hasText: 'Созвон с командой' })).toBeVisible() // #work #meetings
    await page.getByRole('button', { name: 'Only this folder' }).click()
    await expect(page.locator('li', { hasText: 'Созвон с командой' })).toHaveCount(0)
    await expect(page.locator('li', { hasText: 'Ответ: backoff' })).toBeVisible()
    await page.getByRole('button', { name: 'With subfolders' }).click()

    // Search + exclude a tag, then save it as a folder inside Работа.
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('backoff')
    await page.getByRole('button', { name: 'Add filter' }).click()
    await page.getByRole('button', { name: 'Hide notes tagged sync' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Remove filter not #sync' })).toBeVisible()
    await expect(page.locator('li', { hasText: 'Ответ: backoff' })).toBeVisible()
    await expect(page.locator('li', { hasText: 'Ревью архитектуры' }).filter({ hasNotText: 'Ответ' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Save as folder' }).click()
    await page.getByLabel(/New folder inside/).fill('Backoff')
    await page.getByLabel(/New folder inside/).press('Enter')
    await expect(page.getByRole('heading', { name: 'Backoff' })).toBeVisible()
    await expect(page.getByText('Notes tagged #work, without #sync, containing “backoff”')).toBeVisible()
    await expect(page.locator('li', { hasText: 'Ответ: backoff' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove filter not #sync' })).toHaveCount(0) // filters were saved into the folder
    await shot(page, '26-smart-folder')

    // Edit the rule: drop the exclusion, the list previews the change, Save keeps it.
    await page.getByRole('button', { name: 'Edit rule' }).click()
    await expect(page.getByRole('region', { name: 'Editing folder rule' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove filter not #sync' }).click()
    await expect(page.locator('li', { hasText: 'Ревью архитектуры' }).filter({ hasNotText: 'Ответ' })).toBeVisible()
    await page.getByRole('button', { name: 'Save rule' }).click()
    await expect(page.getByText('Notes tagged #work, containing “backoff”')).toBeVisible()
    await expect.poll(async () => (await serverFilters(s.token)).find((f: any) => f.name === 'Backoff')?.params?.excludeTags ?? null, { timeout: 20000 }).toEqual([])

    // Delete Работа but keep its subfolders: they move up, notes stay.
    await tree(page).getByRole('treeitem', { name: 'Работа' }).hover()
    await page.getByRole('button', { name: 'Folder actions: Работа' }).click()
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const dialog = page.getByRole('dialog', { name: /Delete “Работа”/ })
    await expect(dialog.getByRole('radio', { name: /Keep subfolders/ })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: /Also delete/ })).not.toBeChecked()
    await shot(page, '27-delete-folder')
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(tree(page).getByRole('treeitem', { name: 'Работа' })).toHaveCount(0)
    await expect(tree(page).getByRole('treeitem', { name: 'Backoff' })).toHaveAttribute('aria-level', '1')
    await expect(page.locator('[data-sonner-toast]')).toContainText('Folder deleted. Notes are kept')
    await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click()
    await expect(tree(page).getByRole('treeitem', { name: 'Работа' })).toBeVisible()
    await expect(tree(page).getByRole('treeitem', { name: 'Backoff' })).toHaveAttribute('aria-level', '2')
  })

  test('phone: the top bar names the folder and opens the folder list', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, s.token)
    await page.getByRole('button', { name: /Folders. Current: All notes/ }).click()
    await page.getByRole('tree', { name: 'Folders' }).last().getByRole('treeitem', { name: 'Дом' }).click()
    await expect(page.getByRole('button', { name: /Folders. Current: Дом/ })).toBeVisible()
    await expect(page.locator('li', { hasText: 'Купить: молоко' })).toBeVisible()
    await expect(page.locator('li', { hasText: 'Тренировка' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add filter' }).click()
    await page.getByRole('button', { name: 'Only notes tagged shopping' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('li', { hasText: 'Список подарков' })).toHaveCount(0)
    await shot(page, '28-mobile-folder')
  })
})

test.describe('shared spaces', () => {
  async function newAccount(prefix: string) {
    const username = `${prefix}${Date.now().toString(36)}`
    const post = (path: string) => fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Password123' }) })
    expect((await post('/register')).status).toBe(201)
    const token = (await (await post('/login')).json()).data.token as string
    return { username, token }
  }

  test('create a space, invite by name, accept from the bell, roles decide what people can do', async ({ page, browser }) => {
    await page.goto('/')
    const anna = await seed(API)
    const bob = await newAccount('bob')
    await signIn(page, anna.token)

    // Create a space: the members tab opens right away to invite people.
    await page.getByRole('button', { name: 'New space' }).click()
    await page.getByLabel('Name').fill('Book club')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Book club' })
    await expect(settings.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true')
    await settings.getByPlaceholder('Username').fill(bob.username)
    await settings.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText(`Invitation for “${bob.username}” is sent`)
    // An unknown name gets exactly the same answer: invitations don't reveal who has an account.
    await settings.getByPlaceholder('Username').fill('nobody-here-42')
    await settings.getByRole('button', { name: 'Invite', exact: true }).click()
    await expect(settings.getByRole('status')).toContainText('Invitation for “nobody-here-42” is sent')
    await expect(settings.getByRole('region', { name: 'Pending invitations' }).or(settings.locator('section[aria-label="Pending invitations"]'))).toContainText(bob.username)
    await shot(page, '29-invite-members')
    await page.keyboard.press('Escape')

    await expect(page.getByRole('button', { name: /Space menu: Book club/ })).toBeVisible()
    await page.getByRole('button', { name: 'Add note…' }).click()
    await page.getByPlaceholder(/Add note/).fill('Next book: Dune')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('li', { hasText: 'Next book: Dune' })).toBeVisible()

    // Bob: the bell shows the invitation, Accept opens the space with Anna's note and her name.
    const bobCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
    const bobPage = await bobCtx.newPage()
    await signIn(bobPage, bob.token)
    const bell = bobPage.getByRole('button', { name: /Notifications, 1 unread/ })
    await expect(bell).toBeVisible({ timeout: 15000 })
    await bell.click()
    await expect(bobPage.getByText(`${anna.username} invited you to Book club as editor`)).toBeVisible()
    await shot(bobPage, '30-bell-invitation')
    await bobPage.getByRole('button', { name: 'Accept' }).click()
    await expect(bobPage.getByRole('button', { name: /Space menu: Book club/ })).toBeVisible({ timeout: 15000 })
    const annasNote = bobPage.locator('li', { hasText: 'Next book: Dune' })
    await expect(annasNote).toBeVisible()
    await expect(annasNote).toContainText(anna.username)
    await shot(bobPage, '31-shared-space')

    // Editors don't delete other people's notes; Details shows who wrote it.
    await annasNote.hover()
    await annasNote.getByRole('button', { name: 'Open actions' }).click()
    await expect(bobPage.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    await expect(bobPage.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
    await bobPage.getByRole('menuitem', { name: 'Details' }).click()
    const details = bobPage.getByRole('dialog', { name: 'Details' })
    await expect(details).toContainText(anna.username)
    await expect(details.getByRole('region', { name: 'History' }).or(details.locator('section[aria-label="History"]'))).toContainText('created it')
    await bobPage.keyboard.press('Escape')

    // Anna is told Bob joined, and makes him a guest: his composer goes away.
    await expect(page.getByRole('button', { name: /Notifications, 1 unread/ })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /Space menu: Book club/ }).click()
    await page.getByRole('menuitem', { name: 'Members' }).click()
    await page.getByLabel(`Role of ${bob.username}`).selectOption('guest')
    await page.keyboard.press('Escape')
    await expect(bobPage.getByText('You are a guest here')).toBeVisible({ timeout: 20000 })
    await expect(bobPage.getByRole('button', { name: 'Add note…' })).toHaveCount(0)
    await bobCtx.close()
  })

  test('publish a note with its replies, turn replies off, make it private again', async ({ page, browser }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)
    const root = page.locator('li', { hasText: 'Ревью архитектуры синхронизации' }).filter({ hasText: '2 replies' })
    await root.hover()
    await root.getByRole('button', { name: 'Open actions' }).click()
    await page.getByRole('menuitem', { name: 'Share…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Share note' })
    await expect(dialog.getByRole('switch', { name: /Replies are public too/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Make public' }).click()
    const link = dialog.getByLabel('Public link')
    await expect(link).toHaveValue(/\/p\//)
    const url = await link.inputValue()
    await shot(page, '32-share-dialog')
    await page.keyboard.press('Escape')

    // The note and its replies (inherited, lighter) get the planet.
    await expect(root.getByRole('button', { name: 'Public note: link and settings' })).toBeVisible()
    await expect(page.locator('li', { hasText: 'Ответ: backoff' }).getByRole('button', { name: 'Public as part of a shared thread' })).toBeVisible()

    // Anyone can read it without signing in.
    const guest = await browser.newContext({ viewport: { width: 1000, height: 900 }, serviceWorkers: 'block' })
    const pub = await guest.newPage()
    await pub.goto(url)
    await expect(pub.getByText('Public, read-only')).toBeVisible()
    await expect(pub.getByText('Ревью архитектуры синхронизации')).toBeVisible()
    await expect(pub.getByText('Ответ: backoff начинать с 2с')).toBeVisible()
    await shot(pub, '33-public-page')

    // Replies private: the page shows only the note.
    await root.getByRole('button', { name: 'Public note: link and settings' }).click()
    await dialog.getByRole('switch', { name: /Replies are public too/ }).click()
    await expect(dialog.getByRole('switch', { name: /Replies are public too/ })).not.toBeChecked({ timeout: 10000 })
    await pub.reload()
    await expect(pub.getByText('Ревью архитектуры синхронизации')).toBeVisible()
    await expect(pub.getByText('Ответ: backoff начинать с 2с')).toHaveCount(0)

    // Private again: the link stops working, the planet goes away.
    await dialog.getByRole('button', { name: 'Make private' }).click()
    await expect(root.getByRole('button', { name: 'Public note: link and settings' })).toHaveCount(0, { timeout: 10000 })
    await pub.reload()
    await expect(pub.getByText('This page is not available')).toBeVisible()
    await guest.close()
  })

  test('settings: account, e-mail notifications explained, theme', async ({ page }) => {
    await page.goto('/')
    const s = await seed(API)
    await signIn(page, s.token)
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByText(s.username)).toBeVisible()
    await shot(page, '34-settings')
    await dialog.getByRole('tab', { name: 'Notifications' }).click()
    await expect(dialog.getByText('This server uses usernames')).toBeVisible()
    await dialog.getByRole('tab', { name: 'Appearance' }).click()
    await dialog.getByRole('radio', { name: /Light/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await dialog.getByRole('radio', { name: /Dark/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
