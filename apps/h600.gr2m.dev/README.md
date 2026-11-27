# H600 dashboard

https://h600.gr2m.dev

A Next.js app that shows the live and historic status of a Hydraloop H600, using the internal HDM API through [`hydraloop-internal`](../../packages/hydraloop-internal/readme.md).

> [!WARNING]
> Hydraloop does not intend the internal API for external use. It may change at any time without notice. See [`spec/README.md`](../../spec/README.md#stability). The app only reads data and never changes settings on the device.

## Views

**Overview** (`/`) answers the main questions at a glance and links to the details. It updates live (see [Live updates](#live-updates)):

- **Until the next cleaning**: how much more greywater the receiving train takes before it starts filth removal (see [Next filth removal](#next-filth-removal)).
- **Until greywater goes to the drain**: the room for greywater in both trains (see [Room for greywater](#room-for-greywater)).
- **Recycled water ready**: T3 above the ~28 L it reads when empty ([`T3_EMPTY_LITERS`](lib/model.ts)).
- **Being cleaned**: about 100 L per train in `FILTH_REMOVAL` or `TRANSFER`, and when it will be in T3 (see [Water being cleaned](#water-being-cleaned)).

And for the last 30 days (see [30-day statistics](#30-day-statistics)):

- **Recycled**: liters moved into T3, as reported by HDM.
- **Greywater lost, both trains busy**: how long the bypass sent greywater to the drain because neither train accepted water, with every bypass episode and its cause.
- **Fresh water instead of recycled**: an estimate of the backup water the outlets used.

**Live** (`/live`) updates live and shows:

- A flow diagram of both treatment trains (T1 and T2 for A and B), UV-C, T3 storage, T4 backup and the outlets. Tank areas are to scale with their capacities: T1 holds about 24 L, T2 about 200 L and T3 about 280 L. T2 and T3 show their fill level in liters, T1 only in percent (see [Tank levels and capacities](#tank-levels-and-capacities)). Pipes are colored and animated only while a valve or pump signal shows water moving through them, and drawn with more contrast while their valves are open without water moving. The pipes from the distribution pump to the outlets are always pressurized, so they are always drawn open. On/off valves are parallel to their pipe while open and across it while closed. The bypass and A/B valves are triangles pointing to their inlet, filled where the water flows through them to the open outlet. Pump impellers spin while the pump runs. Hover any valve, pump or tank for its raw value.
- The state of each train (the HDM routine and its sub-state), of storage and of the outlets, and when each train last received water and transferred to T3. Each state says how it was determined: **HDM routine**, **Valve signal**, or **Inferred**.
- All raw signals.

**History** (`/history`) shows 6 hours to 7 days:

- Synchronized tracks of the levels of T2 and T3, the HDM routines, and the valves and pumps. `getIo()` returns only a few days of valve data, regardless of the requested range. The history view marks the time without data.
- Move the pointer over the timeline to see the flow diagram at that moment. Click to pin it, use the arrow keys to step.
- Transfers to T3 with their duration and the change of T3, filth removal runs, and all events.
- Valves and pumps that were switched manually, e.g. by a technician or a maintenance procedure in the HDM web app, are hatched, with an event when they were switched manually and back to automatic (see [Manual overrides](#manual-overrides)).

**Maintenance** (`/maintenance`) shows the health of the H600 and its service history (see [Maintenance](#maintenance)):

- **Health**: the issues HDM lists for the device, the alerts of the last 30 days, the next maintenance and the warranty. Outputs that are switched manually or stuck powered are listed, too.
- **Alerts**: the problems the firmware diagnosed itself over the last 12 months, e.g. a leaking toilet or a soap bomb, with HDM's description, and when they were reported fixed.
- **Connectivity**: the outages of the last 30 days on a chart, by where the cause was (HDM server, network, power, device, scheduled restart), with the restarts and their reasons.
- **Device vitals**: UV-C lamp temperature, supply and battery voltage, and the current of the device and the distribution pump, over the last 30 days.
- **Service**: commissioning, warranty, firmware, the linked professionals, the tickets with their cause and solution, and the service log.

## Phases and signals

The phase of each train is the routine HDM reports for its side (`getRoutineData()`), e.g. `STANDBY`, `INCOMING_WATER`, `SKIM_LEVEL_DETERMINATION`, `FILTH_REMOVAL` or `TRANSFER`, with its sub-state (e.g. `PASSIVE_CIRCULATE`). Valve signals are shown next to it as evidence. Without a routine, the phase falls back to the transfer and waste valves.

The roles of the IO signals were derived by correlating them with each other and with the routines of an H600 (firmware 9.24.4):

| Signal                                   | Role                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfer_path`, `transfer_path_b`       | Transfer valve of train A/B, open during `TRANSFER`                                                                                                 |
| `waste_clean_tank`, `waste_clean_tank_b` | Waste valve of T1 A/B                                                                                                                               |
| `grey_water_bypass`                      | Sends incoming greywater to the sewer while on (`flipped` in the graph config)                                                                      |
| `grey_water_ab_selection_valve`          | Selects the train that receives greywater (0: A, 1: B). Switched when a train starts `FILTH_REMOVAL`, and for a minute during the scheduled restart |
| `circulation_pump`                       | A valve (caption `circulation_valve`). With the distribution pump, circulates T3 through UV                                                         |
| `distribution_pump`                      | Supplies the outlets, and drives the T3 circulation                                                                                                 |
| `backup_water`                           | Outlets are supplied from T4. Stays on for hours at a time                                                                                          |
| `waste_storage_tank`                     | Drains T3                                                                                                                                           |
| `toilet`, `wash`                         | Demand sensors of the outlets                                                                                                                       |
| `tank4`, `tank4_enough_water`            | Max and min float sensors of T4. T4 has no level reading                                                                                            |

Both trains enter `INCOMING_WATER` at the same time, so the diagram shows the inlet to every train in that routine.

### Room for greywater

The live and history views estimate how much more greywater the H600 can take before it's bypassed to the sewer. In 30 days of an H600's data, the bypass never opened because the tanks were full. It opened when neither train accepted water, plus for about a minute during the controller's scheduled restart every 12 hours, while a train was emptied to the drain, and when switched on in the app:

- Greywater only enters the train selected by the A/B valve, and only in `STANDBY` (or `INCOMING_WATER`).
- A train starts `FILTH_REMOVAL` when it is full (see [Next filth removal](#next-filth-removal)), and takes no water for the ~4.5 h it lasts.

So the estimate is the sum over the trains that accept water of `134 L − T2` ([`TRAIN_FULL_LITERS`](../../packages/hydraloop-diagram-react/src/model.ts)). T2 is taken from the last time it was vented for at least 30 s, as the H600 checks it vented, too. Besides each `INCOMING_WATER`, `STANDBY` vents T2 for 30–80 s in its `PRESSURE_RESET`, about every 2 hours and right after each `TRANSFER`. These short vents measured T2 within 1–2 L of the long ones. Without them, a venting at the start of a transfer was used until the next incoming water, and a train that had just moved about 100 L into T3 showed as nearly full. A train in `FILTH_REMOVAL` or with its waste valve open counts as 0, and so does the whole H600 while the bypass is open. The bypass valve falls open while the controller restarts, which it does every 12 hours. `local.connectivity.getOutageSummaries()` lists these as `scheduled_restart`, together with `battery_power_on` going to 0. Both trains accept water again right after, so openings that overlap a scheduled restart don't count ([`isScheduledRestart`](../../packages/hydraloop-diagram-react/src/model.ts)). If the outages can't be loaded, openings shorter than 2 minutes are taken for the restart. The history chart shades the times the bypass was open, to compare, and the restarts lighter. The diagram labels the bypass "Bypass (user override)" while it is switched on in the app (`bypassByAppBypassValve`). The live view loads the last 8 hours, so that it includes a venting of both trains. If only one train has a venting, the estimate is shown as a lower bound (`≥ X L`) from that train alone.

### Next filth removal

The live view also shows how much more greywater the receiving train takes before it starts `FILTH_REMOVAL`, e.g. to time a shower in the evening so that T3 has water in the morning. In 30 days of an H600's data:

- Only one train receives greywater, the one selected by the A/B valve (`grey_water_ab_selection_valve`). When it starts `FILTH_REMOVAL`, the valve switches to the other train.
- After each `INCOMING_WATER`, `SKIM_LEVEL_DETERMINATION` vents T2 and checks the train. Normally it returns to `STANDBY` within a minute. Once T2 holds about 134 L, it continues with `FIND_HIGHEST_WATER_POINT` and starts `FILTH_REMOVAL` about 5 minutes later. With up to 132 L it never did, with 135 L or more it always did. Another week of data confirmed it, with one exception: train B once started filth removal at 104 L.
- Some of the greywater stays in T1, which held 15–19 L at those checks (see [Tank levels and capacities](#tank-levels-and-capacities)). The app shows the estimate with ±10 L.
- `FILTH_REMOVAL` takes about 4.5 h, then `TRANSFER` moves about 80–120 L from T2 into T3 in about 1.3 h. So T3 gets the water about 6 h after the shower. T2 drops by about as much as T3 rises, so the calibration tables of T2 and T3 agree.

The estimate is `TRAIN_FULL_LITERS − T2` of the receiving train, with T2 from its last venting. It counts the water the train takes, measured by its own sensors, not the water that left the shower. None of this is documented by Hydraloop.

### Water being cleaned

In 30 days of an H600's data, every `FILTH_REMOVAL` that ran to its end took about 4.5 h. Then `TRANSFER` moved 85–120 L (about 100 L) into T3 in about 1.4 h. So the overview expects about 100 L in T3 about 6 h after filth removal starts. During `TRANSFER`, it subtracts what T3 gained since the transfer started. A train in `SKIM_LEVEL_DETERMINATION` / `FIND_HIGHEST_WATER_POINT` counts as starting filth removal now.

The H600 also reports the time left of filth removal itself: `cleaningTimeLeftA` and `cleaningTimeLeftB` of `local.settings.getTankTreatmentState()`, in milliseconds, with the time it was reported. The HDM web app shows them as the time left while a train is cleaned. The H600 reports them when the routine of the train changes, e.g. 0 when it returns to `STANDBY` after `SKIM_LEVEL_DETERMINATION`. If a train is in filth removal and the time left was reported since its routine started, the overview uses it instead of the 4.5 h estimate and says so. The value it reports during a run has not been observed yet.

### 30-day statistics

[`/api/stats`](app/api/stats/route.ts) loads the last 30 days and computes the figures on the server ([`lib/stats.ts`](lib/stats.ts)). The result is cached for 10 minutes.

- **Recycled** is the sum of `local.graph.getWaterRecycledData({ unit: "day" })`, in the browser's time zone. HDM reports about 100 L on each day with a transfer, so it matches the transfers into T3. `unit` only accepts `day` or `month`.
- **Bypass**: `getIo()` returns about 5 days before `until`, whatever `from` is, so the valves are loaded in windows of 5 days. Bypass openings during a scheduled restart are skipped. Each episode gets a cause: switched on in the app (`bypassByAppBypassValve`), a train emptied to the drain (waste valve or a `fullT1T2Waste…` behavior), both trains busy (neither in `STANDBY`, `INCOMING_WATER` or `TRANSFER`), or other. The H600 can't measure the water that goes through the bypass, so only the time is shown.
- **Fresh water**: while `backup_water` is on, the distribution pump supplies the outlets from T4, which is filled with fresh water. On recycled water, T3 dropped by about 0.06 L per second of pumping to the outlets ([`PUMP_LITERS_PER_SECOND`](lib/stats.ts)). The estimate is the pump time on backup water times that rate. Circulation and the `distribution…` check behaviors don't count. In 30 days of an H600's data, the outlets ran on backup water 65% of the time, and used about 3,150 L. HDM reported 1,269 L recycled in the same 30 days.

### Behaviors

Besides the valve values, `getIo()` returns firmware _behaviors_ with an `engaged` and a `disengaged` event, e.g. `fullT1T2WasteSoapBombA` while train A is emptied to the drain because of too much soap, `fullT3WasteCleaning`, `t4OverflowBackflush` or `bypassByAppBypassValve`. A trailing `A` or `B` names the train. The app shows them as events, in a timeline lane per train, and in the status of the train while engaged. `pressingOptButton` is engaged for about 12 hours at a time, nearly always, and disengages for about 25 seconds during each scheduled restart. It isn't documented, so the app shows it under Other, with the battery, buzzer and auxiliary signals.

### Manual overrides

Besides the value of each valve and pump, `getIo()` returns `manual`: 1 while it is switched manually instead of by the firmware, `getLastKnownIoState()` the current `manual` and `stuckPower`. In the data of an H600, outputs were switched manually during a technician's maintenance procedures (e.g. "Fill T3 with backup water"), which the service log lists at the same time. The history marks these times, so they aren't taken for the firmware's behavior, and the diagram's hover text and the signal table say so.

### Maintenance

[`/maintenance`](app/maintenance/page.tsx) loads its data on the server ([`loadMaintenance()`](lib/hdm.ts), [`lib/maintenance.ts`](lib/maintenance.ts)):

- `root.devices.getDevice()`: commissioning date, warranty, maintenance period and dates, firmware, time zone, and `deviceStatus` with the issues HDM lists for the device (blocking, major, minor, attention required, notice).
- `local.graph.getStatusLogData()` over 12 months: besides the steps of maintenance procedures, it has the device signals the firmware diagnosed, as `deviceSignals.<signal>.description` when reported and `deviceSignals.<signal>.fixed` when fixed, with an `errorId` and the train in `side`. Over a short range, it is often empty. Reports less than a day apart are merged. Many signals are never reported fixed, e.g. `soapBomb`, so a signal only counts as active while `deviceStatus` lists it.
- `root.ticket.listTickets()` and `root.devices.getServiceLogEntries()`. The service log returns the 20 entries before `from`, so it is loaded page by page.
- `root.devices.listLinkedProfessionals()`: e.g. the installer.
- `local.connectivity.getOutageSummaries()` over 30 days, with a classification for each outage, e.g. `scheduled_restart`, `server_restart`, `server_response_timeout` or `wifi_access_point_unavailable`.
- `local.graph.getData()` over 30 days, the most it allows (22 minutes per point): the vitals, and `restart` with `restartReasonChip` and `restartReasonSoftware` for each restart. The values are scaled like the HDM web app does: `power_voltage` × 0.1 V (less than 19 V is a power loss), `battery_voltage` × 0.01 V, `device_amperage` and `dist_pump_amperage` × 0.001 A. `wifi_rssi` is always 0 for an H600 on Ethernet, so it isn't shown.

The titles and descriptions of device signals, outage causes, restart reasons, and ticket causes and solutions are keys. [`lib/hdm-texts.ts`](lib/hdm-texts.ts) looks them up in the English texts of the HDM web app (`https://hdm.hydraloop.com/hdm/assets/i18n/en.json`), cached for a day. Without them, the keys are shown as words.

### Filth removal

A normal `FILTH_REMOVAL` run lasts about 4.5 hours, mostly in `REMOVE_FILTH_ON_HEIGHT`. The air pump runs the whole time, and T1 stays at the top of its range, so filth and foam spill over the skim overflow of T1 into the drain. The overflow has no valve signal, so the diagram shows it as inferred from the routine. The waste valve (`waste_clean_tank`) stayed closed in 16 of 17 runs over 30 days. In the other one, the routine ended after 5 minutes and the waste valve emptied T1 to the drain.

### Tank levels and capacities

The tanks have pressure sensors. `getDeviceLevels()` returns two calibration tables from pressure points to liters: `t3Levels` for T3, up to 280 L, and `t1t2Levels`, up to 185 L at 703 points. HDM uses `t1t2Levels` for both T1 and T2.

| Tank | Capacity                  | Level in the app                                                                 |
| ---- | ------------------------- | -------------------------------------------------------------------------------- |
| T1   | ~24 L (CAD estimate)      | Pressure points scaled linearly, 0 to 865 points ↦ 0–24 L. Shown in percent only |
| T2   | ~195–205 L (CAD estimate) | `t1t2Levels`, shown on its 185 L scale                                           |
| T3   | ~280 L (CAD estimate)     | `t3Levels`                                                                       |

The capacities are estimated from Hydraloop's [3D model of the H600 V2.1](https://info.hydraloop.com/manuals/3d-files-hydraloop-h600/). They are not specified by Hydraloop. A 2022 owner's manual lists 360 L for the upper treatment tanks of an H600 combined, about 180 L per train, without separating T1 and T2.

`t1t2Levels` fits T2: during a transfer, T2 drops by about as much as T3 rises. It can't fit T1. T1 reads up to ~930 points, past the end of the table, which would be 185 L in a 24 L tank. So the app scales T1 by itself ([`t1PointsToLiters`](lib/model.ts)):

- **Empty**: 0 points. The lowest readings in a week of an H600's data were 9–21 points.
- **Full**: 865 points ([`T1_FULL_POINTS`](lib/model.ts)), the median while filth spills over the skim overflow of T1 in `REMOVE_FILTH_ON_HEIGHT` (855–870 on both trains). Higher readings count as full.

In `STANDBY`, T1 reads ~450–470 points, about 12–13 L. To check the scale: when T2 is vented, water falls back from T1 into T2. With this scale, T1 dropped by about 6 L and T2 rose by about 6 L (medians of 110 ventings). Matching the two gives ~22 L for a full T1, but the spread is wide (13–32 L). A linear scale assumes that T1 has the same cross-section from bottom to top.

### T2 readings while pressurized

T2 is a closed tank. The air pump pressurizes it to push water up into T1, and `release_air` vents it, which lets the water fall back into T2. The level sensors measure pressure, so the air pressure in T2 could add to its reading. The effect looks small: when the air is released, T2 rises by about as much as T1 drops (see above). So the app shows T2's reading as it is.

## Run

Install the repository's dependencies first, which `hydraloop-diagram-react` needs to build. Then from this folder:

```bash
npm install --prefix ../..
npm install
npm run dev
```

Open http://localhost:3000 and sign in with your HDM account (username, password, and the one-time code if your account uses two-factor authentication). The token is stored in an httpOnly cookie and never reaches browser JavaScript (but see [Live updates](#live-updates) for the device token).

HDM tokens expire after 30 minutes. [`proxy.ts`](proxy.ts) exchanges the token for a new one (`root.auth.refreshToken()`, no new one-time code needed) on any request within 10 minutes of its expiry, and open pages ping the server every 4 minutes. So you stay signed in as long as a page of the app is open, also in a background tab. After all pages were closed for more than 30 minutes, you need to sign in again.

### Live updates

The overview and the live view load the last 8 hours over REST, then keep them current with the real-time messages of the device ([`components/use-live-dataset.tsx`](components/use-live-dataset.tsx), [`lib/live.ts`](lib/live.ts)). The browser opens the socket to HDM itself, with [`hydraloop-internal/socket`](../../packages/hydraloop-internal/readme.md#real-time-messages), so the messages don't go through the server:

- Before each connection attempt, it gets the local API URL and a new device token from [`/api/socket`](app/api/socket/route.ts).
- It calls [`/api/heartbeat`](app/api/heartbeat/route.ts) every 90 seconds while the page is visible, as the HDM web app does while it shows the graph. Readings also arrived within about a second without it, but it may be what makes the H600 report in real time instead of about once a minute.
- It reloads over REST after every (re)connect, for what was sent while disconnected, and every 5 minutes, for what the socket doesn't send: firmware behaviors, outages, and T2 at the last venting.
- In demo mode, or if the socket fails, it polls `/api/live` every 10 seconds instead.

> [!IMPORTANT]
> The device token works as a full HDM user token: the root API accepts it as `Authorization: Bearer`, and `root.auth.refreshToken()` turns it into a user token. So while a live page is open, browser JavaScript holds a token with access to the whole account, as it does in the HDM web app (which keeps the user token in `localStorage`). The app keeps it in memory only, `/api/socket` only answers requests of its own pages (`Sec-Fetch-Site`), and a Content Security Policy ([`next.config.ts`](next.config.ts)) only lets scripts connect to the app and to `wss://*.hydraloop.com`.

To skip the login form, set `HYDRALOOP_TOKEN` to a token from a previous login, e.g. in `.env.local`.

**Explore with simulated data** on the login page shows the app with a simulation of the H600 cycle. Its timings are illustrative, not measured.

## Structure

| Path                                                                                           | Purpose                                              |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [`lib/hdm.ts`](lib/hdm.ts)                                                                     | Loads and normalizes data with the SDK (server only) |
| [`hydraloop-diagram-react/model`](../../packages/hydraloop-diagram-react/src/model.ts)         | State at a point in time, phases, room for greywater |
| [`lib/model.ts`](lib/model.ts)                                                                 | Routine segments, events, transfers, cleanings       |
| [`lib/stats.ts`](lib/stats.ts)                                                                 | 30-day statistics                                    |
| [`lib/demo.ts`](lib/demo.ts)                                                                   | Simulated data                                       |
| [`lib/maintenance.ts`](lib/maintenance.ts)                                                     | Maintenance data: alerts, outages, vitals            |
| [`lib/hdm-texts.ts`](lib/hdm-texts.ts)                                                         | Texts of the HDM web app, e.g. alert titles          |
| [`app/api/live`](app/api/live/route.ts), [`app/api/history`](app/api/history/route.ts)         | JSON for the live and history views                  |
| [`app/api/socket`](app/api/socket/route.ts), [`app/api/heartbeat`](app/api/heartbeat/route.ts) | Device token and heartbeat for the live socket       |
| [`lib/live.ts`](lib/live.ts)                                                                   | Applies socket messages to the live data             |
| [`app/api/stats`](app/api/stats/route.ts)                                                      | JSON for the 30-day statistics                       |
| [`components/overview.tsx`](components/overview.tsx)                                           | The overview                                         |
| [`hydraloop-diagram-react`](../../packages/hydraloop-diagram-react/readme.md)                  | The flow diagram                                     |
| [`components/timeline.tsx`](components/timeline.tsx)                                           | The history tracks                                   |
| [`components/maintenance-view.tsx`](components/maintenance-view.tsx)                           | The maintenance view                                 |

The packages are linked from the repository (`"hydraloop": "file:../../packages/hydraloop"`). The flow diagram and the model behind it come from [`hydraloop-diagram-react`](../../packages/hydraloop-diagram-react/readme.md), which is written in TypeScript. `npm run dev` and `npm run build` build it first. `lib/model.ts` re-exports its model, so the app imports both from `@/lib/model`.

## Background

The SDK methods used:

- `root.devices.listDevices()`, `root.devices.getDeviceShallow()`: device and online state
- `local.graph.getDeviceLevels()`: calibration tables to convert T2 and T3 pressure to liters
- `local.graph.getGraphConfig()`: captions of the valves and pumps
- `local.graph.getData()`: tank levels (`tank1`, `tank2`, `tank1_b`, `tank2_b`, `tank3`)
- `local.graph.getIo()`, `local.graph.getLastKnownIoState()`: valves and pumps
- `local.graph.getRoutineData()`: HDM routines per side
- `local.graph.getWaterRecycledData()`: liters recycled per day
- `local.settings.getTankTreatmentState()`: time left of filth removal
- `local.connectivity.getOutageSummaries()`: outages and their causes
- For the maintenance view: `root.devices.getDevice()`, `local.graph.getStatusLogData()`, `root.ticket.listTickets()`, `root.devices.getServiceLogEntries()`, `root.devices.listLinkedProfessionals()`
