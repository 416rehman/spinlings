// A single place to choose the default online world, the local save, or a community origin.
import type { View } from '../client/types.ts'
import { DEFAULT_SERVER } from '../core/servers.ts'
import { hostOf } from '../client/net.ts'
import { withTop } from '../client/viewmodels.ts'
import type { Ctx, Shown } from './pane-kit.tsx'
import { actions, btn, column, heading, line, para } from './pane-kit.tsx'

export function worldScreen(c: Ctx, v: Extract<View, { kind: 'world' }>): Shown {
  const a = c.state.account
  const choice = { world: a.world, server: a.server }
  const busy = a.link === 'joining' || a.link === 'starting' || !!c.state.pane.busy
  const pending = v.origin && c.state.moments.some(m => m.kind === 'server' && m.origin === v.origin) ? v.origin : null
  if (pending) {
    return {
      body: column(c, [
        heading(c, 'Community world'),
        line(c, hostOf(pending), { bold: true }),
        para(c, 'Run by someone else. It receives the same anonymous game data as spinlings.dev, and never anything about your work.', { dim: true }),
        para(c, 'Its collection is separate. Your other worlds stay saved.', { dim: true }),
        actions(c, [
          busy ? null : btn(c, { key: 'world-connect', label: 'Connect', hotkey: '1', primary: true, on: () => c.actions.connect(pending, { ...choice, origin: pending }) }),
          btn(c, { key: 'world-cancel', label: 'Cancel', hotkey: 'x', on: async () => {
            await c.actions.dismiss(`server:${pending}`)
            await c.actions.pane(p => withTop(p, top => top.kind === 'world' && top.origin === pending ? { kind: 'world', address: pending } : top))
          } }),
        ]),
      ]),
      hints: ['1 Connect', 'x Cancel', 'esc Back'], bare: true,
    }
  }
  const { Input } = c.el
  const here = a.world === 'offline' ? 'Offline on this computer' : hostOf(a.server)
  return {
    body: column(c, [
      heading(c, 'Choose a world'),
      line(c, `Playing: ${here}`, { dim: true }),
      para(c, 'Each world keeps its own collection. Switching never moves or deletes your cards.', { dim: true }),
      a.world === 'online' && a.server === DEFAULT_SERVER && a.link === 'ready' ? line(c, '🌐 Spinlings online · here now', { bold: true })
        : busy ? line(c, '🌐 Spinlings online', { dim: true }) : actions(c, [btn(c, { key: 'world-online', label: '🌐 Spinlings online', hotkey: '1', primary: true, on: () => c.actions.world('online', choice) })]),
      para(c, 'spinlings.dev · your online collection and community.', { dim: true }),
      a.world === 'offline' && a.link === 'ready' ? line(c, '💾 Offline · here now', { bold: true })
        : busy ? line(c, '💾 Offline', { dim: true }) : actions(c, [btn(c, { key: 'world-offline', label: '💾 Offline', hotkey: '2', on: () => c.actions.world('offline', choice) })]),
      para(c, 'Saved on this computer · works without a connection.', { dim: true }),
      heading(c, 'Community server'),
      para(c, 'Have a server address? Review it before connecting.', { dim: true }),
      busy ? line(c, 'Connecting…', { dim: true }) : <Input key="world-address" label="Address" placeholder="https://…" value={v.address ?? ''} submitLabel="Review" onSubmit={address => { void c.actions.world(address, choice) }} />,
    ]),
    hints: ['1 Spinlings online', '2 Offline', 'esc Back'], bare: true,
  }
}
