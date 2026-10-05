# Arena artwork

Four original backgrounds created with the built-in image-generation tool: a sunlit ancient forest (Haiku), moonlit lake ruins (Sonnet), a volcanic canyon (Opus), and floating garden islands (Fable). The prompt set requested a short panoramic pixel-art environment, foreground battle stages, quiet space for health displays, and no characters, UI, words or logos.

The game uses these 480 × 90 indexed PNGs. Their encoded palettes have 112 colors for Haiku and 128 for the other families. Source paintings and the crop/encoding provenance are retained privately; the files here are the exact compact artwork used by the mod. They are backgrounds, not screenshots of Claude.

- [Haiku](haiku.png)
- [Sonnet](sonnet.png)
- [Opus](opus.png)
- [Fable](fable.png)

Run `node scripts/arena-art.ts` to regenerate the data module from these files. The mod embeds PNG data inside an SVG image, so it needs no image download, filesystem access or runtime dependency. Native buttons handle actions outside the image. Narrow stages blend local camera views; creature pixels, combat timelines and outcomes remain independent of the scenery.

Artwork is distributed under the repository's MIT license.
