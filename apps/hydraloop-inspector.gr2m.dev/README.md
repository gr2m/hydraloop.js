# Hydraloop H600 inspector

https://hydraloop-inspector.gr2m.dev

A web app for exploring the Hydraloop H600 V2.1 in 3D and finding where each troubleshooting problem is located.

- Search problems (`HL0018`, `18`, "overflow"), catalogue components and CAD parts (`HYD0477`, "fuse") from one search field
- Select a problem to highlight the components involved, with labels in the model, causes, checks and suggested actions
- Rotate, pan and zoom (mouse, trackpad or touch), view presets, fit to selection, explode slider, hide covers, X-ray
- Click or tap a part in the model to see what it is and which problems it relates to
- Links are shareable: `#/error/HL0009`, `#/component/X10`, `#/part/...`

## Run

From this folder:

```sh
npm install
npm run dev     # http://localhost:5173
npm run build   # static site in dist/
```

## Deployment

Vercel deploys the app from this folder of [`gr2m/hydraloop`](https://github.com/gr2m/hydraloop): pushes to `main` go to production, other branches to previews. [`vercel.json`](vercel.json) skips the build when nothing in this folder changed since the last deployment.

## Data

- `3d-models/H600 Standard - Collection 25.stp` is converted to `public/models/h600.glb` (meshopt-compressed, about 4 MB) with `npm run convert`. The CAD source files are not in this repository: put the STEP file from Hydraloop in `3d-models/` (ignored by git) to run the conversion again. Part names, HYD part numbers and sub-assemblies from the STEP product tree are kept on each node.
- `error-catalogue/*.json` is imported directly.
- `src/mapping.ts` links catalogue components to CAD geometry. The CAD export is a simplified model: it has the tanks, plumbing, covers, distribution module and ECU housing, but no pumps, UV unit, boards, tubing or valve bodies. Each component therefore has a `fidelity`:
  - **Modeled**: the highlighted geometry is the component (blue)
  - **Inside highlighted assembly** / **Approximate location** / **Outside the unit, connects here**: the highlight shows where to look, not the part itself (amber)
  - **Not in 3D model**: listed, but nothing is highlighted

  The approximate mappings are inferred from the CAD tree and the HYD0949AD installation drawing. Review them before relying on them for service work.
