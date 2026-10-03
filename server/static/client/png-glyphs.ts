// Stands in for server/src/png.ts inside site.js: the pixel font's glyphs arrive precomputed from the
// build (__GLYPHS__: 9 base-32 rows per character, ASCII 32-126 then '·' and '…'), so the browser
// never carries the PNG code.
declare const __GLYPHS__: string

const index = (ch: string) => {
  const c = ch.codePointAt(0) ?? 63
  return c >= 32 && c < 127 ? c - 32 : ch === '·' ? 95 : ch === '…' ? 96 : 31
}

/** Just enough of png.ts's canvas for pages-font.ts to read one glyph at a time. */
export function createCanvas(w: number, h: number) {
  const data = new Uint8Array(w * h * 4)
  return {
    data,
    drawText(x: number, y: number, ch: string) {
      const at = index(ch) * 9
      for (let r = 0; r < 9; r++) {
        const m = parseInt(__GLYPHS__[at + r]!, 32)
        for (let c = 0; c < 5; c++) if (m & (1 << (4 - c))) data[((y + r) * w + x + c) * 4 + 3] = 255
      }
    },
  }
}
