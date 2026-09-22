/**
 * Runs one real delegation and reports what the child session actually did.
 *
 * Every other suite stops at the parent: the tool is called against a stand-in
 * registry, or the settings page is driven in a browser. This one boots the real
 * harness, selects the multi-agent mode, asks for one delegation to a named
 * agent, and then decodes the child's own session log — which is the only place
 * that says whether the agent's composition mounted, which model it ran, and
 * whether its tools were actually invoked.
 *
 * It spends a model call and needs the route to be reachable, so it is not part
 * of `check`.
 *
 * Usage: `node scripts/dispatch-probe.mjs [agentId]`
 *
 * @module dsh-agent-forge/scripts/dispatch-probe
 */

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agent = process.argv[2] ?? 'patchwork'
const dshBin = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const chrome = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')
const sessionsRoot = join(homedir(), '.dsh', 'sessions')
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Every session log on disk, as `id -> path`. */
function sessionPaths() {
  const found = new Map()
  for (const bucket of readdirSync(sessionsRoot)) {
    for (const id of readdirSync(join(sessionsRoot, bucket))) {
      const file = join(sessionsRoot, bucket, id, 'session.v3.jsonl.zstd')
      try {
        statSync(file)
        found.set(id, file)
      } catch {
        // A session directory with no log yet is not a candidate.
      }
    }
  }
  return found
}

/**
 * Decodes one log frame by frame.
 *
 * The file is a series of zstd frames and a stream stops at the first one, which
 * reads a live session as an empty one.
 * @param file - absolute log path.
 * @returns the decoded events.
 */
function decode(file) {
  const buffer = readFileSync(file)
  const starts = []
  for (let at = buffer.indexOf(magic); at !== -1; at = buffer.indexOf(magic, at + 4)) starts.push(at)
  const parts = []
  for (const [index, start] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(start, end)))
    } catch {
      // Skip a frame this build cannot read rather than losing the whole log.
    }
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}

const before = sessionPaths()
const child = spawn(process.execPath, [dshBin, '--profile', 'web', '--no-open', '--port', '0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let harnessErrors = ''
child.stderr.on('data', chunk => { harnessErrors += String(chunk) })
child.stdout.on('data', chunk => { harnessErrors += String(chunk) })

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
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('style[data-plugin-css="dsh-agent-forge/page.css"]', { state: 'attached', timeout: 45_000 })
  await page.waitForTimeout(2000)
  await page.locator('button').filter({ hasText: /模式/ }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole('menuitem', { name: /多智能体模式/ }).click()
  await page.waitForTimeout(800)

  const box = page.getByRole('textbox', { name: /描述你想要构建的内容/ }).first()
  await box.click()
  await box.fill(`调用 forge_dispatch 工具，把「列出当前目录下的文件」这个任务派给 agent ${agent}，然后把它的结果原样告诉我。`)
  await page.getByRole('button', { name: '发送消息' }).first().click()
  process.stdout.write(`dispatch-probe: asked for one delegation to "${agent}"\n`)

  // A child session appears on disk only once the provider has created it.
  let newest
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await page.waitForTimeout(1000)
    for (const [id, file] of sessionPaths()) {
      if (before.has(id)) continue
      const events = decode(file)
      if (events.some(event => event.type === 'subagent/descriptor')) { newest = { id, file, events }; break }
    }
    if (newest !== undefined) break
  }

  if (newest === undefined) {
    const transcript = await page.locator('body').innerText()
    process.stdout.write('dispatch-probe: NO CHILD SESSION was created\n')
    process.stdout.write(`dispatch-probe: transcript tail -> ${transcript.split('\n').map(l => l.trim()).filter(Boolean).slice(-8).join(' | ').slice(0, 400)}\n`)
  } else {
    const events = newest.events
    const kinds = {}
    for (const event of events) kinds[event.type] = (kinds[event.type] ?? 0) + 1
    const header = events.find(event => event.type === 'request/header')
    const preset = events.find(event => event.type === 'agent-preset/selected')?.data?.agentPreset ?? '(none)'
    const end = events.filter(event => event.type === 'turn/end').at(-1)
    const raw = events.some(event => {
      const content = event.data?.message?.content
      return Array.isArray(content) && content.some(block => block?.type === 'text' && /<function=|<\/tool_call>/.test(block.text))
    })
    process.stdout.write(`dispatch-probe: child ${newest.id}  ${events.length} events\n`)
    process.stdout.write(`  preset:     ${preset}\n`)
    process.stdout.write(`  model:      ${header === undefined ? '(no header)' : `${String(header.data?.header?.config?.provider)} / ${String(header.data?.header?.config?.model)}`}\n`)
    process.stdout.write(`  turn end:   ${end === undefined ? '(none)' : JSON.stringify(end.data?.reason)}\n`)
    process.stdout.write(`  tool calls: ${String(kinds['tool/call'] ?? 0)}  results: ${String(kinds['tool/result'] ?? 0)}\n`)
    process.stdout.write(`  raw block:  ${String(raw)}\n`)
    process.stdout.write(`  events:     ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}×${String(v)}`).join(' ')}\n`)
  }
} catch (error) {
  process.stdout.write(`dispatch-probe FAILED: ${error.message.split('\n')[0]}\n`)
} finally {
  await browser.close()
  child.kill()
}

// The mount failure this looks for is reported by the Loader on stderr, not in
// any session, so it is printed whether or not a child was created.
const mountFailure = harnessErrors.split('\n').filter(line => /failed to apply loader entry|already registered|enableLogs/.test(line))
process.stdout.write(`dispatch-probe: loader errors -> ${mountFailure.length === 0 ? 'none' : mountFailure.slice(0, 4).map(l => l.trim().slice(0, 160)).join(' || ')}\n`)
process.exitCode = 0
