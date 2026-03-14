/**
 * pi-gate — Conditional execution gates for Pi
 * Block or warn on dangerous tool calls. Configurable rules.
 *
 * /gate list — show active rules
 * /gate add <pattern> <action> — add rule (warn|block)
 * /gate rm <id> — remove rule
 * /gate log — recent gate events
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

export default function init(pi: ExtensionAPI) {
  pi.on('pre_tool', (event: any) => {
    const result = checkGates(event.name || '', event.input || event.params || '')
    if (result.action === 'block') {
      event.blocked = true
      event.blockReason = `Gate blocked: pattern "${result.rule!.pattern}" matched`
    }
    return event
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
      pi.sendMessage({ content: '/gate list|add|rm|log', display: true }, { triggerTurn: false })
    }
  })

  pi.addTool({ name: 'gate_list', description: 'List active execution gate rules.',
    parameters: { type: 'object', properties: {} }, handler: async () => formatRules()
  })
}
