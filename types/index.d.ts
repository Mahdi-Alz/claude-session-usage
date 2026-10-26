export type ModelTokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type WindowKind = 'five_hour' | 'seven_day'
export type WindowReading = { percent: number; resetsAt: string; start: number }
export type WindowUse = { resetsAt: string; byModel: Record<string, number> }
export type SessionRecord = {
  id: string
  models: Record<string, ModelTokens>
  windows: Partial<Record<WindowKind, WindowUse>>
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-monitor': {
      models: Record<string, ModelTokens>
      readings: Partial<Record<WindowKind, WindowReading>>
      windows: Partial<Record<WindowKind, WindowUse>>
      others: SessionRecord[]
    }
  }
}
