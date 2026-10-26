import { expect, test } from 'claude-code/testing'

const RESET_5H = '2030-01-01T00:00:00.000Z'
const RESET_7D = '2030-01-03T04:00:00.000Z'
const NOW = Date.parse(RESET_5H) - (3 * 60 + 36) * 60000

const PANE = {
  plugin: 'usage-monitor',
  component: 'Pane',
  requestId: 'usage-monitor',
  props: { title: 'Usage', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('session, 5h and weekly usage split by model and shared between sessions', async ($, on) => {
  let five = 20
  let week = 5
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('clock.now', () => ({ value: NOW }))
  on('command.register', () => ({ value: { command: 'usage-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: five, resetsAt: RESET_5H },
        { kind: 'seven_day', percentUsed: week, resetsAt: RESET_7D },
      ],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  five = 30
  week = 10
  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 3000 },
  })
  store.set('session:other', {
    id: 'other',
    models: {},
    windows: {
      five_hour: { resetsAt: RESET_5H, byModel: { 'claude-sonnet-5-5': 98750 } },
      seven_day: { resetsAt: RESET_7D, byModel: { 'claude-sonnet-5-5': 98750 } },
    },
    updatedAt: NOW,
  })
  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = [
      /^Current Session$/,
      /^Tokens by model$/,
      /^Opus 5.5$/,
      /^56k$/,
      /^100%$/,
      /^17%$/,
      /^5.0% of the 5h limit$/,
      /^25%$/,
      /^2.5% of the weekly limit$/,
      /^All Usage$/,
      /^Share of 5h usage$/,
      /^Share of weekly usage$/,
      /^5h \(3h 36m left\)$/,
      /^Weekly \(2d 7h 36m left\)$/,
    ]
    for (const text of texts) expect(await ui.find({ type: 'Text', text }), String(text)).toBeDefined()
    if (surface === 'desktop') expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})
