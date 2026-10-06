# Arena artwork

Four original backgrounds created with the built-in image-generation tool: a sunlit ancient forest (Haiku), moonlit lake ruins (Sonnet), a volcanic canyon (Opus), and floating garden islands (Fable). Actual game sprites and the approved Moonlit Water study supplied the style reference. The prompt set requested chunky connected pixel clusters, dark colored outlines, two or three shades per material, a short panorama, two foreground battle stages, quiet space for health displays, and no characters, UI, words or logos.

The game uses these 480 × 90 indexed PNGs with at most 32 colors each. Their 160 × 30 logical grid is stored with exact 3× nearest-neighbor expansion, so every 3 × 3 block is one palette index. Full source images and crop/encoding provenance are retained privately; the files here are the exact compact artwork used by the mod. They are backgrounds, not screenshots of Claude.

- [Haiku](haiku.png)
- [Sonnet](sonnet.png)
- [Opus](opus.png)
- [Fable](fable.png)

Run `node scripts/arena-art.ts` to regenerate the data module from these files. The mod embeds PNG data inside an SVG image, so it needs no image download, filesystem access or runtime dependency. Native buttons handle actions outside the image. Narrow stages blend local camera views; creature pixels, combat timelines and outcomes remain independent of the scenery.

Artwork is distributed under the repository's MIT license.

Lighter distant colors, overlapping shapes and larger near-edge clusters establish depth. Contact shadows and sparse foreground scenery ground the creatures. Transparent world-edge masks blend the landscape into the host background while creature pixels, labels and native controls stay sharp. The artwork renders without a painterly blur or grading filter.
