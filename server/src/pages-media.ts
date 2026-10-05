// Native Desktop captures are optional, first-party and fixed by the reviewed build table.
import { DESKTOP_CAPTURES, MEDIA_FILES } from '../static/media.gen.ts'
import type { DesktopCapture } from '../static/media.gen.ts'
import { png } from './http.ts'
import { html } from './pages-html.ts'
import type { Raw } from './pages-html.ts'

export function captureResponse(file: string, files: Readonly<Record<string, Uint8Array>> = MEDIA_FILES): Response | null {
  if (!Object.hasOwn(files, file)) return null
  return png(files[file]!, 'public, max-age=31536000, immutable')
}

export function desktopGallery(captures: readonly DesktopCapture[] = DESKTOP_CAPTURES): Raw {
  if (!captures.length) return html``
  return html`<details class="desktop-shots"><summary>In Claude Desktop</summary>
<div class="desktop-shot-grid">${captures.map(c => html`<figure>
<a href="/media/${c.file}"><img src="/media/${c.file}" alt="${c.alt}" width="${c.width}" height="${c.height}" loading="lazy" decoding="async"></a>
<figcaption>${c.caption}</figcaption></figure>`)}</div></details>`
}
