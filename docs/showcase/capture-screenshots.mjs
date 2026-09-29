/**
 * Regenerate showcase PNGs. Run from e2e/ so Playwright resolves:
 *   cd e2e && node ../docs/showcase/capture-screenshots.mjs
 *
 * CLI shots read docs/showcase/cli-*.txt (real command output).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../e2e/package.json', import.meta.url))
const { chromium } = require('@playwright/test')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = __dirname
const baseURL = process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:5173'
const projectId = process.env.SHOWCASE_PROJECT_ID ?? 'e4317707-09ba-4640-8a4a-afc5a3d65ef5'

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function terminalDocument(title, command, output) {
  const prompt = command
    ? `<span class="prompt">$ </span><span class="cmd">${escapeHtml(command)}</span>\n`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #1e1e1e; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .window { border-radius: 10px; overflow: hidden; border: 1px solid #333; box-shadow: 0 16px 40px rgba(0,0,0,.4); }
    .titlebar { background: #323232; color: #c8c8c8; font-size: 13px; padding: 10px 14px; }
    pre { margin: 0; padding: 16px 18px 20px; background: #0c0c0c; color: #d4d4d4; font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .prompt { color: #4ec9b0; }
    .cmd { color: #dcdcaa; }
  </style>
</head>
<body>
  <div class="window">
    <div class="titlebar">${escapeHtml(title)}</div>
    <pre>${prompt}${escapeHtml(output.trimEnd())}\n</pre>
  </div>
</body>
</html>`
}

/** Clip off the empty shell below the last real control so sparse pages are not mostly blank. */
async function shotPage(page, name) {
  const viewport = page.viewportSize()
  const height = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body
    const nodes = main.querySelectorAll('h1, h2, h3, p, a, button, table, li, input, textarea')
    let max = 0
    for (const el of nodes) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) continue
      max = Math.max(max, rect.bottom)
    }
    const header = document.querySelector('header')
    if (header) max = Math.max(max, header.getBoundingClientRect().bottom)
    return Math.ceil(max + 28)
  })
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    clip: {
      x: 0,
      y: 0,
      width: viewport.width,
      height: Math.max(320, Math.min(height, viewport.height)),
    },
  })
  console.log('wrote', name, height)
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function openApp(urlPath) {
  await page.goto(`${baseURL}${urlPath}`, { waitUntil: 'networkidle' })
  await page.getByRole('radio', { name: 'Light theme' }).click().catch(() => {})
}

await page.setViewportSize({ width: 960, height: 720 })
await openApp('/')
await page.getByRole('heading', { name: 'Projects' }).waitFor()
await page.getByRole('heading', { name: 'Demo App' }).waitFor()
await shotPage(page, '01-projects-dashboard')
await page.setViewportSize({ width: 1440, height: 900 })

await openApp(`/projects/${projectId}`)
await page.getByRole('heading', { name: 'Overview' }).waitFor()
await page.getByText('Recent activity').waitFor()
await page.getByText('No activity yet').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
await shotPage(page, '03-project-overview')

await openApp(`/projects/${projectId}/strings`)
await page.getByRole('button', { name: 'Add string' }).waitFor()
await page.getByText('sign_in').waitFor()
await shotPage(page, '02-strings-editor')

await page.getByRole('button', { name: 'Add string' }).click()
const addDialog = page.getByRole('dialog')
await addDialog.getByRole('heading', { name: 'Add string' }).waitFor()
await addDialog.getByLabel('Key').fill('checkout.title')
await addDialog.getByLabel('Source text').fill('Thanh toán')
await addDialog.getByLabel('Description').fill('Checkout page title')
await addDialog.screenshot({ path: path.join(outDir, '09-add-string.png') })
console.log('wrote', '09-add-string')
await page.keyboard.press('Escape')

await openApp(`/projects/${projectId}/strings?missing_locale=en`)
await page.getByRole('button', { name: 'Add string' }).waitFor()
await page.getByText('Missing').first().waitFor()
await shotPage(page, '10-strings-missing-en')

await openApp(`/projects/${projectId}/modules`)
await page.getByRole('heading', { name: 'Modules' }).waitFor()
await page.getByText('common').first().waitFor()
await shotPage(page, '04-modules')

