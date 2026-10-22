// Shared pixel art for the market string and the Mythic catalogue. One definition per page.
export const LANTERN_SYMBOL = `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><symbol id="lantern" viewBox="0 0 7 11" width="7" height="11"><path style="fill:#3b2a22" d="M3 0h1v1h-1zM2 1h3v1h-3zM1 2h5v1h-5zM1 8h5v1h-5zM3 9h1v1h-1z"/><path style="fill:var(--lg)" d="M0 3h1v5h-1zM3 3h1v5h-1zM6 3h1v5h-1z"/><path style="fill:var(--lb)" d="M1 3h2v5h-2zM4 3h2v5h-2z"/><path style="fill:var(--lt)" d="M3 10h1v1h-1z"/></symbol></svg>`

/** Decorative; the adjacent card or history names the discovery. */
export function mythicLantern(lit = true): string {
  return `<span class="mythic-lamp${lit ? '' : ' unlit'}" aria-hidden="true"><svg viewBox="-3 -2 13 16" shape-rendering="crispEdges" focusable="false">${lit ? '<path class="lglow" d="M1 -1h5v2h2v9h-2v3h-5v-3h-2v-9h2z"/>' : ''}<use href="#lantern"/></svg></span>`
}
