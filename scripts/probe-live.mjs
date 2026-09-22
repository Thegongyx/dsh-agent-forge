/**
 * Reports what the pickers look like in a *running* deployment.
 *
 * Unlike `browser-smoke`, which boots its own harness on a random port, this
 * points at an instance the user already has open. It only reads: it opens the
 * settings page, records the options each control offers, and closes.
 *
 * Usage: `node scripts/probe-live.mjs [url]` (default http://127.0.0.1:3080).
 *
 * @module dsh-agent-forge/scripts/probe-live
 */

import { join } from 'node:path'
import { chromium } from 'playwright-core'

const url = process.argv[2] ?? 'http://127.0.0.1:3080'
const chrome = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe')

const browser = await chromium.launch({ executablePath: chrome, headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('style[data-plugin-css="dsh-agent-forge/page.css"]', { state: 'attached', timeout: 45_000 })
  await page.getByRole('button', { name: '设置' }).first().click()
  await page.getByText('多智能体', { exact: true }).first().click({ timeout: 15_000 })
  await page.waitForSelector('.dsh-af', { timeout: 15_000 })

  const report = await page.evaluate(async () => {
    const optionsOf = selector => {
      const element = document.querySelector(selector)
      return element === null ? null : [...element.options].map(option => option.textContent)
    }
    let catalog
    try {
      const response = await fetch('/dsh-agent-forge/catalog')
      catalog = response.ok ? `ok ${response.status}` : `http ${response.status}`
    } catch (error) {
      catalog = `failed: ${String(error)}`
    }
    return {
      catalog,
      provider: optionsOf('select#dsh-af-provider'),
      model: optionsOf('select#dsh-af-model'),
      effort: optionsOf('select#dsh-af-effort'),
      toolMode: optionsOf('select#dsh-af-toolmode'),
      toolCheckboxes: document.querySelectorAll('.dsh-af__checks--tall input[type=checkbox]').length,
      freeTextInputs: [...document.querySelectorAll('.dsh-af input[type=text]')].map(input => input.id),
    }
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch (error) {
  process.stdout.write(`probe failed: ${String(error)}\n`)
} finally {
  process.stdout.write(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}\n`)
  await browser.close()
}
