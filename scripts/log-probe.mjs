/**
 * Decodes recent session logs and reports what the delegated runs actually did.
 *
 * The point is to settle, from the log rather than from the model's own account,
 * three questions about a failing dispatch: which composition the child ran
 * under, which tools its request declared, and what the assistant actually
 * emitted before the turn ended.
 *
 * Usage: `node scripts/log-probe.mjs [count]`
 *
 * @module dsh-agent-forge/scripts/log-probe
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const sessionsRoot = join(homedir(), '.dsh', 'sessions')
const limit = Number(process.argv[2] ?? 14)

/** Every session directory under the workspace bucket, newest first. */
function recentSessions() {
  const found = []
  for (const bucket of readdirSync(sessionsRoot)) {
    const bucketDir = join(sessionsRoot, bucket)
    for (const id of readdirSync(bucketDir)) {
      const file = join(bucketDir, id, 'session.v3.jsonl.zstd')
      try {
        found.push({ id, file, mtime: statSync(file).mtimeMs })
      } catch {
        // A session directory without a log yet: nothing to decode.
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

/**
 * Decodes one log, frame by frame.
 *
 * The file is a series of independently framed zstd blobs, and a stream stops at
 * the first frame's end — a 6.7 KB log decoded to 274 characters that way, which
 * reads as "this session did nothing". Splitting on the frame magic and decoding
 * each frame recovers the whole log.
 * @param file - absolute log path.
 * @returns every decoded line.
 */
function decode(file) {
  const buffer = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  for (let at = buffer.indexOf(magic); at !== -1; at = buffer.indexOf(magic, at + 4)) starts.push(at)
  const parts = []
  for (const [index, start] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(start, end)))
    } catch {
      // A frame this build cannot read is skipped rather than failing the probe.
    }
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)
}

/** Pulls the fields this probe reports out of one decoded event. */
function inspect(line) {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

for (const session of recentSessions()) {
  const lines = await decode(session.file)
  const events = lines.map(inspect).filter(event => event !== undefined)
  const kinds = new Map()
  for (const event of events) kinds.set(event.type, (kinds.get(event.type) ?? 0) + 1)

  const descriptor = events.find(event => event.type === 'subagent/descriptor')
  const preset = events.find(event => event.type === 'agent-preset/selected')
  const header = events.find(event => event.type === 'request/header')
  const ends = events.filter(event => event.type === 'turn/end')
  const lastEnd = ends.at(-1)

  // The model's own words, including any tool call it wrote as text.
  const texts = []
  for (const event of events) {
    const blocks = event.data?.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    }
  }
  const joined = texts.join('\n')
  const rawCall = /<tool_call>|<function=/.test(joined)
  const toolNames = [...joined.matchAll(/<function=([A-Za-z_][\w]*)/g)].map(match => match[1])

  console.log('─'.repeat(78))
  console.log(`${session.id}  ${new Date(session.mtime).toLocaleString()}  ${events.length} events`)
  console.log(`  child:      ${descriptor === undefined ? 'no' : 'yes (subagent/descriptor present)'}`)
  console.log(`  preset:     ${preset?.data?.agentPreset ?? '(none recorded)'}`)
  console.log(`  model:      ${header === undefined ? '(no header)' : `${String(header.data?.header?.config?.provider)} / ${String(header.data?.header?.config?.model)}`}`)
  console.log(`  turn end:   ${lastEnd === undefined ? '(none)' : JSON.stringify(lastEnd.data?.reason)}`)
  console.log(`  raw block:  ${rawCall ? `YES ${JSON.stringify([...new Set(toolNames)])}` : 'no'}`)
  if (joined.length > 0) console.log(`  text:       ${JSON.stringify(joined.slice(0, 160))}`)
}