await openApp(`/projects/${projectId}/tags`)
await page.getByRole('heading', { name: 'Tags' }).waitFor()
await page.getByRole('button', { name: 'New tag' }).waitFor()
await shotPage(page, '11-tags')
await page.getByRole('button', { name: 'New tag' }).click()
const tagDialog = page.getByRole('dialog')
await tagDialog.getByRole('heading', { name: 'New tag' }).waitFor()
await tagDialog.getByLabel('Name').fill('release')
await tagDialog.screenshot({ path: path.join(outDir, '19-new-tag.png') })
console.log('wrote', '19-new-tag')
await page.keyboard.press('Escape')

await openApp(`/projects/${projectId}/import-export`)
await page.getByRole('heading', { name: 'Import / Export' }).waitFor()
await page.getByRole('heading', { name: 'Export' }).waitFor()
await shotPage(page, '05-import-export')
await page.getByText('INBOUND').evaluate((el) => el.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(outDir, '12-import.png') })
console.log('wrote', '12-import')

await openApp(`/projects/${projectId}/activity`)
await page.getByRole('heading', { name: 'Activity' }).waitFor()
await page.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
await page.getByText(/Imported|Updated source|No activity yet/).first().waitFor({ timeout: 15000 })
const showStrings = page.getByRole('button', { name: /Show \d+ strings/ }).first()
if (await showStrings.isVisible().catch(() => false)) {
  await showStrings.click()
  await page.waitForTimeout(300)
}
await shotPage(page, '06-activity')

await openApp(`/projects/${projectId}/settings`)
await page.getByRole('heading', { name: 'Settings' }).waitFor()
await page.getByRole('heading', { name: 'API keys' }).waitFor()
await shotPage(page, '07-settings')

await openApp('/login')
await page.getByRole('button', { name: 'Continue with Microsoft' }).waitFor()
await shotPage(page, '13-login')

const cliShots = [
  {
    name: '14-cli-init',
    title: 'locale init',
    command: 'locale init -k demo-local-key -u http://localhost:8000 -o ./locales -y',
    file: 'cli-01-init.txt',
  },
  {
    name: '15-cli-status',
    title: 'locale status',
    command: 'locale status',
    file: 'cli-02-status.txt',
  },
  {
    name: '16-cli-pull',
    title: 'locale pull',
    command: 'locale pull',
    file: 'cli-03-pull.txt',
  },
  {
    name: '17-cli-push',
    title: 'locale push',
    command: 'locale push',
    file: 'cli-04-push.txt',
  },
  {
    name: '18-cli-status-synced',
    title: 'locale status (after push)',
    command: 'locale status',
    file: 'cli-05-status-after-push.txt',
  },
]

const cliPage = await browser.newPage({ viewport: { width: 980, height: 2400 } })
for (const shot of cliShots) {
  const output = fs.readFileSync(path.join(outDir, shot.file), 'utf8')
  const htmlPath = path.join(outDir, `.tmp-${shot.name}.html`)
  fs.writeFileSync(htmlPath, terminalDocument(shot.title, shot.command, output))
  await cliPage.goto(`file://${htmlPath}`)
  const box = await cliPage.locator('.window').boundingBox()
  await cliPage.setViewportSize({
    width: 980,
    height: Math.ceil((box?.height ?? 400) + 8),
  })
  await cliPage.screenshot({ path: path.join(outDir, `${shot.name}.png`) })
  fs.unlinkSync(htmlPath)
  console.log('wrote', shot.name)
}

const combined = cliShots
  .map((shot) => {
    const output = fs.readFileSync(path.join(outDir, shot.file), 'utf8').trimEnd()
    return `$ ${shot.command}\n${output}`
  })
  .join('\n\n')
const combinedPath = path.join(outDir, '.tmp-cli-workflow.html')
fs.writeFileSync(
  combinedPath,
  terminalDocument('x-locale CLI — Demo App (modular)', '', combined),
)
await cliPage.goto(`file://${combinedPath}`)
const combinedBox = await cliPage.locator('.window').boundingBox()
await cliPage.setViewportSize({
  width: 980,
  height: Math.ceil((combinedBox?.height ?? 800) + 8),
})
await cliPage.screenshot({ path: path.join(outDir, '08-cli-workflow.png') })
fs.unlinkSync(combinedPath)
console.log('wrote', '08-cli-workflow')

await browser.close()
