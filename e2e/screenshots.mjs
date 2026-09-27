// Captures UI screenshots of a running build.
// Usage: node e2e/screenshots.mjs <webUrl> <apiUrl> <outDir>
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { seed } from './seed.mjs'

const [web = 'http://localhost:4173', api = 'http://localhost:8080', out = 'shots'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
const page = await ctx.newPage()

// Generate a webp in the browser for the attachment.
await page.goto('about:blank')
const b64 = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 600
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 900, 600); grd.addColorStop(0, '#0ea5e9'); grd.addColorStop(1, '#6366f1')
  g.fillStyle = grd; g.fillRect(0, 0, 900, 600)
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 64px sans-serif'; g.fillText('focuz', 330, 320)
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.8))
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s)
})
const s = await seed(api, undefined, Buffer.from(b64, 'base64'))
await page.goto(web)
await page.evaluate((t) => { localStorage.setItem('authToken', t); localStorage.setItem('authUsername', 'demo') }, s.token)
await page.goto(web)
await page.waitForTimeout(4000)
await page.screenshot({ path: `${out}/01-feed-1440.png` })
await page.getByRole('button', { name: /status/i }).first().click().catch(() => {})
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/02-status-popover.png` })
await page.keyboard.press('Escape')
await page.setViewportSize({ width: 1920, height: 1080 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/03-feed-1920.png` })
await page.setViewportSize({ width: 1280, height: 720 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/04-feed-1280.png` })
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/05-mobile.png` })
console.log(JSON.stringify(s))
await browser.close()
