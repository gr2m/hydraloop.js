# Diagram playground

https://hydraloop-diagram.gr2m.dev

A playground for [`hydraloop-diagram-react`](../../packages/hydraloop-diagram-react/readme.md). It sets the signals, tank levels, routines and connected outlets of an H600 at one moment, and renders the diagram for the state that `stateAt()` derives from them. Presets load states of the simulated H600 of the [H600 dashboard](../h600.gr2m.dev/README.md), like a transfer to T3 or filth removal. The URL holds its settings, so they survive reloads and a link opens the same diagram: `?preset=transfer` for an unchanged preset, or each setting as a query parameter once edited (see [`src/url.ts`](src/url.ts)).

## Run

From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:5173.

The app uses `hydraloop-diagram-react` from its source in [`packages/hydraloop-diagram-react/src`](../../packages/hydraloop-diagram-react/src), through aliases in [`vite.config.ts`](vite.config.ts) and [`tsconfig.json`](tsconfig.json). Changes to the component show up right away, without building the package.

## Readme image

```bash
npm run readme-svg
```

renders the "Receiving greywater" preset to [`packages/hydraloop-diagram-react/assets/receiving-greywater.svg`](../../packages/hydraloop-diagram-react/assets/receiving-greywater.svg), the image in the package's readme. The SVG includes the package's styles, so it shows the same colors and animations as an image, light or dark.

## Deployment

Vercel deploys this folder to https://hydraloop-diagram.gr2m.dev (project `hydraloop-diagram`, root directory `apps/hydraloop-diagram.gr2m.dev`), with a preview for each pull request.
