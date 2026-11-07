import { describe, expect, it } from 'vitest'
import { abortable } from './abortable'
describe('interrupting local extraction', () => {
  it('releases a pending worker task immediately when stopped', async () => {
    const controller = new AbortController()
    const task = abortable(new Promise<string>(() => {}), controller.signal)
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects an already-stopped operation and consumes a late worker error', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(abortable(Promise.reject(new Error('worker stopped')), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('preserves worker results and failures', async () => {
    const signal = new AbortController().signal
    await expect(abortable(Promise.resolve('recognized'), signal)).resolves.toBe('recognized')
    await expect(abortable(Promise.reject(new Error('unreadable scan')), signal)).rejects.toThrow('unreadable scan')
  })
})
