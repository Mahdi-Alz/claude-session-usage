import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit, TurnUsage } from 'claude-code'

import type { ModelTokens, SessionRecord, WindowKind, WindowReading, WindowUse } from '../types'

const PANE = 'usage-monitor'
const KINDS: WindowKind[] = ['five_hour', 'seven_day']
const UNTRACKED = '#8b8d98'
const SESSION = '#56b4e9'
const EMPTY = '#8b8d9833'
const STALE_MS = 8 * 24 * 60 * 60 * 1000

const models = atom({ plugin: 'usage-monitor', key: 'models' } as const, {})
const readings = atom({ plugin: 'usage-monitor', key: 'readings' } as const, {})
const windows = atom({ plugin: 'usage-monitor', key: 'windows' } as const, {})
const others = atom({ plugin: 'usage-monitor', key: 'others' } as const, [])

const family = (model: string) =>
  model.includes('opus') ? 'opus' : model.includes('sonnet') ? 'sonnet' : model.includes('haiku') ? 'haiku' : model.includes('fable') ? 'fable' : 'other'

const FAMILY_COLORS: Record<string, string> = {
  opus: '#c8344f',
  sonnet: '#9d7bd8',
  haiku: '#3fb37f',
  fable: '#f28e2b',
  other: '#9c755f',
}

const lighten = (hex: string, amount: number) => {
  const channels = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16))

  return `#${channels.map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('')}`
}
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'other']

const total = (t: ModelTokens) => t.input + t.output + t.cacheRead + t.cacheWrite

const priceFactor = (model: string) =>
  family(model) === 'opus' ? 5 : family(model) === 'haiku' ? 1 : 3

const weightOf = (model: string, t: ModelTokens) =>
  priceFactor(model) * (t.input + 5 * t.output + 1.25 * t.cacheWrite + 0.1 * t.cacheRead)

const shortModel = (model: string) => {
  const parts = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '').split('-')
  const name = parts.find(part => /^[a-z]+$/i.test(part)) ?? parts[0] ?? model
  const version = parts.filter(part => /^\d+$/.test(part)).join('.')
  const label = name.charAt(0).toUpperCase() + name.slice(1)

  return version ? `${label} ${version}` : label
}

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`

const pct = (n: number) => `${n >= 10 || n === 0 ? Math.round(n) : n.toFixed(1)}%`

const normalize = (iso: string) => {
  const step = 10 * 60 * 1000

  return new Date(Math.round(Date.parse(iso) / step) * step).toISOString()
}

const remaining = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const days = Math.floor(mins / 1440)
  const time = `${Math.floor((mins % 1440) / 60)}h ${mins % 60}m`

  return days > 0 ? `${days}d ${time}` : time
}

const toTokens = (u: TurnUsage): ModelTokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

const versionOf = (name: string) => Number.parseFloat(name.split(' ')[1] ?? '0') || 0

const compareModels = (a: string, b: string) =>
  FAMILIES.indexOf(family(a.toLowerCase())) - FAMILIES.indexOf(family(b.toLowerCase())) || versionOf(b) - versionOf(a)

const byModel = (entries: [string, number][]) => {
  const out: Record<string, number> = {}
  for (const [model, n] of entries) out[shortModel(model)] = (out[shortModel(model)] ?? 0) + n

  return Object.entries(out)
    .filter(([, n]) => n > 0)
    .sort((a, b) => compareModels(a[0], b[0]))
}

const svgBar = (segments: { color: string; pct: number }[]) => {
  let x = 0
  const rects = segments
    .filter(s => s.pct > 0)
    .map(s => {
      const w = Math.max(0, Math.min(100 - x, s.pct))
      const drawn = w > 0.8 ? w - 0.4 : w
      const rect = `<rect x="${x.toFixed(3)}" y="0" width="${drawn.toFixed(3)}" height="1" fill="${s.color}"/>`
      x += w

      return rect
    })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="8" viewBox="0 0 100 1" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100" height="1" fill="${UNTRACKED}" fill-opacity="0.2"/>${rects.join('')}</svg>`
}

async function recordWindows($: EngineInterface, limits: SessionRateLimit[]) {
  const next: Partial<Record<WindowKind, WindowReading>> = {}
  for (const kind of KINDS) {
    const limit = limits.find(l => l.kind === kind)
    if (!limit?.resetsAt) continue
    const resetsAt = normalize(limit.resetsAt)
    const key = `window:${kind}:${resetsAt}`
    let start = (await $.store.get(key)) as number | undefined
    if (start === undefined) {
      start = limit.percentUsed
      await $.store.set(key, start)
    }
    next[kind] = { percent: limit.percentUsed, resetsAt, start }
    await $.store.set(`last:${kind}`, next[kind])
  }
  if (Object.keys(next).length > 0) await update($, readings, was => ({ ...was, ...next }))
}

