/**
 * End-to-end check that a real session runs in this mode and carries the rules.
 *
 * Every other suite verifies the injection against a stand-in loop. This one
 * asks the shipped harness: select the multi-agent mode in the picker, send one
 * prompt, and look at the resulting conversation. The injected context is what
 * the conversation shows, and the conversation is rendered from the session log
 * — so seeing it there is the same fact as finding it on disk, without needing
 * to decode a log that is still being written.
 *
 * The model itself is not the subject. The rules are injected at the pre-step,
 * before the call, so a turn that starts proves the point even when the call
 * then fails for want of a credential.
 *
 * Two details this had to get right, each of which cost a round:
 *
 * - the preset picker's entries are `role="menuitem"`; clicking the inner text
 *   wrapper selects nothing, and the session then composes under the deployment
 *   default with no sign that anything went wrong;
 * - the chip reflecting the staged mode is necessary but not sufficient, so the
 *   assertion is on the transcript rather than on the picker.
 *
 * Not part of `check`: it spends a model call and needs the route to be reachable.
 *
 * @module dsh-agent-forge/scripts/session-probe
 */

import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const chrome = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')

const child = spawn(process.execPath, [dshBin, '--profile', 'web', '--no-open', '--port', '0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = await new Promise((accept, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error(`no URL: ${buffer.slice(0, 300)}`)), 30_000)
  const inspect = chunk => {
    buffer += String(chunk)
    const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
    if (match !== null) { clearTimeout(timer); accept(match[0]) }
  }
  child.stdout.on('data', inspect)
  child.stderr.on('data', inspect)
})

const browser = await chromium.launch({ executablePath: chrome, headless: true })
let verdict = 1
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('style[data-plugin-css="dsh-agent-forge/page.css"]', { state: 'attached', timeout: 45_000 })
  await page.waitForTimeout(2000)

  await page.locator('button').filter({ hasText: /模式/ }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole('menuitem', { name: /多智能体模式/ }).click()
  await page.waitForTimeout(800)
  const chip = (await page.locator('button').filter({ hasText: /模式/ }).first().innerText()).trim()
  if (chip !== '多智能体模式') throw new Error(`the mode chip reads ${JSON.stringify(chip)}`)
  process.stdout.write('session-probe: the picker staged the multi-agent mode\n')

  const box = page.getByRole('textbox', { name: /描述你想要构建的内容/ }).first()
  await box.click()
  await box.fill('Reply with just: ok')
  await page.getByRole('button', { name: '发送消息' }).first().click()
  process.stdout.write('session-probe: sent one prompt\n')

  // The transcript is rendered from the session log, so its content is the
  // durable fact. Poll because the injection lands with the first step.
  let transcript = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(1000)
    transcript = await page.locator('body').innerText()
    if (transcript.includes('agent-forge-dispatch-rules')) break
  }

  await page.screenshot({ path: resolve(root, '.session-probe.png'), fullPage: true })

  if (!transcript.includes('agent-forge-dispatch-rules')) {
    process.stdout.write('session-probe: FAILED — the conversation carries no injected dispatch rules\n')
    for (const line of transcript.split('\n').map(line => line.trim()).filter(Boolean).slice(-16)) {
      process.stdout.write(`  | ${line.slice(0, 110)}\n`)
    }
  } else {
    const failure = transcript.split('\n').map(line => line.trim())
      .find(line => line.includes('失败') || line.includes('failed'))
    process.stdout.write('session-probe: the conversation carries the injected dispatch rules\n')
    process.stdout.write(`session-probe: transcript also shows -> ${failure === undefined ? 'no turn failure' : failure.slice(0, 100)}\n`)
    process.stdout.write('session-probe: screenshot -> .session-probe.png\n')
    verdict = 0
  }
} catch (error) {
  process.stdout.write(`session-probe FAILED: ${error.message.split('\n')[0]}\n`)
} finally {
  await browser.close()
  child.kill()
}

process.exitCode = verdict
