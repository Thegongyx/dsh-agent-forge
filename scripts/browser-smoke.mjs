/**
 * Real-browser check.
 *
 * Everything else in `scripts/` reasons about the plugin; this one looks at it.
 * It boots a throwaway harness on an ephemeral port, opens the page in headless
 * Chromium, and drives the shipped UI: the sidebar entry this plugin contributes,
 * the canvas behind it, and the settings page inside Settings. A jsdom mount can
 * prove a component responds to the props it is handed; only a browser can prove
 * the shell hands it those props at all.
 *
 * The cleanest single signal that the browser half mounted is the stylesheet it
 * installs in `apply` — a `<style>` element with this plugin's id — because
 * nothing else in the page produces it.
 *
 * Chromium comes from the machine's existing Playwright browser cache, so this
 * downloads nothing. The temporary harness binds an OS-chosen port and is killed
 * at the end; it never touches the profile the running instance is using.
 *
 * @module dsh-agent-forge/scripts/browser-smoke
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const cache = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
const chrome = join(cache, 'chromium-1223', 'chrome-win64', 'chrome.exe')
const profile = process.env.DSH_PROFILE ?? 'web'

if (!existsSync(dshBin)) throw new Error(`browser-smoke: ${dshBin} is missing`)
if (!existsSync(chrome)) {
  throw new Error(
    `browser-smoke: no Chromium at ${chrome}. Set one up with \`npx playwright install chromium\`.`,
  )
}

/**
 * Boots the harness and resolves the URL it prints.
 * @returns the child process and its authenticated URL.
 */
function boot() {
  const child = spawn(process.execPath, [dshBin, '--profile', profile, '--no-open', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((accept, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`no URL within 30s; saw: ${buffer.slice(0, 400)}`)), 30_000)
    const inspect = chunk => {
      buffer += String(chunk)
      const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
      if (match === null) return
      clearTimeout(timer)
      accept({ child, url: match[0] })
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`harness exited (${code}): ${buffer.slice(0, 400)}`)) })
  })
}

const { child, url } = await boot()
process.stdout.write(`harness -> ${url.split('?')[0]}\n`)

const browser = await chromium.launch({ executablePath: chrome, headless: true })
let failed = false