async function loadLastReadings($: EngineInterface) {
  const now = await $.clock.now()
  const next: Partial<Record<WindowKind, WindowReading>> = {}
  for (const kind of KINDS) {
    const last = (await $.store.get(`last:${kind}`)) as WindowReading | undefined
    if (!last?.resetsAt) continue
    next[kind] = Date.parse(last.resetsAt) > now ? last : { ...last, percent: 0, start: 0 }
  }
  if (Object.keys(next).length > 0)
    await update($, readings, was => {
      const out = { ...was }
      for (const kind of KINDS) {
        const fresh = next[kind]
        if (fresh && (!was[kind] || was[kind].resetsAt !== fresh.resetsAt)) out[kind] = fresh
      }

      return out
    })
}

async function loadOthers($: EngineInterface) {
  const id = await $.session.id()
  const now = await $.clock.now()
  const keys = (await $.store.keys()).filter(k => k.startsWith('session:') && k !== `session:${id}`)
  const list: SessionRecord[] = []
  for (const key of keys) {
    const record = (await $.store.get(key)) as SessionRecord | undefined
    if (!record?.windows) await $.store.delete(key)
    else if (now - record.updatedAt > STALE_MS) await $.store.delete(key)
    else list.push(record)
  }
  await update($, others, () => list)
  await loadLastReadings($)
}

