# hydraloop-diagram-react

> React flow diagram of a [Hydraloop](https://www.hydraloop.com) H600, and the model that works out what the device is doing from its signals

The diagram shows the inlet and bypass, both treatment trains (T1 and T2 of A and B), UV-C, the T3 storage, the T4 backup and the outlets. Pipes are colored and animated while a routine, valve, pump or sensor signal shows water moving through them. Hover a valve, pump, sensor or tank for its raw value.

The model (`stateAt`) derives that state from tank levels, IO signals, HDM routines and firmware behaviors, as loaded from the internal HDM API with [`hydraloop-internal`](../internal/readme.md). See the [H600 dashboard](../../apps/h600.gr2m.dev/README.md) for how the H600 was found to work.

> [!WARNING]
> The model is derived from the data of one H600 (firmware 9.24), not documented by Hydraloop. Its results may change as the inference improves.

## Install

```
npm install hydraloop-diagram-react
```

React 19 or newer is a peer dependency. The components have no hooks or browser-only code, so they also render as React Server Components.

## Usage

```tsx
import {
  DiagramLegend,
  FlowDiagram,
  FlowSummary,
  stateAt,
  type Dataset,
} from "hydraloop-diagram-react";
import "hydraloop-diagram-react/styles.css";

export function H600({ dataset, t }: { dataset: Dataset; t: number }) {
  const state = stateAt(dataset, t);
  return (
    <figure>
      <FlowDiagram state={state} device={dataset.device} />
      <FlowSummary state={state} />
      <figcaption>
        <DiagramLegend />
      </figcaption>
    </figure>
  );
}
```

### Components

- `<FlowDiagram state device />`: the diagram as an `<svg>` that fills the width of its container. `state` is a `DeviceState` from `stateAt()`, `device` is `dataset.device`, used for the outlets that are connected.
- `<FlowSummary state />`: the flows the diagram animates, as a sentence, e.g. "Water moving: Greywater → train A · T3 → toilets".
- `<DiagramLegend />`: the colors of the pipes.
- `activeFlows(state)`: the flows of `<FlowSummary>` as an array of strings.

Times in the tooltips use the runtime's locale and time zone. As they can differ between server and browser, their `<title>` elements have `suppressHydrationWarning`.

### Model

`hydraloop-diagram-react/model` exports the model without React, e.g. for a server or a CLI. The package root exports it, too.

- `stateAt(dataset, t)`: the `DeviceState` at time `t` (milliseconds since epoch): tank levels and trends, IO values, the phase of each train and how it was determined, T3, T4, the supply of the outlets, and `room`.
- `roomAt(dataset, t)`: how many liters of greywater the H600 can take before they are bypassed to the sewer.
- `routineAt(dataset, side, t)`, `fillingTrain(dataset, t)`, `isScheduledRestart(dataset, interval)`, `ventedLevels(dataset, side)`, `onIntervals(points, from, until)`, `stepAt(points, t)`, `valueAt(points, t)`
- `IO`: the names of the IO signals with known roles. `sideIo(name, side)` adds the `_b` suffix of train B.
- `caption(captions, name)`, `humanize(text)`, `capacityNote(level)`: labels
- Types: `Dataset`, `DeviceState`, `DeviceInfo`, `TankLevel`, `TrainState`, `Room`, …

### Dataset

`Dataset` holds the data of a time range. All times are milliseconds since epoch, and all series are sorted by time:

| Field                              | Content                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `device`                           | Name, type and online state, and which outlets are connected                                                                      |
| `from`, `until`                    | The range                                                                                                                         |
| `tanks`                            | Levels in liters of `t1a`, `t2a`, `t1b`, `t2b` and `t3` (`local.graph.getData()`, converted with `local.graph.getDeviceLevels()`) |
| `tankMax`                          | The scale of each tank in liters                                                                                                  |
| `io`                               | Points per IO name, one per change, including the last one before `from` (`local.graph.getIo()`)                                  |
| `manual`                           | Whether an IO was switched manually, same shape as `io` (optional)                                                                |
| `routines`                         | Routine changes per side, including the last one before `from` (`local.graph.getRoutineData()`)                                   |
| `behaviors`                        | Firmware behaviors that overlap the range (`behavior` of `local.graph.getIo()`)                                                   |
| `outages`                          | Outages, to tell the scheduled restart from a full H600 (`local.connectivity.getOutageSummaries()`, optional)                     |
| `ventedBefore`                     | T2 at the last venting of each train before `from` (optional)                                                                     |
| `captions`                         | IO captions from `local.graph.getGraphConfig()`                                                                                   |
| `demo`, `fetchedAt`, `warnings`, … | Not used by the model                                                                                                             |

The [H600 dashboard](../../apps/h600.gr2m.dev/README.md) builds it in [`lib/hdm.ts`](../../apps/h600.gr2m.dev/lib/hdm.ts) and keeps it up to date from the device socket in [`lib/live.ts`](../../apps/h600.gr2m.dev/lib/live.ts).

## Styles

Import `hydraloop-diagram-react/styles.css` once. All class names, custom properties and keyframes are prefixed with `hl-`, so they don't collide with the page's styles.

The colors are custom properties on `:root` without specificity, so the page can override them, e.g. to use its own theme:

```css
:root {
  --hl-bg: var(--background);
  --hl-fg: var(--foreground);
  --hl-grey: #b26a00; /* greywater */
  --hl-clean: #16893f; /* treated water */
}
```

| Property                                                                     | Used for                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--hl-bg`                                                                    | Background of tanks, valves and pumps, and the gaps where pipes cross. Must match the page's background |
| `--hl-fg`, `--hl-muted`, `--hl-subtle`                                       | Text, outlines and unknown states                                                                       |
| `--hl-border`                                                                | Hatching of tanks without level data                                                                    |
| `--hl-border-strong`                                                         | Tank outlines, and pipes with unknown state                                                             |
| `--hl-focus`                                                                 | Focused valves, pumps and tanks                                                                         |
| `--hl-grey`, `--hl-clean`, `--hl-mains`, `--hl-waste`, `--hl-air`, `--hl-uv` | The kinds of water, air and UV-C                                                                        |
| `--hl-pipe-idle`, `--hl-pipe-open`                                           | Pipes without water moving, closed and open                                                             |
| `--hl-font-family`                                                           | The diagram's text. Inherits the font if unset                                                          |

The dark colors apply with `prefers-color-scheme: dark`, unless `<html data-theme="light">`, and with `<html data-theme="dark">`. Animations stop with `prefers-reduced-motion: reduce`.

## Development

Try the diagram with any state in the playground: https://hydraloop-diagram.gr2m.dev, source in [`apps/hydraloop-diagram.gr2m.dev`](../../apps/hydraloop-diagram.gr2m.dev/README.md).

## License

[ISC](license)
