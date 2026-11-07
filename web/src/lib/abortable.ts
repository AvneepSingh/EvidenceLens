// Terminating a worker may not settle its pending recognition promise.
// Race it explicitly so Stop always releases the UI immediately.
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason ?? new DOMException('Stopped', 'AbortError'))
    if (signal.aborted) { task.catch(() => {}); stop(); return }
    signal.addEventListener('abort', stop, { once: true })
    task.then(value => { signal.removeEventListener('abort', stop); resolve(value) },
      error => { signal.removeEventListener('abort', stop); reject(error) })
  })
}