async function saveSession($: EngineInterface) {
  const id = await $.session.id()
  const record: SessionRecord = {
    id,
    models: await read($, models),
    windows: await read($, windows),
    updatedAt: await $.clock.now(),
  }
  await $.store.set(`session:${id}`, record)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-monitor', description: 'Show the usage monitor' })
    if ((await $.session.surfaces()).length > 0) void $.ui.open({ id: PANE, title: 'Usage' })
    await loadLastReadings($)
    await recordWindows($, (await $.session.usage()).rateLimits)
    await loadOthers($)
    $.clock.every(30000, () => void loadOthers($))

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    const done = await next(e)
    void $.ui.open({ id: PANE, title: 'Usage' })

    return done
  })

  on('command.run', { command: 'usage-monitor' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage' })

    return { text: 'Usage monitor opened.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await recordWindows($, e.rateLimits)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const usage = e.usage
    if (!usage) return done

    const tokens = toTokens(usage)
    await update($, models, all => {
      const was = all[usage.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

      return {
        ...all,
        [usage.model]: {
          input: was.input + tokens.input,
          output: was.output + tokens.output,
          cacheRead: was.cacheRead + tokens.cacheRead,
          cacheWrite: was.cacheWrite + tokens.cacheWrite,
        },
      }
    })
    await recordWindows($, (await $.session.usage()).rateLimits)
    const now = await read($, readings)
    const weight = weightOf(usage.model, tokens)
    await update($, windows, all => {
      const out: Partial<Record<WindowKind, WindowUse>> = { ...all }
      for (const kind of KINDS) {
        const reading = now[kind]
        if (!reading) continue
        const was = all[kind]
        const byModel = was && was.resetsAt === reading.resetsAt ? was.byModel : {}
        out[kind] = {
          resetsAt: reading.resetsAt,
          byModel: { ...byModel, [usage.model]: (byModel[usage.model] ?? 0) + weight },
        }
      }

      return out
    })
    await saveSession($)
    await loadOthers($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, models)
    const now = await read($, readings)
    const mine = await read($, windows)
    const past = await read($, others)
    const clock = await $.clock.now()

    const elements = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined

    const Bar = (props: { segments: { color: string; pct: number }[] }) =>
      Svg
        ? <Svg source={svgBar(props.segments)} alt="usage bar" height={8} />
        : (
            <Box flexDirection="row" width="100%" height={1} overflow="hidden" backgroundColor={EMPTY}>
              {props.segments.filter(s => s.pct > 0).map(s => (
                <Box width={`${Math.min(100, Math.max(1, Math.round(s.pct)))}%`} flexShrink={0} backgroundColor={s.color}>
                  <Text> </Text>
                </Box>
              ))}
            </Box>
          )

    const Header = (props: { title: string; value?: string }) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{props.title}</Text>
        {props.value !== undefined && <Text dimColor>{props.value}</Text>}
      </Box>
    )

    const Row = (props: { color: string; label: string; value: string; share: string }) => (
      <Box flexDirection="row">
        <Box flexGrow={1} overflow="hidden">
          <Text wrap="truncate">
            <Text color={props.color}>■ </Text>
            <Text dimColor>{props.label}</Text>
          </Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text dimColor>{props.value}</Text>
        </Box>
        <Box width={6} justifyContent="flex-end">
          <Text dimColor>{props.share}</Text>
        </Box>
      </Box>
    )

    const Section = (props: { title: string; value?: string; tint: string; children: RenderChildren }) => (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Header title={props.title} value={props.value} />
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={props.tint} paddingX={1} paddingY={1} gap={1}>
          {props.children}
        </Box>
      </Box>
    )

    const Legend = (props: { items: (readonly [string, string])[] }) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {props.items.map(([color, label]) => (
          <Text>
            <Text color={color}>■ </Text>
            <Text dimColor>{label}</Text>
          </Text>
        ))}
      </Box>
    )

    const entries = Object.entries(all)
    const windowEntries = [mine, ...past.map(r => r.windows)].flatMap(w => KINDS.flatMap(k => Object.entries(w[k]?.byModel ?? {})))
    const windowNames = new Set(windowEntries.filter(([, n]) => n > 0).map(([m]) => shortModel(m)))
    const names = [...new Set([...entries.map(([m]) => shortModel(m)), ...windowNames])].sort(compareModels)
    const colorFor = (name: string) => {
      const fam = family(name.toLowerCase())
      const rank = names.filter(n => family(n.toLowerCase()) === fam).indexOf(name)

      return lighten(FAMILY_COLORS[fam] ?? UNTRACKED, Math.min(0.6, Math.max(0, rank) * 0.3))
    }

    const window = (kind: WindowKind) => {
      const reading = now[kind]
      if (!reading) return null
      const used = reading.percent
      const sessions = [mine, ...past.map(s => s.windows)]
        .map(w => w[kind])
        .filter((w): w is WindowUse => w?.resetsAt === reading.resetsAt)
      const allWeight = sum(sessions.map(w => sum(Object.values(w.byModel))))
      const myWeight = mine[kind]?.resetsAt === reading.resetsAt ? sum(Object.values(mine[kind]?.byModel ?? {})) : 0
      const tracked = Math.max(0, used - reading.start)
      const perModel = byModel(sessions.flatMap(w => Object.entries(w.byModel)))
      const modelPct = perModel.map(([name, w]) => [name, allWeight > 0 ? (tracked * w) / allWeight : 0] as const)
      const untracked = Math.max(0, used - sum(modelPct.map(([, p]) => p)))
      const segments = [
        ...modelPct.map(([name, p]) => ({ color: colorFor(name), pct: p })),
        { color: UNTRACKED, pct: untracked },
      ]
      const sessionPct = allWeight > 0 ? (tracked * myWeight) / allWeight : 0
      const ofUsed = used > 0 ? (sessionPct / used) * 100 : 0

      return { used, resetsAt: reading.resetsAt, segments, sessionPct, ofUsed }
    }

    const five = window('five_hour')
    const week = window('seven_day')

    const sessionTotal = sum(entries.map(([, t]) => total(t)))
    const sessionModels = byModel(entries.map(([m, t]) => [m, total(t)]))

    type WindowData = NonNullable<ReturnType<typeof window>>

    const ShareRow = (props: { label: string; limit: string; data: WindowData }) => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>Share of {props.label} usage</Text>
          <Text>{pct(props.data.ofUsed)}</Text>
        </Box>
        <Bar segments={[{ color: SESSION, pct: props.data.ofUsed }]} />
        <Text dimColor>{pct(props.data.sessionPct)} of the {props.limit} limit</Text>
      </Box>
    )

    const WindowRow = (props: { label: string; data: WindowData }) => (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text>{props.label}</Text>
            <Text dimColor> ({remaining(props.data.resetsAt, clock)} left)</Text>
          </Text>
          <Text>{pct(props.data.used)}</Text>
        </Box>
        <Bar segments={props.data.segments} />
      </Box>
    )


    return (
      <Box flexDirection="column" gap={1}>
        <Section title="Current Session" tint={UNTRACKED}>
          <Box flexDirection="column">
            <Text>Tokens by model</Text>
            <Bar
              segments={sessionTotal > 0
                ? sessionModels.map(([name, n]) => ({ color: colorFor(name), pct: (n / sessionTotal) * 100 }))
                : []}
            />
            {sessionModels.length === 0 && <Text dimColor>No model calls yet</Text>}
            {sessionModels.map(([name, n]) => (
              <Row color={colorFor(name)} label={name} value={fmt(n)} share={pct((n / sessionTotal) * 100)} />
            ))}
          </Box>
          {five && <ShareRow label="5h" limit="5h" data={five} />}
          {week && <ShareRow label="weekly" limit="weekly" data={week} />}
        </Section>

        <Section title="All Usage" tint={UNTRACKED}>
          {five && <WindowRow label="5h" data={five} />}
          {week && <WindowRow label="Weekly" data={week} />}
          {!five && !week && <Text dimColor>Limits show after the first reply</Text>}
          {(five || week) && (
            <Legend
              items={[
                ...names.filter(name => windowNames.has(name)).map(name => [colorFor(name), name] as const),
                [UNTRACKED, 'Untracked'] as const,
              ]}
            />
          )}
        </Section>
      </Box>
    )
  })
}
