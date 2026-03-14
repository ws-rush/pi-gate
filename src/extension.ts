/**
 * pi-gate v1.1 — Project-level execution gates for Pi
 *
 * User-defined rules, not security policy (that's pi-sentinel).
 * Learns from past mistakes to auto-suggest rules.
 *
 * /gate list                — show active rules
 * /gate add <pattern> <act> — add rule (warn|block)
 * /gate rm <id>             — remove rule
 * /gate log                 — recent gate events
 * /gate learn               — suggest rules from recent errors
 */
import type { ExtensionAPI } from '@anthropic-ai/claude-code'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface Rule { id: number; pattern: string; action: 'warn' | 'block'; tool?: string; created: number }
interface GateEvent { rule: Rule; toolName: string; timestamp: number; blocked: boolean }

const RULES_FILE = join(homedir(), '.pi', 'gate-rules.json')
const events: GateEvent[] = []
let nextId = 1

const DEFAULT_RULES: Rule[] = [
  { id: 0, pattern: 'rm -rf /', action: 'block', created: 0 },
  { id: 0, pattern: 'DROP TABLE', action: 'block', created: 0 },
  { id: 0, pattern: 'DROP DATABASE', action: 'block', created: 0 },
  { id: 0, pattern: 'format c:', action: 'block', created: 0 },
  { id: 0, pattern: 'mkfs', action: 'block', created: 0 },
  { id: 0, pattern: ':(){:|:&};:', action: 'block', created: 0 },
  { id: 0, pattern: 'dd if=/dev', action: 'warn', created: 0 },
  { id: 0, pattern: 'chmod -R 777', action: 'warn', created: 0 },
  { id: 0, pattern: 'npm publish', action: 'warn', created: 0 },
  { id: 0, pattern: 'git push --force', action: 'warn', created: 0 },
]

function loadRules(): Rule[] {
  try {
    const r = JSON.parse(readFileSync(RULES_FILE, 'utf-8'))
    nextId = Math.max(...r.map((x: Rule) => x.id), 0) + 1
    return r
  } catch {
    const rules = DEFAULT_RULES.map((r, i) => ({ ...r, id: i + 1, created: Date.now() }))
    nextId = rules.length + 1
    return rules
  }
}

function saveRules(rules: Rule[]) {
  mkdirSync(join(homedir(), '.pi'), { recursive: true })
  writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2))
}

function checkGates(toolName: string, input: any): { action: 'allow' | 'warn' | 'block'; rule?: Rule } {
  const rules = loadRules()
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input || '')

  for (const rule of rules) {
    if (rule.tool && rule.tool !== toolName) continue
    if (inputStr.toLowerCase().includes(rule.pattern.toLowerCase())) {
      events.push({ rule, toolName, timestamp: Date.now(), blocked: rule.action === 'block' })
      if (events.length > 100) events.shift()
      return { action: rule.action, rule }
    }
  }
  return { action: 'allow' }
}

function formatRules(): string {
  const rules = loadRules()
  if (rules.length === 0) return 'No gate rules.'
  const rows = ['| ID | Pattern | Action | Tool |', '|-----|---------|--------|------|']
  for (const r of rules) {
    const icon = r.action === 'block' ? '🚫' : '⚠️'
    rows.push(`| ${r.id} | \`${r.pattern}\` | ${icon} ${r.action} | ${r.tool || 'any'} |`)
  }
  return `## Gate Rules\n\n${rows.join('\n')}`
}

function formatLog(): string {
  if (events.length === 0) return 'No gate events.'
  const rows = events.slice(-15).reverse().map(e => {
    const ago = Math.round((Date.now() - e.timestamp) / 1000)
    const icon = e.blocked ? '🚫' : '⚠️'
    return `${icon} ${ago}s ago — \`${e.toolName}\` matched \`${e.rule.pattern}\` → ${e.blocked ? 'BLOCKED' : 'warned'}`
  })
  return `## Gate Log\n\n${rows.join('\n')}`
}

