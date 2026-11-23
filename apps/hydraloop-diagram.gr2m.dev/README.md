# Diagram playground

https://hydraloop-diagram.gr2m.dev

A playground for [`hydraloop-diagram-react`](../../packages/diagram-react/readme.md). It sets the signals, tank levels, routines and connected outlets of an H600 at one moment, and renders the diagram for the state that `stateAt()` derives from them. Presets load states of the simulated H600 of the [H600 dashboard](../h600.gr2m.dev/README.md), like a transfer to T3 or filth removal. It keeps its settings across reloads.

## Run

From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:5173.

The app uses `hydraloop-diagram-react` from its source in [`packages/diagram-react/src`](../../packages/diagram-react/src), through aliases in [`vite.config.ts`](vite.config.ts) and [`tsconfig.json`](tsconfig.json). Changes to the component show up right away, without building the package.

## Deployment

Vercel deploys this folder to https://hydraloop-diagram.gr2m.dev (project `hydraloop-diagram`, root directory `apps/hydraloop-diagram.gr2m.dev`), with a preview for each pull request.
