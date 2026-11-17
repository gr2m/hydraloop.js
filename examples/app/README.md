# H600 dashboard

A Next.js app that shows the live and historic status of a Hydraloop H600, using the internal HDM API through [`hydraloop/internal`](../../readme.internal.md).

> [!WARNING]
> Hydraloop does not intend the internal API for external use. It may change at any time without notice. See [`spec/README.md`](../../spec/README.md#stability). The app only reads data and never changes settings on the device.

## Views

**Live** (`/`) refreshes every 10 seconds and shows:

- A flow diagram of both treatment trains (T1 and T2 for A and B), UV-C, T3 storage, T4 backup and the outlets. Tanks show their fill level in liters. Pipes are colored and animated only while a valve or pump signal shows water moving through them. Hover any valve, pump or tank for its raw value.
- The state of each train (the HDM routine and its sub-state), of storage and of the outlets, and when each train last received water and transferred to T3. Each state says how it was determined: **HDM routine**, **Valve signal**, or **Inferred**.
- Key events of the last hour (routines, firmware behaviors and key valves), and all raw signals.

**History** (`/history`) shows 6 hours to 7 days:

- Synchronized tracks of the tank levels, the HDM routines, and the valves and pumps.
- Move the pointer over the timeline to see the flow diagram at that moment. Click to pin it, use the arrow keys to step.
- Transfers to T3 with their duration and the change of T3, filth removal runs, and all events.

## Phases and signals

The phase of each train is the routine HDM reports for its side (`getRoutineData()`), e.g. `STANDBY`, `INCOMING_WATER`, `SKIM_LEVEL_DETERMINATION`, `FILTH_REMOVAL` or `TRANSFER`, with its sub-state (e.g. `PASSIVE_CIRCULATE`). Valve signals are shown next to it as evidence. Without a routine, the phase falls back to the transfer and waste valves.

The roles of the IO signals were derived by correlating them with each other and with the routines of an H600 (firmware 9.24.4):

| Signal                                   | Role                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfer_path`, `transfer_path_b`       | Transfer valve of train A/B, open during `TRANSFER`                                                                                           |
| `waste_clean_tank`, `waste_clean_tank_b` | Waste valve of T1 A/B                                                                                                                         |
| `grey_water_bypass`                      | Sends incoming greywater to the sewer while on (`flipped` in the graph config)                                                                |
| `grey_water_ab_selection_valve`          | Selects the train that receives greywater (0: A, 1: B). Switched when a train starts `FILTH_REMOVAL`, and for a minute during the bypass test |
| `circulation_pump`                       | A valve (caption `circulation_valve`). With the distribution pump, circulates T3 through UV                                                   |
| `distribution_pump`                      | Supplies the outlets, and drives the T3 circulation                                                                                           |
| `backup_water`                           | Outlets are supplied from T4. Stays on for hours at a time                                                                                    |
| `waste_storage_tank`                     | Drains T3                                                                                                                                     |
| `toilet`, `wash`                         | Demand sensors of the outlets                                                                                                                 |
| `tank4`, `tank4_enough_water`            | Max and min float sensors of T4. T4 has no level reading                                                                                      |

Both trains enter `INCOMING_WATER` at the same time, so the diagram shows the inlet to every train in that routine.

### Room for greywater

The live and history views estimate how much more greywater the H600 can take before it's bypassed to the sewer. In 30 days of an H600's data, the bypass never opened because the tanks were full. It opened when neither train accepted water, plus for a scheduled 1-minute test every 12 hours, while a train was emptied to the drain, and when switched on in the app:

- Greywater only enters the train selected by the A/B valve, and only in `STANDBY` (or `INCOMING_WATER`).
- A train starts `FILTH_REMOVAL` when it is full (see [Next filth removal](#next-filth-removal)), and takes no water for the ~4.5 h it lasts.

So the estimate is the sum over the trains that accept water of `290 L − T1 − T2` for train A and `280 L − T1 − T2` for train B ([`TRAIN_FULL_LITERS`](lib/model.ts)). T1 + T2 is taken from the last time T2 was vented (about once an hour), as its reading is too high while pressurized. A train in `FILTH_REMOVAL` or with its waste valve open counts as 0, and so does the whole H600 while the bypass is open. The history chart shades the times the bypass was open, to compare. The live view loads the last 8 hours, so that it includes a venting of both trains. If only one train has a venting, the estimate is shown as a lower bound (`≥ X L`) from that train alone.

### Next filth removal

The live view also shows how much more greywater the receiving train takes before it starts `FILTH_REMOVAL`, e.g. to time a shower in the evening so that T3 has water in the morning. In 30 days of an H600's data:

- Only one train receives greywater, the one selected by the A/B valve (`grey_water_ab_selection_valve`). When it starts `FILTH_REMOVAL`, the valve switches to the other train.
- After each `INCOMING_WATER`, `SKIM_LEVEL_DETERMINATION` vents T2 and checks the train. Normally it returns to `STANDBY` within a minute. Once T2 holds about 134 L, it continues with `FIND_HIGHEST_WATER_POINT` and starts `FILTH_REMOVAL` about 5 minutes later. With up to 132 L it never did, with 135 L or more it always did.
- In T1 + T2, which counts all water in the train, that's about 290 L for train A and 280 L for train B. For train A, 290 L separated every filling that started filth removal from every one that didn't. For train B, single fillings started filth removal from 270 L, or didn't up to 282 L. The app shows the estimate with ±15 L.
- `FILTH_REMOVAL` takes about 4.5 h, then `TRANSFER` moves about 80–120 L from T2 into T3 in about 1.3 h. So T3 gets the water about 6 h after the shower. T2 drops by about as much as T3 rises, so the calibration tables of T2 and T3 agree.

The estimate is `TRAIN_FULL_LITERS − T1 − T2` of the receiving train, with T1 + T2 from its last venting. It counts the water the train takes, measured by its own sensors, not the water that left the shower. None of this is documented by Hydraloop.

### Behaviors

Besides the valve values, `getIo()` returns firmware _behaviors_ with an `engaged` and a `disengaged` event, e.g. `fullT1T2WasteSoapBombA` while train A is emptied to the drain because of too much soap, `fullT3WasteCleaning`, `t4OverflowBackflush` or `bypassByAppBypassValve`. A trailing `A` or `B` names the train. The app shows them as events, in a timeline lane per train, and in the status of the train while engaged.

### Filth removal

A normal `FILTH_REMOVAL` run lasts about 4.5 hours, mostly in `REMOVE_FILTH_ON_HEIGHT`. The air pump runs the whole time, and T1 stays at the top of its range, so filth and foam spill over the skim overflow of T1 into the drain. The overflow has no valve signal, so the diagram shows it as inferred from the routine. The waste valve (`waste_clean_tank`) stayed closed in 16 of 17 runs over 30 days. In the other one, the routine ended after 5 minutes and the waste valve emptied T1 to the drain.

### T2 readings while pressurized

T2 is a closed tank. The air pump pressurizes it to push water up into T1, and `release_air` vents it, which lets the water fall back into T2. The level sensors measure pressure, so while T2 holds air pressure, its reading is higher than the water in it. That's why T1 drops by tens of liters when the air is released, while T2 barely rises.

The app treats T2 as pressurized while `release_air` is closed and `air_pump` or `add_air_valve` ran since it closed (about 90% of the time). It then shows T2 as "≤ … L · Pressurized", and the timeline has a lane for it. Transfer volumes use the change of T3, not of T1+T2. This is derived from an H600's data and not documented by Hydraloop.

`getIo()` returns only a few days of valve data, regardless of the requested range. The history view marks the time without data.

## Run

From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and sign in with your HDM account (username, password, and the one-time code if your account uses two-factor authentication). The token is stored in an httpOnly cookie and never reaches browser JavaScript.

HDM tokens expire after 30 minutes. [`proxy.ts`](proxy.ts) exchanges the token for a new one (`root.auth.refreshToken()`, no new one-time code needed) on any request within 10 minutes of its expiry, and open pages ping the server every 4 minutes. So you stay signed in as long as a page of the app is open, also in a background tab. After all pages were closed for more than 30 minutes, you need to sign in again.

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