try {
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  // A `<style>` element has no box, so it is never "visible"; only attached.
  await page.waitForSelector('style[data-plugin-css="dsh-agent-forge/page.css"]', {
    state: 'attached',
    timeout: 45_000,
  })

  // Reaching this point already means the browser half mounted and ran apply.
  const boot = await page.evaluate(() => JSON.stringify(window.__DSH_BOOT__ ?? null))
  assert.ok(boot.includes('dsh-agent-forge'), 'browser-smoke: the boot graph does not carry this plugin')
  process.stdout.write('browser-smoke: the browser half mounted and installed its stylesheet\n')

  // --------------------------------------------------------------- the mode

  // Order matters throughout this file: each surface below replaces the one
  // before it in the main panel, and the harness restores whatever session was
  // last open. Start from a new session so the hero surfaces exist. The button's
  // accessible name is its aria-label, and the collapsed sidebar duplicates it.
  await page.locator('button[aria-label="新建会话"]:visible').first().click()
  await page.waitForTimeout(1500)

  const chip = page.locator('button').filter({ hasText: /模式/ }).first()
  assert.ok(await chip.count() > 0, 'browser-smoke: no mode chip is present on a new session')
  await chip.click()
  await page.waitForTimeout(600)
  const pickerText = await page.locator('body').innerText()
  assert.ok(pickerText.includes('多智能体模式'), 'browser-smoke: the mode picker does not offer this preset')
  process.stdout.write('browser-smoke: the mode picker offers the multi-agent preset\n')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ------------------------------------------------------------ the run canvas

  const panel = page.getByRole('button', { name: '工作全景图' })
  await panel.first().click()
  await page.waitForSelector('.dsh-af-map', { timeout: 15_000 })
  const mapText = await page.locator('.dsh-af-map').innerText()
  assert.ok(mapText.includes('多 agent 工作全景图'), 'browser-smoke: the canvas did not render its heading')
  assert.ok(
    mapText.includes('本会话还没有委派过任务'),
    'browser-smoke: a fresh session should show the canvas empty state',
  )
  process.stdout.write('browser-smoke: the sidebar entry opens the run canvas\n')

  // ----------------------------------------------------------- the settings page

  await page.getByRole('button', { name: '设置' }).first().click()
  const sectionNav = page.getByText('多智能体', { exact: true })
  await sectionNav.first().click({ timeout: 15_000 })
  await page.waitForSelector('.dsh-af', { timeout: 15_000 })
  const settingsText = await page.locator('.dsh-af').innerText()
  for (const label of ['挥金如土', '缝缝补补', '看图说话']) {
    assert.ok(settingsText.includes(label), `browser-smoke: the settings page does not show ${label}`)
  }
  assert.ok(settingsText.includes('Agent'), 'browser-smoke: the settings page rendered no tabs')
  process.stdout.write('browser-smoke: the settings page renders the shipped roster\n')

  // The pickers are filled from two independent sources: the tool and plugin
  // lists come from the Host's own catalogue route, the model list from the
  // session Remote. Either one coming back empty is silent in the UI — the
  // control still renders — so assert the options, not just the controls.
  await page.waitForTimeout(1500)
  const filled = await page.evaluate(async () => {
    const count = selector => document.querySelector(selector)?.options.length ?? -1
    const response = await fetch('/dsh-agent-forge/catalog')
    const body = response.ok ? await response.json() : null
    return {
      status: response.status,
      tools: body?.tools?.length ?? -1,
      plugins: body?.plugins?.length ?? -1,
      provider: count('select#dsh-af-provider'),
      model: count('select#dsh-af-model'),
      effort: count('select#dsh-af-effort'),
      toolMode: count('select#dsh-af-toolmode'),
      pluginRows: document.querySelectorAll('.dsh-af__checks--tall input[type=checkbox]').length,
      text: document.querySelector('.dsh-af')?.innerText ?? '',
    }
  })
  assert.equal(filled.status, 200, `browser-smoke: the catalogue route did not answer (${JSON.stringify(filled)})`)
  assert.ok(filled.tools > 0, `browser-smoke: the catalogue carried no tools (${JSON.stringify(filled)})`)
  // The route answering is not the same as the page having read it: the first
  // fetch is issued mid-boot and used to come back empty with nothing retrying.
  assert.ok(filled.pluginRows > 0, `browser-smoke: the page never read the catalogue (${JSON.stringify(filled)})`)
  process.stdout.write(`browser-smoke: the pickers are filled ${JSON.stringify(filled)}\n`)

  // Select-all end to end. The settings write once succeeded and the projection
  // dropped the field for built-in agents, so every box snapped back unchecked
  // with no error anywhere — the button has to be driven and the boxes counted.
  await page.getByRole('button', { name: '全选' }).first().click()
  await page.waitForTimeout(1000)
  const selected = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.dsh-af__details input[type=checkbox]')]
    return { total: boxes.length, checked: boxes.filter(box => box.checked).length }
  })
  assert.ok(selected.total > 0, 'browser-smoke: the plugin tree rendered no rows')
  assert.equal(
    selected.checked,
    selected.total,
    `browser-smoke: select-all left rows unchecked (${JSON.stringify(selected)})`,
  )
  process.stdout.write(`browser-smoke: select-all checked every row ${JSON.stringify(selected)}\n`)
  // Cleared again so the shipped settings are not left carrying a plugin set.
  await page.getByRole('button', { name: '清空' }).first().click()
  await page.waitForTimeout(600)

  // Every tab, in both directions. A tab whose surface calls a seat from inside
  // its branch changes the hook count on the switch and takes the whole section
  // down — measured, it blanks the panel and logs React error #310.
  for (const tab of ['工作区', '分派规则', 'Agent', '工作区']) {
    await page.locator('.dsh-af__tab', { hasText: tab }).first().click()
    await page.waitForTimeout(400)
    assert.equal(
      await page.locator('.dsh-af').count(),
      1,
      `browser-smoke: the settings section disappeared when the ${tab} tab was shown`,
    )
  }
  const workspacesText = await page.locator('.dsh-af').innerText()
  assert.ok(
    workspacesText.includes('选择工作区'),
    'browser-smoke: the workspaces tab rendered nothing',
  )
  process.stdout.write('browser-smoke: every settings tab survives being switched to\n')

  assert.deepEqual(pageErrors, [], 'browser-smoke: the page reported errors')
  process.stdout.write('browser-smoke: the shipped UI works in a real browser\n')
} catch (error) {
  failed = true
  process.stdout.write(`browser-smoke FAILED: ${error.message.split('\n')[0]}\n`)
  try {
    await page.screenshot({ path: resolve(root, '.browser-failure.png'), fullPage: true })
    process.stdout.write('browser-smoke: wrote .browser-failure.png\n')
  } catch { /* the page may already be gone; the message above is the diagnosis */ }
} finally {
  await browser.close()
  child.kill()
}

process.exitCode = failed ? 1 : 0
