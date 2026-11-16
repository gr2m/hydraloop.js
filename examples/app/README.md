# H600 dashboard

A Next.js app that shows the live and historic status of a Hydraloop H600, using the internal HDM API through [`hydraloop/internal`](../../readme.internal.md).

> [!WARNING]
> Hydraloop does not intend the internal API for external use. It may change at any time without notice. See [`spec/README.md`](../../spec/README.md#stability). The app only reads data and never changes settings on the device.

## Views

**Live** (`/`) refreshes every 10 seconds and shows:

- A flow diagram of both treatment trains (T1 and T2 for A and B), UV-C, T3 storage, T4 backup and the outlets. Tanks show their fill level in liters. Pipes are colored and animated only while a valve or pump signal shows water moving through them. Hover any valve, pump or tank for its raw value.
- The state of each train (the HDM routine and its sub-state), of storage and of the outlets, and when each train last received water and transferred to T3. Each state says how it was determined: **HDM routine**, **Valve signal**, or **Inferred**.
- Key events of the last hour, and all raw signals.

**History** (`/history`) shows 6 hours to 7 days:

- Synchronized tracks of the tank levels, the HDM routines, and the valves and pumps.
- Move the pointer over the timeline to see the flow diagram at that moment. Click to pin it, use the arrow keys to step.
- Transfers to T3 with their duration and level changes, filth removal runs, and all events.

## Phases and signals

The phase of each train is the routine HDM reports for its side (`getRoutineData()`), e.g. `STANDBY`, `INCOMING_WATER`, `SKIM_LEVEL_DETERMINATION`, `FILTH_REMOVAL` or `TRANSFER`, with its sub-state (e.g. `PASSIVE_CIRCULATE`). Valve signals are shown next to it as evidence. Without a routine, the phase falls back to the transfer and waste valves.

The roles of the IO signals were derived by correlating them with each other and with the routines of an H600 (firmware 9.24.4):

| Signal                                   | Role                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `transfer_path`, `transfer_path_b`       | Transfer valve of train A/B, open during `TRANSFER`                                              |
| `waste_clean_tank`, `waste_clean_tank_b` | Waste valve of T1 A/B                                                                            |
| `grey_water_bypass`                      | Sends incoming greywater to the sewer while on (`flipped` in the graph config)                   |
| `grey_water_ab_selection_valve`          | Switched twice a day together with `back_flush`, not with incoming water. Shown, not interpreted |
| `circulation_pump`                       | A valve (caption `circulation_valve`). With the distribution pump, circulates T3 through UV      |
| `distribution_pump`                      | Supplies the outlets, and drives the T3 circulation                                              |
| `backup_water`                           | Outlets are supplied from T4. Stays on for hours at a time                                       |
| `waste_storage_tank`                     | Drains T3                                                                                        |
| `toilet`, `wash`                         | Demand sensors of the outlets                                                                    |
| `tank4`, `tank4_enough_water`            | Max and min float sensors of T4. T4 has no level reading                                         |

Both trains enter `INCOMING_WATER` at the same time, so the diagram shows the inlet to every train in that routine.

`getIo()` returns only a few days of valve data, regardless of the requested range. The history view marks the time without data.

## Run

From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in with your HDM account (username, password, and the one-time code if your account uses two-factor authentication). The token is stored in an httpOnly cookie and never reaches browser JavaScript.

To skip the login form, set `HYDRALOOP_TOKEN` to a token from a previous login, e.g. in `.env.local`.

**Explore with simulated data** on the login page shows the app with a simulation of the H600 cycle. Its timings are illustrative, not measured.

## Structure

| Path                                                                                   | Purpose                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`lib/hdm.ts`](lib/hdm.ts)                                                             | Loads and normalizes data with the SDK (server only) |
| [`lib/model.ts`](lib/model.ts)                                                         | State at a point in time, phases, events, transfers  |
| [`lib/demo.ts`](lib/demo.ts)                                                           | Simulated data                                       |
| [`app/api/live`](app/api/live/route.ts), [`app/api/history`](app/api/history/route.ts) | JSON for the live and history views                  |
| [`components/flow-diagram.tsx`](components/flow-diagram.tsx)                           | The flow diagram                                     |
| [`components/timeline.tsx`](components/timeline.tsx)                                   | The history tracks                                   |

The SDK is linked from the repository root (`"hydraloop": "file:../.."`).

## Background

The SDK methods used:

- `root.devices.listDevices()`, `root.devices.getDeviceShallow()`: device and online state
- `local.graph.getDeviceLevels()`: calibration tables to convert tank pressure to liters
- `local.graph.getGraphConfig()`: captions of the valves and pumps
- `local.graph.getData()`: tank levels (`tank1`, `tank2`, `tank1_b`, `tank2_b`, `tank3`)
- `local.graph.getIo()`, `local.graph.getLastKnownIoState()`: valves and pumps
- `local.graph.getRoutineData()`: HDM routines per side
