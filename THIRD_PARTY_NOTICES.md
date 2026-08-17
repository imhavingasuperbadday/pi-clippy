# Third-party notices

## dsh-clippy

`src/response.ts`, `src/fallback.ts`, `src/context.ts`, and `src/generator.ts`
are ports of [dsh-clippy](https://github.com/xlr8harder/dsh-clippy)
(`xlr8harder/dsh-clippy`), MIT licensed. The port replaces the Dsh host APIs
(`@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`)
with pi extension APIs (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`)
and keeps the prompt, validation, fallback, and evidence-bounding logic intact.

## Clippy character

The Clippy character (Clippit) is a Microsoft trademark and character artwork.
Microsoft retains the character artwork, animations, sounds, names, and brand.

This package does not copy Microsoft artwork into its own files: the external
Clippy window loads the sprite atlas at runtime from the
[`clippyjs`](https://github.com/pithings/clippy) npm dependency (MIT), the same
source the original dsh-clippy project builds its animation on (descended from
[`clippy.js`](https://github.com/clippyjs/clippy.js), the original browser port
of the Clippit agent). The ASCII fallback frames are an original monospace
approximation.

See the original project's `docs/art-provenance.md` for the full artwork
provenance.
