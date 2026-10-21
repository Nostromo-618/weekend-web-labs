# Weekend Web Labs

Browser demos for this flock: widgets, on-device chat, and Hex Earth.

Live: https://nostromo-618.github.io/weekend-web-labs/

Clone the siblings beside this repo and build them before Labs:

```text
parent/
  weekend-web-labs/
  wwl-cbun/            Vue widgets (code editor, draw, hex grid, music player)
  wwl-ai-chat/         headless on-device chat and guardrails
  wwl-hex-earth/       hex-grid Earth
```

```bash
pnpm install
pnpm dev
```

http://localhost:3000/

```bash
pnpm format:check && pnpm lint && pnpm test:unit && pnpm build
```

The home-page liquid atmosphere is a WebGL reimplementation of Cameron Knight’s [Interactive Liquid Gradient](https://codepen.io/cameronknight/pen/ogxWmBP).

MIT — see [LICENSE](./LICENSE).