const errorHistory: { tool: string; input: string; error: string; ts: number }[] = []

function suggestRules(): string {
  if (errorHistory.length === 0) return 'No errors recorded. Use the session and come back.'
  // Find repeated patterns
  const patterns = new Map<string, number>()
  for (const err of errorHistory) {
    const key = `${err.tool}:${err.input.slice(0, 40)}`
    patterns.set(key, (patterns.get(key) || 0) + 1)
  }
  const suggestions = Array.from(patterns.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  if (suggestions.length === 0) return 'No repeated error patterns found yet.'
  const lines = ['## Suggested rules (from errors)', '']
  for (const [pattern, count] of suggestions) {
    const [tool, input] = pattern.split(':')
    lines.push(`- **${count}x** \`${tool}\` with \`${input}\` → \`/gate add "${input}" warn\``)
  }
  return lines.join('\n')
}

export default function init(pi: ExtensionAPI) {
  pi.on('tool_call', (event: any) => {
    const inputStr = typeof event.input === 'string' ? event.input : JSON.stringify(event.input || '')
    const result = checkGates(event.toolName || '', inputStr)
    if (result.action === 'block') {
      return { block: true, reason: `Gate blocked: pattern "${result.rule!.pattern}" matched` }
    }
    if (result.action === 'warn') {
      pi.sendMessage({ content: `⚠️ Gate warning: \`${result.rule!.pattern}\` matched in \`${event.toolName}\``, display: true }, { triggerTurn: false })
    }
  })

  // Learn from errors
  pi.on('tool_execution_end', (event: any) => {
    if (event.isError) {
      const input = JSON.stringify(event.args || '').slice(0, 100)
      const error = typeof event.result === 'string' ? event.result.slice(0, 100) : ''
      errorHistory.push({ tool: event.toolName, input, error, ts: Date.now() })
      if (errorHistory.length > 100) errorHistory.shift()
    }
  })

  pi.addCommand({ name: 'gate', description: 'Manage execution gates',
    handler: async (args) => {
      const parts = args.trim().split(/\s+/)
      const sub = parts[0]?.toLowerCase()
      if (!sub || sub === 'list') { pi.sendMessage({ content: formatRules(), display: true }, { triggerTurn: false }); return }
      if (sub === 'log') { pi.sendMessage({ content: formatLog(), display: true }, { triggerTurn: false }); return }
      if (sub === 'add') {
        const pattern = parts[1]; const action = (parts[2] || 'warn') as 'warn' | 'block'
        if (!pattern) { pi.sendMessage({ content: '/gate add <pattern> [warn|block]', display: true }, { triggerTurn: false }); return }
        const rules = loadRules(); rules.push({ id: nextId++, pattern, action, created: Date.now() }); saveRules(rules)
        pi.sendMessage({ content: `Added gate: \`${pattern}\` → ${action}`, display: true }, { triggerTurn: false }); return
      }
      if (sub === 'rm') {
        const id = parseInt(parts[1], 10); const rules = loadRules(); const idx = rules.findIndex(r => r.id === id)
        if (idx < 0) { pi.sendMessage({ content: 'Not found.', display: true }, { triggerTurn: false }); return }
        rules.splice(idx, 1); saveRules(rules)
        pi.sendMessage({ content: `Removed gate #${id}.`, display: true }, { triggerTurn: false }); return
      }
      if (sub === 'learn') {
        pi.sendMessage({ content: suggestRules(), display: true }, { triggerTurn: false }); return
      }
      pi.sendMessage({ content: '/gate list|add|rm|log|learn', display: true }, { triggerTurn: false })
    }
  })

  pi.addTool({ name: 'gate_list', description: 'List active execution gate rules.',
    parameters: { type: 'object', properties: {} }, handler: async () => formatRules()
  })
}
