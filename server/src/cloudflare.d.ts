// The few Workers runtime types this server touches, declared here so the project needs no
// @cloudflare/workers-types dependency. Imported with `import type` only.

export type D1Result<T = unknown> = { results: T[]; success: boolean; meta: { changes: number } }

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run<T = unknown>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  /** Atomic: a failing statement rolls back the whole batch. */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

/** The zone's cache (`caches.default`): GET requests only, keyed by URL, honouring Cache-Control. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

export interface ScheduledController {
  readonly scheduledTime: number
  readonly cron: string
}
