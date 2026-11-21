# hydraloop/internal

> JavaScript SDK for the internal Hydraloop Device Manager (HDM) API

> [!WARNING]
> The internal API is the one the HDM web app at https://hdm.hydraloop.com/hdm/ uses. Hydraloop does not intend it for external use. It may change at any time without notice. See [`spec/README.md`](spec/README.md#stability).
>
> For integrations, use the [external API SDK](readme.md) (`hydraloop`) instead.

The SDK is generated from the OpenAPI specs in [`spec/internal/`](spec/internal/), with corrections from [`spec/internal-patches/`](spec/internal-patches/). It covers every operation of both HDM backends, except for the `/external-api/*` endpoints. These don't accept a login token, and the main [`hydraloop`](readme.md) export already covers them.

## Usage

```js
import { Hydraloop } from "hydraloop/internal";

const hydraloop = new Hydraloop();

// Log in with your HDM account
await hydraloop.login({
  username: "you@example.com",
  password: "secret",
  // only needed for accounts with two-factor authentication
  totpCode: "123456",
});

// List your devices (root API)
const { records: devices } = await hydraloop.root.devices.listDevices({
  event: { first: 0, rows: 10 },
});

// Get the tank level calibration tables of the first device (local API)
const levels = await hydraloop.local.graph.getDeviceLevels({
  deviceId: devices[0].id,
});
```

## Install

```
npm install hydraloop
```

## API

### Constructor

#### `new Hydraloop(options)`

| Option        | Type     | Required | Description                                                                                                         |
| ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `token`       | `string` | No       | Token from a previous login. Without it, call [`hydraloop.login()`](#hydralooploginoptions) first                   |
| `rootApiUrl`  | `string` | No       | Override the root API URL (default: `https://hdm.hydraloop.com/api-root`)                                           |
| `localApiUrl` | `string` | No       | Local API URL for [requests that are not for a device](#local-api). Default: the local API URL of your first device |

### Authentication

The internal API does not accept the API key of the external API. It needs an HDM user account.

#### `hydraloop.login(options)`

Logs in with username and password, followed by the two-factor authentication if the account requires it. All following requests use the resulting token.

| Option           | Type                                        | Description                                                                                                                                                    |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username`       | `string`                                    | HDM username                                                                                                                                                   |
| `password`       | `string`                                    | HDM password                                                                                                                                                   |
| `totpCode`       | `string \| () => string \| Promise<string>` | One-time password for accounts with two-factor authentication. Pass a function to only create the code when it is needed, so it is still valid when it is sent |
| `rememberDevice` | `boolean`                                   | Passed on to the two-factor authentication. Default: `false`                                                                                                   |

**Returns:** `Promise<Root.AuthToken>` with the `token`, its `expiresIn` (seconds) and the `user`.

To skip the login next time, store `token` and pass it to the constructor until it expires.

### Permissions

What you can access depends on the permissions of your HDM account (see `user.permissions` of the login response). Most endpoints are meant for Hydraloop staff and respond with `401` and `"Insufficient permissions"` for regular users. With a regular account, you can use the endpoints for your devices, such as the graph data, the device list and details, and your tickets.

### Methods

The methods are grouped by API and tag of the OpenAPI specs:

- `hydraloop.root.<tag>.<method>(options)` — Root API (`/api-root`): authentication, devices, users, settings, tickets, …
- `hydraloop.local.<tag>.<method>(options)` — Local API (`/api-local`): device data such as graphs, settings, maintenance, …

The method name is the operation ID without its controller prefix, e.g. `GraphController_getData` becomes `hydraloop.local.graph.getData()`. See the [list of all methods](#all-methods) below.

All methods take a single `options` object:

- Path and query parameters are passed by name, e.g. `{ deviceId, from, until }`.
  - `Date` objects are sent as ISO 8601 strings, other objects (such as the lazy loading `event` of list endpoints) as JSON.
  - Arrays are sent as repeated parameters.
  - `undefined` and `null` values are left out.
- The request body is passed as `body`.

```js
await hydraloop.local.settings.changeBypassMode({
  body: { deviceId, activate: true },
});
```

Methods resolve with the parsed JSON response, a string for other responses, or `undefined` for empty responses.

### Local API

Each device's data lives on a local server, the URL of which "might change depending on load balancing and or privacy laws of your country". The SDK takes care of that:

- Requests for a device (with a `deviceId` parameter, or a `deviceId` in `body`) are sent to the device's `localApiUrl`. The SDK looks it up with `hydraloop.root.devices.getDeviceShallow({ id })` and caches it.
- The local API requires a device-scoped token for these requests, in addition to the user token. The SDK gets it with `hydraloop.root.auth.tokenForDevice({ deviceId })` and caches it until shortly before it expires.
- All other local API requests are sent to the `localApiUrl` option, or by default to the local API of your first device. Some of these endpoints require a device token as well (e.g. `hydraloop.local.graph.getIoNamesSensorOnly()`), so the SDK sends the one of your first device.

### Real-time messages

#### `hydraloop.local.subscribe(options)`

Subscribes to the real-time messages of a device, which the HDM web app uses for its live views. The device pushes its graph values about every 3 seconds, and every change of a valve, pump, routine or setting as it happens. That is the same data as `getData()`, `getIo()`, `getRoutineData()` and `getTankTreatmentState()` of the local API, without polling.

```js
const subscription = hydraloop.local.subscribe({
  deviceId,
  rooms: ["graph", "device-state"],
});

for await (const message of subscription) {
  if (message.name === "graph:routine") {
    for (const routine of message.payload.routines) {
      console.log(`${routine.side}: ${routine.name} ${routine.state}`);
    }
  }
  if (message.name === "device-state:setting-value") {
    console.log(`${message.payload.name} = ${message.payload.value}`);
  }
}
```

| Option         | Type                       | Description                                                                                                                |
| -------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `deviceId`     | `string`                   | The device ID                                                                                                              |
| `rooms`        | `SocketRoom[]`             | The rooms to receive the messages of, see [all socket messages](#all-socket-messages)                                      |
| `signal`       | `AbortSignal`              | Ends the subscription when aborted                                                                                         |
| `onConnect`    | `() => void`               | Called when connected and subscribed to the rooms, also after reconnecting                                                 |
| `onDisconnect` | `(reason: string) => void` | Called when the connection is lost, e.g. when an HDM server restarts. The subscription reconnects with a new device token. |

**Returns:** a `Subscription`, an async iterator of messages with their `name` (e.g. `graph:io`) and `payload`. The type of the messages follows from the rooms. `subscription.close()` ends it, as do `break` in a `for await` loop and the `signal`.

Messages are queued until they are read. It reconnects until the subscription is ended, with a growing delay of up to 30 seconds. Messages sent while it was disconnected are lost, load them with the local API if needed. It ends with an error if the device's local API URL or token can't be loaded, e.g. for an expired user token.

The socket API is not part of the OpenAPI specs. It is described in [`spec/socket/asyncapi.json`](spec/socket/asyncapi.json), an [AsyncAPI](https://www.asyncapi.com/) document written from the HDM web app's JavaScript and from listening to an H600. `subscribe()` uses the global `WebSocket` (Node.js 22+, browsers) and speaks the parts of the socket.io protocol that HDM uses itself, so it doesn't need the socket.io client.

### Types

The types of the schemas in the specs are exported in two namespaces, one per API:

```ts
import type { Root, Local } from "hydraloop/internal";

const device: Root.Device = await hydraloop.root.devices.getDevice({ id });
const data: Local.GraphRecords = await hydraloop.local.graph.getData({
  /* … */
});
```

Also exported are `HydraloopOptions`, `LoginOptions`, `RootApi` and `LocalApi` (the types of `hydraloop.root` and `hydraloop.local`), and for `hydraloop.local.subscribe()`: `SubscribeOptions`, `Subscription`, and the `Socket` namespace with the payload types, `SocketMessages`, `SocketRoom` and `SocketMessage`:

```ts
import type { Socket } from "hydraloop/internal";

function onRoutine(payload: Socket.RoutineMessage) {}
const message: Socket.SocketMessage<"graph"> = /* … */;
```

About half of the operations have no response schema in the specs. Their methods resolve with `any`. The response types of the endpoints that regular users can access were checked against actual responses and corrected where needed, see [`spec/internal-patches/`](spec/internal-patches/).

## Error Handling

API errors throw the same `RequestError` as the [external SDK](readme.md#error-handling), with `.request` and `.response` properties for debugging.

```js
import { Hydraloop, RequestError } from "hydraloop/internal";

try {
  await hydraloop.root.devices.getDevice({ id: "unknown" });
} catch (error) {
  if (error instanceof RequestError) {
    console.log(error.response.status);
  }
}
```

The `authorization` and `additional-authorization` headers are redacted in `error.request.headers`.

## Development

The endpoint methods (`lib/internal/root/`, `lib/internal/local/`), their types (`lib/internal/*-types.d.ts`) and the [list of all methods](#all-methods) below are generated from [`spec/internal/`](spec/internal/). The types of the socket messages (`lib/internal/socket-types.d.ts`) and the [list of all socket messages](#all-socket-messages) are generated from [`spec/socket/asyncapi.json`](spec/socket/asyncapi.json), which is written by hand. Don't edit the generated files by hand.

The specs are incomplete or wrong in places, e.g. many fields that can be `null` are not marked as nullable. Corrections are kept as [JSON merge patches](https://www.rfc-editor.org/rfc/rfc7386) in [`spec/internal-patches/`](spec/internal-patches/), which are applied to the specs before generating. To add a correction, edit the patch file of the API.

To regenerate, run:

```
npm run generate:internal
```

The [Update OpenAPI Specs](.github/workflows/update-spec.yml) workflow does that after each spec update.

## All methods

<!-- BEGIN GENERATED METHODS -->

### Root API (`hydraloop.root`)

<details>
<summary><code>root.appAuth</code> (6)</summary>

| Method                     | Request                                    | Summary                   |
| -------------------------- | ------------------------------------------ | ------------------------- |
| `sendAuthenticationCode()` | `POST /app-auth/send-authentication-code`  | Send authentication code  |
| `registerAppAutoPhase1()`  | `POST /app-auth/register-app-auto-phase-1` | Auto Register App: Fase 1 |
| `registerApp()`            | `POST /app-auth/register-app`              | Register App              |
| `logoutApp()`              | `POST /app-auth/logout-app`                | Logout App                |
| `registerAppPushToken()`   | `POST /app-auth/register-app-push-token`   | Register App Push Token   |
| `processAddress()`         | `POST /app-auth/process-address`           | Process Address           |

</details>

<details>
<summary><code>root.auditTrail</code> (5)</summary>

| Method                       | Request                                      | Summary                            |
| ---------------------------- | -------------------------------------------- | ---------------------------------- |
| `getDeviceAuditTrailByDay()` | `GET /audit-trail/device-audit-trail-by-day` | Lists audit trail for device       |
| `getDeviceAuditTrail()`      | `GET /audit-trail/device-audit-trail`        | Lists audit trail for device       |
| `getUserAuditTrailByDay()`   | `GET /audit-trail/user-audit-trail-by-day`   | Lists audit trail for user         |
| `getUserAuditTrail()`        | `GET /audit-trail/user-audit-trail`          | Lists audit trail for user         |
| `resolveNames()`             | `POST /audit-trail/resolve-names`            | Resolves names for the audit trail |

</details>

<details>
<summary><code>root.auth</code> (7)</summary>

| Method                  | Request                            | Summary               |
| ----------------------- | ---------------------------------- | --------------------- |
| `login()`               | `POST /auth/login`                 | Login                 |
| `appLogin()`            | `POST /auth/app-login`             | App Login             |
| `serviceLogin()`        | `POST /auth/service-login`         | Login for services    |
| `recoverLoginDetails()` | `POST /auth/recover-login-details` | Recover login details |
| `refreshToken()`        | `POST /auth/refresh-token`         | Refresh Token         |
| `logout()`              | `POST /auth/logout`                | Logout                |
| `tokenForDevice()`      | `POST /auth/token-for-device`      | Get token for device  |

</details>

<details>
<summary><code>root.console</code> (1)</summary>

| Method      | Request                 | Summary          |
| ----------- | ----------------------- | ---------------- |
| `execute()` | `POST /console/execute` | Execute commands |

</details>

<details>
<summary><code>root.country</code> (1)</summary>

| Method              | Request             | Summary |
| ------------------- | ------------------- | ------- |
| `listPermissions()` | `GET /country/list` |         |

</details>

<details>
<summary><code>root.deviceAccess</code> (2)</summary>

| Method                      | Request                                                    | Summary |
| --------------------------- | ---------------------------------------------------------- | ------- |
| `listDevices()`             | `GET /device-access/devices/{personId}`                    |         |
| `listOrganisationDevices()` | `GET /device-access/organisation-devices/{organisationId}` |         |

</details>

<details>
<summary><code>root.deviceAccessPoint</code> (1)</summary>

| Method     | Request                           | Summary                  |
| ---------- | --------------------------------- | ------------------------ |
| `update()` | `GET /device-access-point/update` | Update access point data |

</details>

<details>
<summary><code>root.deviceConfig</code> (4)</summary>

| Method                   | Request                                     | Summary                              |
| ------------------------ | ------------------------------------------- | ------------------------------------ |
| `listTypes()`            | `GET /device-config/list-types`             | List possible configuration types    |
| `listPossibleSettings()` | `GET /device-config/list-possible-settings` | List possible configuration settings |
| `listCurrentSettings()`  | `GET /device-config/list-current-settings`  | List current configuration settings  |
| `storeSetting()`         | `POST /device-config/store-setting`         | Store setting                        |

</details>

<details>
<summary><code>root.deviceDashboard</code> (6)</summary>

| Method                      | Request                                              | Summary                                                                                                                                              |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRootData()`             | `GET /device-dashboard/root-data`                    | Get device dashboard data                                                                                                                            |
| `listDevices()`             | `GET /device-dashboard/list-devices`                 | Get devices                                                                                                                                          |
| `commissionDeviceFromApp()` | `POST /device-dashboard/device-dashboard-commission` |                                                                                                                                                      |
| `requestEmailAuthCode()`    | `POST /device-dashboard/request-email-auth-code`     | Generate and send a new 6-digit email authentication code (15 min expiry); the send is skipped when a valid code is already cached unless force=true |
| `verifyEmailAuthCode()`     | `POST /device-dashboard/verify-email-auth-code`      | Verify a 6-digit email authentication code generated by request-email-auth-code                                                                      |
| `getOwnerMaskedEmail()`     | `POST /device-dashboard/get-owner-masked-email`      | Get masked owner email by personId                                                                                                                   |

</details>

<details>
<summary><code>root.deviceData</code> (6)</summary>

| Method                    | Request                               | Summary                             |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| `storeFile()`             | `POST /device-data/store-file`        |                                     |
| `storeDeviceAttributes()` | `POST /device-data/update-attributes` |                                     |
| `storeDeviceActivity()`   | `POST /device-data/activity`          |                                     |
| `storeDeviceOnline()`     | `POST /device-data/online`            |                                     |
| `storeDeviceOffline()`    | `POST /device-data/offline`           |                                     |
| `getLastPublicData()`     | `GET /device-data/last-public-data`   | Get the last public data of the app |

</details>

<details>
<summary><code>root.deviceHardware</code> (5)</summary>

| Method                   | Request                            | Summary |
| ------------------------ | ---------------------------------- | ------- |
| `listDeviceHardware()`   | `GET /device-hardware/list`        |         |
| `exportDeviceHardware()` | `GET /device-hardware/export`      |         |
| `getDevice()`            | `GET /device-hardware/get`         |         |
| `storeDevice()`          | `POST /device-hardware/store`      |         |
| `importBom()`            | `POST /device-hardware/import-bom` |         |

</details>

<details>
<summary><code>root.deviceHardwarePart</code> (6)</summary>

| Method                               | Request                                  | Summary |
| ------------------------------------ | ---------------------------------------- | ------- |
| `listDeviceHardwareParts()`          | `GET /device-hardware-part/list`         |         |
| `exportDeviceHardwareParts()`        | `GET /device-hardware-part/export`       |         |
| `getDeviceHardwarePart()`            | `GET /device-hardware-part/get`          |         |
| `storeDeviceHardwarePart()`          | `POST /device-hardware-part/store`       |         |
| `getDeviceHardwarePublicPartFile()`  | `GET /device-hardware-part/public-file`  |         |
| `getDeviceHardwarePrivatePartFile()` | `GET /device-hardware-part/private-file` |         |

</details>

<details>
<summary><code>root.deviceHardwarePartAdditionalInfo</code> (8)</summary>

| Method                                          | Request                                                                   | Summary |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------- |
| `listDeviceHardwarePartsAdditionalInfo()`       | `GET /device-hardware-part-additional-info/list`                          |         |
| `exportDeviceHardwarePartsAdditionalInfo()`     | `GET /device-hardware-part-additional-info/export`                        |         |
| `getDeviceHardwarePartAdditionalInfo()`         | `GET /device-hardware-part-additional-info/get`                           |         |
| `storeDeviceHardwarePartAdditionalInfo()`       | `POST /device-hardware-part-additional-info/store`                        |         |
| `listTags()`                                    | `GET /device-hardware-part-additional-info/tags`                          |         |
| `getDeviceHardwarePartPublicFile()`             | `GET /device-hardware-part-additional-info/public-file`                   |         |
| `getDeviceHardwarePartPrivateFile()`            | `GET /device-hardware-part-additional-info/private-file`                  |         |
| `getDeviceHardwareSparePartSpecificationFile()` | `GET /device-hardware-part-additional-info/spare-part-specification-file` |         |

</details>

<details>
<summary><code>root.deviceMaintenance</code> (2)</summary>

| Method                            | Request                                                     | Summary |
| --------------------------------- | ----------------------------------------------------------- | ------- |
| `updateDeviceStatuses()`          | `POST /device-maintenance/set-new-maintenance-date`         |         |
| `registerManualMaintenanceDate()` | `POST /device-maintenance/register-manual-maintenance-date` |         |

</details>

<details>
<summary><code>root.deviceNotifications</code> (1)</summary>

| Method                    | Request                                              | Summary |
| ------------------------- | ---------------------------------------------------- | ------- |
| `sendVerificationStart()` | `POST /device-notifications/send-verification-start` |         |

</details>

<details>
<summary><code>root.devicePart</code> (5)</summary>

| Method                | Request                           | Summary |
| --------------------- | --------------------------------- | ------- |
| `listDevicePart()`    | `GET /device-part/list`           |         |
| `getIoSpareParts()`   | `GET /device-part/io-spare-parts` |         |
| `getDevicePart()`     | `GET /device-part/get`            |         |
| `storeDevicePart()`   | `POST /device-part/store`         |         |
| `getDevicePartFile()` | `GET /device-part/file`           |         |

</details>

<details>
<summary><code>root.devicePersonConfig</code> (4)</summary>

| Method                               | Request                                                       | Summary                          |
| ------------------------------------ | ------------------------------------------------------------- | -------------------------------- |
| `getDeviceHardwareFrontPlateTypes()` | `GET /device-person-config/get-device-front-plate-types`      | Get device person config         |
| `getDevicePersonConfig()`            | `GET /device-person-config/get-device-person-config`          | Get device person config         |
| `changeDevicePersonFrontPlate()`     | `POST /device-person-config/change-device-person-front-plate` | Change device person front plate |
| `changeDevicePersonLanguage()`       | `POST /device-person-config/change-device-person-language`    | Change device person language    |

</details>

<details>
<summary><code>root.deviceSignaling</code> (5)</summary>

| Method                 | Request                                       | Summary |
| ---------------------- | --------------------------------------------- | ------- |
| `setSignalsInactive()` | `POST /device-signaling/set-signals-inactive` |         |
| `createSignal()`       | `POST /device-signaling/create`               |         |
| `removeSignal()`       | `POST /device-signaling/remove-signal`        |         |
| `blockIssue()`         | `POST /device-signaling/block-issue`          |         |
| `unblockSignal()`      | `POST /device-signaling/unblock-signal`       |         |

</details>

<details>
<summary><code>root.deviceSparePartPrice</code> (4)</summary>

| Method                         | Request                                | Summary |
| ------------------------------ | -------------------------------------- | ------- |
| `listDeviceSparePartPrices()`  | `GET /device-spare-part-price/list`    |         |
| `getDeviceSparePartPrice()`    | `GET /device-spare-part-price/get`     |         |
| `storeDeviceSparePartPrice()`  | `POST /device-spare-part-price/store`  |         |
| `removeDeviceSparePartPrice()` | `POST /device-spare-part-price/remove` |         |

</details>

<details>
<summary><code>root.deviceStatus</code> (1)</summary>

| Method                   | Request                                      | Summary |
| ------------------------ | -------------------------------------------- | ------- |
| `updateDeviceStatuses()` | `POST /device-status/update-device-statuses` |         |

</details>

<details>
<summary><code>root.deviceUpdater</code> (2)</summary>

| Method           | Request                      | Summary               |
| ---------------- | ---------------------------- | --------------------- |
| `update()`       | `GET /device-updater/update` | Update device updater |
| `deviceConfig()` | `GET /device-updater/config` | Device updater config |

</details>

<details>
<summary><code>root.devices</code> (86)</summary>

| Method                                         | Request                                                           | Summary                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `listDevices()`                                | `GET /devices/list`                                               |                                                                                |
| `exportDevices()`                              | `GET /devices/export`                                             |                                                                                |
| `findDeviceBySerial()`                         | `GET /devices/find-by-serial`                                     |                                                                                |
| `getDevice()`                                  | `GET /devices/get`                                                |                                                                                |
| `getDeviceShallow()`                           | `GET /devices/get-shallow`                                        |                                                                                |
| `getDeviceShallowBySerial()`                   | `GET /devices/get-shallow-by-serial`                              |                                                                                |
| `getDeviceShallowByMac()`                      | `GET /devices/get-by-mac`                                         |                                                                                |
| `getDeviceHardware()`                          | `GET /devices/get-device-hardware`                                |                                                                                |
| `findDeviceHardwarePartHistory()`              | `GET /devices/device-hardware-part-history`                       |                                                                                |
| `checkForDeviceAccess()`                       | `GET /devices/check-access`                                       |                                                                                |
| `storeDevice()`                                | `POST /devices/store`                                             |                                                                                |
| `markSpecialUseCases()`                        | `POST /devices/mark-special-use-cases`                            |                                                                                |
| `updateDeviceField()`                          | `POST /devices/update-field`                                      |                                                                                |
| `searchEcu()`                                  | `GET /devices/search-ecu`                                         |                                                                                |
| `changeEcu()`                                  | `POST /devices/change-ecu`                                        |                                                                                |
| `changeEcuByMacAddress()`                      | `POST /devices/change-ecu-by-mac`                                 |                                                                                |
| `changeVerificationDate()`                     | `POST /devices/change-verification-date`                          |                                                                                |
| `changeCommissionDate()`                       | `POST /devices/change-commission-date`                            |                                                                                |
| `completeFactoryTest()`                        | `POST /devices/complete-factory-test`                             |                                                                                |
| `prepareHydraloopFactoryTest()`                | `POST /devices/prepare-hydraloop-factory-test`                    |                                                                                |
| `completeHydraloopFactoryTest()`               | `POST /devices/complete-hydraloop-factory-test`                   |                                                                                |
| `storeFactoryUvBatch()`                        | `POST /devices/store-factory-uv-batch`                            |                                                                                |
| `tagTransferUpgrade()`                         | `POST /devices/tag-transfer-upgrade`                              |                                                                                |
| `tagCheckValvesUpgrade()`                      | `POST /devices/tag-check-valves-upgrade`                          |                                                                                |
| `tagHighVoltageFuseReplacement()`              | `POST /devices/tag-high-voltage-fuse-replacement`                 |                                                                                |
| `tagIoBoardUpgrade()`                          | `POST /devices/tag-io-board-upgrade`                              |                                                                                |
| `initAuthenticationCode()`                     | `POST /devices/init-authentication-code`                          |                                                                                |
| `setBranchToRelease()`                         | `POST /devices/set-branch-to-release`                             |                                                                                |
| `changeBranch()`                               | `POST /devices/change-branch`                                     |                                                                                |
| `setTargetBranch()`                            | `POST /devices/set-target-branch`                                 |                                                                                |
| `storeServiceLogEntry()`                       | `POST /devices/service-log-entry`                                 |                                                                                |
| `getServiceLogTypes()`                         | `GET /devices/service-log-types`                                  |                                                                                |
| `getServiceLogEntries()`                       | `GET /devices/service-log-entries`                                |                                                                                |
| `downloadServiceLogEntryFile()`                | `GET /devices/service-log-entry-file/{serviceLogId}/{fileId}`     |                                                                                |
| `getDeviceEcuHistory()`                        | `GET /devices/device-ecu-history`                                 |                                                                                |
| `getDeviceNeedsSettingsUpdated()`              | `GET /devices/device-needs-settings-updated`                      |                                                                                |
| `storeDeviceSettingsUpdated()`                 | `POST /devices/device-settings-updated`                           |                                                                                |
| `deviceMacIdMap()`                             | `GET /devices/id-mac`                                             |                                                                                |
| `listNeighbourGroups()`                        | `GET /devices/list-neighbour-groups`                              |                                                                                |
| `getNeighbourGroup()`                          | `GET /devices/neighbour-group`                                    |                                                                                |
| `storeNeighbourGroup()`                        | `POST /devices/neighbour-group`                                   |                                                                                |
| `updateNeighbourGroupField()`                  | `POST /devices/update-neighbour-group-field`                      |                                                                                |
| `listCascadeGroups()`                          | `GET /devices/list-cascade-groups`                                |                                                                                |
| `getCascadeGroup()`                            | `GET /devices/cascade-group`                                      |                                                                                |
| `storeCascadeGroup()`                          | `POST /devices/cascade-group`                                     |                                                                                |
| `getCascadeGroupDevices()`                     | `GET /devices/cascade-group-devices`                              |                                                                                |
| `updateCascadeGroupField()`                    | `POST /devices/update-cascade-group-field`                        |                                                                                |
| `storeInletManifoldType()`                     | `POST /devices/store-inlet-manifold-type`                         |                                                                                |
| `storeDeviceType()`                            | `POST /devices/store-device-type`                                 |                                                                                |
| `changeSerial()`                               | `POST /devices/change-serial`                                     |                                                                                |
| `changeUvSerial()`                             | `POST /devices/change-uv-serial`                                  |                                                                                |
| `registerAirPumpReplacement()`                 | `POST /devices/register-air-pump-replacement`                     |                                                                                |
| `registerPartReplacement()`                    | `POST /devices/register-part-replacement`                         |                                                                                |
| `seedPartHistory()`                            | `POST /devices/seed-part-history`                                 |                                                                                |
| `addSubType()`                                 | `POST /devices/add-sub-type`                                      |                                                                                |
| `removeSubType()`                              | `POST /devices/remove-sub-type`                                   |                                                                                |
| `storeWhatIsConnected()`                       | `POST /devices/store-what-is-connected`                           |                                                                                |
| `storeWhatIsTheGPSLocation()`                  | `POST /devices/store-what-is-the-gps-location`                    |                                                                                |
| `listLinkedProfessionals()`                    | `GET /devices/list-linked-professionals`                          |                                                                                |
| `listProfessionals()`                          | `GET /devices/list-professionals`                                 |                                                                                |
| `storeNewProfessional()`                       | `POST /devices/store-new-professional`                            |                                                                                |
| `updateProfessional()`                         | `POST /devices/update-professional`                               |                                                                                |
| `listOwners()`                                 | `GET /devices/list-owners`                                        |                                                                                |
| `linkOwner()`                                  | `POST /devices/link-owner`                                        |                                                                                |
| `unlinkOwner()`                                | `POST /devices/unlink-owner`                                      |                                                                                |
| `storeNewOwner()`                              | `POST /devices/store-new-owner`                                   |                                                                                |
| `updateOwner()`                                | `POST /devices/update-owner`                                      |                                                                                |
| `storeDeviceVersion()`                         | `POST /devices/store-device-version`                              |                                                                                |
| `storeVoltage()`                               | `POST /devices/store-voltage`                                     |                                                                                |
| `storeBoardVersions()`                         | `POST /devices/store-board-versions`                              |                                                                                |
| `storeDeviceVersionByOverflowT4SensorSystem()` | `POST /devices/store-device-version-on-overflow-t4-sensor-system` |                                                                                |
| `storeDeviceVersionByPtuVersion()`             | `POST /devices/store-device-version-on-ptu-version`               |                                                                                |
| `getActors()`                                  | `POST /devices/actors`                                            |                                                                                |
| `getLocalServers()`                            | `GET /devices/local-servers`                                      |                                                                                |
| `storeLocalServer()`                           | `POST /devices/local-server`                                      |                                                                                |
| `getWiringDiagram()`                           | `GET /devices/wiring-diagram`                                     |                                                                                |
| `getDeviceSignalOfTypeActive()`                | `GET /devices/get-device-signal-of-type-active`                   |                                                                                |
| `getIsOwnerEmailPresent()`                     | `GET /devices/get-is-owner-email-present`                         |                                                                                |
| `getComponentOnTimeConfiguration()`            | `GET /devices/component-on-time-configuration`                    |                                                                                |
| `resetDeviceFromPersonalInformation()`         | `POST /devices/reset-device-from-personal-information`            |                                                                                |
| `searchDevices()`                              | `GET /devices/search`                                             |                                                                                |
| `listStatuses()`                               | `GET /devices/statuses`                                           |                                                                                |
| `listCountries()`                              | `GET /devices/countries`                                          |                                                                                |
| `listKits()`                                   | `GET /devices/kits`                                               |                                                                                |
| `listDeviceTypes()`                            | `GET /devices/device-types`                                       |                                                                                |
| `cleanup()`                                    | `POST /devices/simulator-cleanup`                                 | Remove a simulator device with its ECU records (refuses non-simulator devices) |

</details>

<details>
<summary><code>root.dynamicList</code> (3)</summary>

| Method            | Request                             | Summary |
| ----------------- | ----------------------------------- | ------- |
| `listFilters()`   | `GET /dynamic-list/list-filters`    |         |
| `storeFilters()`  | `POST /dynamic-list/store-filters`  |         |
| `removeFilters()` | `POST /dynamic-list/remove-filters` |         |

</details>

<details>
<summary><code>root.dynamicGraphSettings</code> (4)</summary>

| Method         | Request                                   | Summary |
| -------------- | ----------------------------------------- | ------- |
| `list()`       | `GET /dynamic-graph-settings`             |         |
| `create()`     | `POST /dynamic-graph-settings`            |         |
| `syncStatus()` | `GET /dynamic-graph-settings/sync-status` |         |
| `update()`     | `POST /dynamic-graph-settings/{id}`       |         |

</details>

<details>
<summary><code>root.ecus</code> (11)</summary>

| Method                   | Request                           | Summary |
| ------------------------ | --------------------------------- | ------- |
| `listEcus()`             | `GET /ecus/list`                  |         |
| `exportEcus()`           | `GET /ecus/export`                |         |
| `getEcu()`               | `GET /ecus/get`                   |         |
| `storeEcu()`             | `POST /ecus/store`                |         |
| `listUnresolvedEcus()`   | `GET /ecus/list-unresolved`       |         |
| `exportUnresolvedEcus()` | `GET /ecus/export-unresolved`     |         |
| `storeEcuVersion()`      | `POST /ecus/store-ecu-version`    |         |
| `storeWifiVersion()`     | `POST /ecus/store-wifi-version`   |         |
| `storeEthernetMac()`     | `POST /ecus/store-ethernet-mac`   |         |
| `getConnectionData()`    | `GET /ecus/connection-data`       |         |
| `storeUnresolvedEcu()`   | `POST /ecus/store-unresolved-ecu` |         |

</details>

<details>
<summary><code>root.fileStore</code> (2)</summary>

| Method           | Request                         | Summary |
| ---------------- | ------------------------------- | ------- |
| `storeFile()`    | `POST /file-store/upload`       |         |
| `downloadFile()` | `GET /file-store/download/{id}` |         |

</details>

<details>
<summary><code>root.formstack</code> (1)</summary>

| Method                  | Request                             | Summary                         |
| ----------------------- | ----------------------------------- | ------------------------------- |
| `postWebhookFromData()` | `POST /formstack/webhook-form-data` | Formstack webhook for form data |

</details>

<details>
<summary><code>root.formstackForm</code> (6)</summary>

| Method                          | Request                                                   | Summary |
| ------------------------------- | --------------------------------------------------------- | ------- |
| `listForms()`                   | `GET /formstack-form/list`                                |         |
| `listDeviceForms()`             | `GET /formstack-form/list-device-recycle-ready-checklist` |         |
| `exportForms()`                 | `GET /formstack-form/export`                              |         |
| `getForm()`                     | `GET /formstack-form/get`                                 |         |
| `updateFormstackFormField()`    | `POST /formstack-form/update-field`                       |         |
| `downloadServiceLogEntryFile()` | `GET /formstack-form/file/{formId}/{fileId}`              |         |

</details>

<details>
<summary><code>root.hdmRoot</code> (4)</summary>

| Method             | Request            | Summary                         |
| ------------------ | ------------------ | ------------------------------- |
| `get()`            | `GET /`            | Redirect to API documentation   |
| `test()`           | `GET /test`        | test                            |
| `getEnvironment()` | `GET /environment` | Get environment                 |
| `ping()`           | `GET /ping`        | Ping endpoint for health checks |

</details>

<details>
<summary><code>root.health</code> (1)</summary>

| Method    | Request       | Summary |
| --------- | ------------- | ------- |
| `check()` | `GET /health` |         |

</details>

<details>
<summary><code>root.kiosk</code> (2)</summary>

| Method                | Request                 | Summary              |
| --------------------- | ----------------------- | -------------------- |
| `getKioskDataRapid()` | `GET /kiosk/data-rapid` | Get rapid kiosk data |
| `getKioskDataSlow()`  | `GET /kiosk/data-slow`  | Get slow kiosk data  |

</details>

<details>
<summary><code>root.map</code> (1)</summary>

| Method          | Request            | Summary |
| --------------- | ------------------ | ------- |
| `listDevices()` | `GET /map/devices` |         |

</details>

<details>
<summary><code>root.odoo</code> (5)</summary>

| Method                      | Request                           | Summary                        |
| --------------------------- | --------------------------------- | ------------------------------ |
| `postWebhookOrganisation()` | `POST /odoo/webhook-organisation` | Odoo webhook for organisations |
| `postWebhookPerson()`       | `POST /odoo/webhook-person`       | Odoo webhook for persons       |
| `postWebhookUser()`         | `POST /odoo/webhook-user`         | Odoo webhook for users         |
| `postWebhookLot()`          | `POST /odoo/webhook-lot`          | Odoo webhook for lots          |
| `generateSalesReport()`     | `GET /odoo/generate-sales-report` |                                |

</details>

<details>
<summary><code>root.pipedrive</code> (1)</summary>

| Method          | Request                   | Summary           |
| --------------- | ------------------------- | ----------------- |
| `postWebhook()` | `POST /pipedrive/webhook` | Pipedrive webhook |

</details>

<details>
<summary><code>root.releaseNotes</code> (1)</summary>

| Method         | Request                   | Summary |
| -------------- | ------------------------- | ------- |
| `getVersion()` | `GET /release-notes/list` |         |

</details>

<details>
<summary><code>root.serverPerformance</code> (4)</summary>

| Method              | Request                                             | Summary                                             |
| ------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `getPerformance()`  | `GET /server-performance`                           | Get on-demand server performance metrics            |
| `getActivity()`     | `GET /server-performance/activity`                  | Get current administrator activity                  |
| `getUserActivity()` | `GET /server-performance/activity/users`            | Get HDM and App user activity for a calendar day    |
| `forceStopFsm()`    | `POST /server-performance/activity/fsms/force-stop` | Emergency force-stop an active FSM and its children |

</details>

<details>
<summary><code>root.settings</code> (58)</summary>

| Method                             | Request                                             | Summary                        |
| ---------------------------------- | --------------------------------------------------- | ------------------------------ |
| `getVersion()`                     | `GET /settings/version`                             |                                |
| `listOrganisations()`              | `GET /settings/list-organisations`                  |                                |
| `searchOrganisations()`            | `GET /settings/search-organisations`                |                                |
| `exportOrganisations()`            | `GET /settings/export-organisations`                |                                |
| `getOrganisation()`                | `GET /settings/organisation`                        |                                |
| `postOrganisation()`               | `POST /settings/organisation`                       |                                |
| `updateOrganisationField()`        | `POST /settings/update-organisation-field`          |                                |
| `listPersons()`                    | `GET /settings/list-persons`                        |                                |
| `searchPersons()`                  | `GET /settings/search-persons`                      |                                |
| `exportPersons()`                  | `GET /settings/export-persons`                      |                                |
| `getPerson()`                      | `GET /settings/person`                              |                                |
| `postPerson()`                     | `POST /settings/person`                             |                                |
| `getCurrentPerson()`               | `GET /settings/current-person`                      |                                |
| `mergePerson()`                    | `POST /settings/merge-person`                       |                                |
| `deletePersonUser()`               | `POST /settings/delete-person-user`                 |                                |
| `deletePerson()`                   | `POST /settings/delete-person`                      |                                |
| `postCreateUser()`                 | `POST /settings/create-user`                        |                                |
| `postResetPassword()`              | `POST /settings/reset-password`                     |                                |
| `postResetTwoFactorAuth()`         | `POST /settings/reset-two-factor-auth`              |                                |
| `postChangePassword()`             | `POST /settings/change-password`                    |                                |
| `postChangeOwnPassword()`          | `POST /settings/change-own-password`                |                                |
| `listRoles()`                      | `GET /settings/list-roles`                          |                                |
| `exportRoles()`                    | `GET /settings/export-roles`                        |                                |
| `getRole()`                        | `GET /settings/role`                                |                                |
| `postRole()`                       | `POST /settings/role`                               |                                |
| `listApiKeys()`                    | `GET /settings/list-api-keys`                       |                                |
| `exportApiKeys()`                  | `GET /settings/export-api-keys`                     |                                |
| `getApiKey()`                      | `GET /settings/api-key`                             |                                |
| `postApiKey()`                     | `POST /settings/api-key`                            |                                |
| `removeApiKey()`                   | `POST /settings/remove-api-key`                     |                                |
| `listApiDevices()`                 | `GET /settings/list-api-devices`                    |                                |
| `listPermissions()`                | `GET /settings/list-permissions`                    |                                |
| `getCurrentUser()`                 | `GET /settings/current-user`                        |                                |
| `storeMySettings()`                | `POST /settings/my-settings`                        |                                |
| `listRememberedDevices()`          | `GET /settings/list-remembered-devices`             |                                |
| `deleteRememberedDevice()`         | `POST /settings/delete-remembered-device`           |                                |
| `listLocalServers()`               | `GET /settings/list-local-servers`                  |                                |
| `exportLocalServers()`             | `GET /settings/export-local-servers`                |                                |
| `getLocalServer()`                 | `GET /settings/local-server`                        |                                |
| `postLocalServer()`                | `POST /settings/local-server`                       |                                |
| `removeLocalServer()`              | `POST /settings/remove-local-server`                |                                |
| `listDeviceUpdaters()`             | `GET /settings/list-device-updaters`                |                                |
| `exportDeviceUpdaters()`           | `GET /settings/export-device-updaters`              |                                |
| `getDeviceUpdater()`               | `GET /settings/device-updater`                      |                                |
| `postDeviceUpdater()`              | `POST /settings/device-updater`                     |                                |
| `removeDeviceUpdater()`            | `POST /settings/remove-device-updater`              |                                |
| `listDeviceUpdaterConfigs()`       | `GET /settings/list-device-updater-configs`         |                                |
| `postDeviceUpdaterConfig()`        | `POST /settings/device-updater-config`              |                                |
| `updateDeviceUpdaterConfigField()` | `POST /settings/update-device-updater-config-field` |                                |
| `removeDeviceUpdaterConfig()`      | `POST /settings/remove-device-updater-config`       |                                |
| `storeAcceptTermsAndConditions()`  | `POST /settings/accept-terms-and-conditions`        |                                |
| `getOrganisationNotes()`           | `GET /settings/get-organisation-notes`              |                                |
| `storeOrganisationNote()`          | `POST /settings/store-new-organisation-note`        |                                |
| `editOrganisationNote()`           | `POST /settings/edit-organisation-note`             |                                |
| `removeOrganisationNote()`         | `POST /settings/remove-organisation-note`           |                                |
| `getOrganisationNoteAmount()`      | `GET /settings/get-organisation-notes-amount`       |                                |
| `recoverLoginDetailsFinalize()`    | `GET /settings/recover-login-details-finalize`      | Recover login details finalize |
| `getLocalUrls()`                   | `GET /settings/local-urls`                          | Get local urls                 |

</details>

<details>
<summary><code>root.shopify</code> (1)</summary>

| Method      | Request                     | Summary |
| ----------- | --------------------------- | ------- |
| `shopify()` | `POST /shopify/synchronize` |         |

</details>

<details>
<summary><code>root.ticket</code> (47)</summary>

| Method                              | Request                                            | Summary                       |
| ----------------------------------- | -------------------------------------------------- | ----------------------------- |
| `postWebhookNewTicket()`            | `POST /ticket/webhook-new-ticket`                  | Webhook to create new tickets |
| `listTickets()`                     | `GET /ticket/list`                                 |                               |
| `getStatistics()`                   | `GET /ticket/statistics`                           |                               |
| `getStatisticsTrends()`             | `GET /ticket/statistics/trends`                    |                               |
| `getHistory()`                      | `GET /ticket/history`                              |                               |
| `exportTickets()`                   | `GET /ticket/export`                               |                               |
| `hasOpenOdooTicket()`               | `GET /ticket/has-open-odoo-ticket`                 |                               |
| `countUnseenChanges()`              | `GET /ticket/unseen-changes-count`                 |                               |
| `countAssignedTickets()`            | `GET /ticket/assigned-ticket-count`                |                               |
| `getTicket()`                       | `GET /ticket/get`                                  |                               |
| `storeTicketCommentOnOpenTicket()`  | `POST /ticket/store-ticket-comment-on-open-ticket` |                               |
| `storeTicket()`                     | `POST /ticket/store`                               |                               |
| `removeTicket()`                    | `POST /ticket/remove`                              |                               |
| `viewedTicket()`                    | `POST /ticket/viewed`                              |                               |
| `createOdooFieldServiceRecord()`    | `POST /ticket/create-odoo-field-service-record`    |                               |
| `getFollowers()`                    | `GET /ticket/followers`                            |                               |
| `addFollower()`                     | `POST /ticket/add-follower`                        |                               |
| `removeFollower()`                  | `POST /ticket/remove-follower`                     |                               |
| `followTicket()`                    | `POST /ticket/follow`                              |                               |
| `unfollowTicket()`                  | `POST /ticket/unfollow`                            |                               |
| `dontKnowCause()`                   | `POST /ticket/dont-know-cause`                     |                               |
| `updateTicketField()`               | `POST /ticket/update-field`                        |                               |
| `liftIgnore()`                      | `POST /ticket/lift-ignore`                         |                               |
| `treatAsIncident()`                 | `POST /ticket/treat-as-incident`                   |                               |
| `listComments()`                    | `GET /ticket/list-comments`                        |                               |
| `storeTicketComment()`              | `POST /ticket/store-comment`                       |                               |
| `updateTicketCommentField()`        | `POST /ticket/update-comment-field`                |                               |
| `removeTicketComment()`             | `POST /ticket/remove-comment`                      |                               |
| `getCommentNotificationAddresses()` | `GET /ticket/comment-notification-addresses`       |                               |
| `listCauses()`                      | `GET /ticket/list-causes`                          |                               |
| `storeTicketCause()`                | `POST /ticket/store-cause`                         |                               |
| `updateTicketCauseField()`          | `POST /ticket/update-cause-field`                  |                               |
| `exportCauses()`                    | `GET /ticket/export-causes`                        |                               |
| `listStatuses()`                    | `GET /ticket/statuses`                             |                               |
| `listPriorities()`                  | `GET /ticket/priorities`                           |                               |
| `listSubjectTypes()`                | `GET /ticket/subject-types`                        |                               |
| `listTicketCauses()`                | `GET /ticket/causes`                               |                               |
| `listSolutions()`                   | `GET /ticket/solutions`                            |                               |
| `listSolutionPriorityContexts()`    | `GET /ticket/solution-priorities/contexts`         |                               |
| `getSolutionPriorities()`           | `GET /ticket/solution-priorities`                  |                               |
| `storeSolutionPriorities()`         | `POST /ticket/solution-priorities`                 |                               |
| `listCreators()`                    | `GET /ticket/creators`                             |                               |
| `listAssignees()`                   | `GET /ticket/assignees`                            |                               |
| `listSupervisors()`                 | `GET /ticket/supervisors`                          |                               |
| `listDeviceOrganisations()`         | `GET /ticket/device-organisations`                 |                               |
| `downloadFile()`                    | `GET /ticket/ticket-file/{ticketId}/{fileId}`      |                               |
| `getNotificationEntities()`         | `GET /ticket/notification-entities`                |                               |

</details>

<details>
<summary><code>root.timeLog</code> (5)</summary>

| Method               | Request                | Summary                             |
| -------------------- | ---------------------- | ----------------------------------- |
| `getTimeLogs()`      | `GET /time-log`        | Get time logs                       |
| `startTimeLog()`     | `POST /time-log`       | Start time logging                  |
| `getActiveTimeLog()` | `GET /time-log/active` | Get active time log                 |
| `listTimeLogs()`     | `POST /time-log/list`  | List time logs                      |
| `updateTimeLog()`    | `PUT /time-log/{id}`   | Change time log (e.g. set end time) |

</details>

<details>
<summary><code>root.twoFactorAuthentication</code> (4)</summary>

| Method                             | Request                                        | Summary |
| ---------------------------------- | ---------------------------------------------- | ------- |
| `generateSecret()`                 | `POST /two-factor-authentication/generate`     |         |
| `enableTwoFactorAuthentication()`  | `POST /two-factor-authentication/enable`       |         |
| `disableTwoFactorAuthentication()` | `POST /two-factor-authentication/disable`      |         |
| `authenticate()`                   | `POST /two-factor-authentication/authenticate` |         |

</details>

<details>
<summary><code>root.user</code> (1)</summary>

| Method      | Request         | Summary  |
| ----------- | --------------- | -------- |
| `getUser()` | `GET /user/get` | Get user |

</details>

### Local API (`hydraloop.local`)

<details>
<summary><code>local.auditTrail</code> (5)</summary>

| Method                       | Request                                      | Summary                            |
| ---------------------------- | -------------------------------------------- | ---------------------------------- |
| `getDeviceAuditTrailByDay()` | `GET /audit-trail/device-audit-trail-by-day` | Lists audit trail for device       |
| `getDeviceAuditTrail()`      | `GET /audit-trail/device-audit-trail`        | Lists audit trail for device       |
| `getUserAuditTrailByDay()`   | `GET /audit-trail/user-audit-trail-by-day`   | Lists audit trail for user         |
| `getUserAuditTrail()`        | `GET /audit-trail/user-audit-trail`          | Lists audit trail for user         |
| `resolveNames()`             | `POST /audit-trail/resolve-names`            | Resolves names for the audit trail |

</details>

<details>
<summary><code>local.cacheSupportLocal</code> (1)</summary>

| Method              | Request                   | Summary                 |
| ------------------- | ------------------------- | ----------------------- |
| `processDelEvent()` | `POST /cache-support/del` | Invalidate device cache |

</details>

<details>
<summary><code>local.connectivity</code> (4)</summary>

| Method                 | Request                              | Summary                                             |
| ---------------------- | ------------------------------------ | --------------------------------------------------- |
| `getEvents()`          | `GET /connectivity/events`           | Gets recent connectivity evidence for a device      |
| `getServerEvents()`    | `GET /connectivity/server-events`    | Gets recent BoardServer lifecycle evidence          |
| `getOutageSummaries()` | `GET /connectivity/outage-summaries` | Gets outage summaries for the graph period          |
| `getIncidents()`       | `GET /connectivity/incidents`        | Gets classified connectivity incidents for a device |

</details>

<details>
<summary><code>local.console</code> (1)</summary>

| Method      | Request                 | Summary          |
| ----------- | ----------------------- | ---------------- |
| `execute()` | `POST /console/execute` | Execute commands |

</details>

<details>
<summary><code>local.debug</code> (3)</summary>

| Method                    | Request                           | Summary                    |
| ------------------------- | --------------------------------- | -------------------------- |
| `getLog()`                | `GET /debug/log`                  | Get debug log of device    |
| `postExecuteCommands()`   | `POST /debug/execute-commands`    | Execute commands on device |
| `postRefreshPublicData()` | `POST /debug/refresh-public-data` | Refreshes the public data  |

</details>

<details>
<summary><code>local.deviceDashboard</code> (1)</summary>

| Method           | Request                            | Summary                   |
| ---------------- | ---------------------------------- | ------------------------- |
| `getLocalData()` | `GET /device-dashboard/local-data` | Get device dashboard data |

</details>

<details>
<summary><code>local.deviceSyncRoot</code> (2)</summary>

| Method          | Request                          | Summary              |
| --------------- | -------------------------------- | -------------------- |
| `syncDevices()` | `POST /device-sync-root/devices` | Sync devices         |
| `syncDevice()`  | `POST /device-sync-root/device`  | Sync singular device |

</details>

<details>
<summary><code>local.dynamicGraphSettings</code> (1)</summary>

| Method   | Request                             | Summary |
| -------- | ----------------------------------- | ------- |
| `sync()` | `POST /dynamic-graph-settings/sync` |         |

</details>

<details>
<summary><code>local.ecuSimulator</code> (8)</summary>

| Method          | Request                             | Summary                                                                            |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `list()`        | `GET /ecu-simulator/list`           | List ECU simulator instances, including orphaned simulator devices                 |
| `spawn()`       | `POST /ecu-simulator/spawn`         | Spawn a new ECU simulator instance (only an alias is needed)                       |
| `stop()`        | `POST /ecu-simulator/{id}/stop`     | Stop an ECU simulator instance, or kill the stray process of an orphaned one       |
| `setSpeed()`    | `POST /ecu-simulator/{id}/speed`    | Change the simulation speed of an instance                                         |
| `setScenario()` | `POST /ecu-simulator/{id}/scenario` | Change the simulation scenario of an instance                                      |
| `restart()`     | `POST /ecu-simulator/{id}/restart`  | Restart an ECU simulator instance                                                  |
| `remove()`      | `DELETE /ecu-simulator/{id}`        | Remove an ECU simulator instance completely (process, files, device + ECU records) |
| `logs()`        | `GET /ecu-simulator/{id}/logs`      | Tail the log of an ECU simulator instance                                          |

</details>

<details>
<summary><code>local.externalIo</code> (2)</summary>

| Method                  | Request                           | Summary                                                            |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `postDynamicInput()`    | `POST /external-io/dynamic-input` | Insert a batch of dynamic graph measurements directly by type UUID |
| `postAddNewInputData()` | `POST /external-io/input`         | Add input data from external source                                |

</details>

<details>
<summary><code>local.fileStore</code> (2)</summary>

| Method           | Request                         | Summary |
| ---------------- | ------------------------------- | ------- |
| `storeFile()`    | `POST /file-store/upload`       |         |
| `downloadFile()` | `GET /file-store/download/{id}` |         |

</details>

<details>
<summary><code>local.fsm</code> (3)</summary>

| Method               | Request                   | Summary                                 |
| -------------------- | ------------------------- | --------------------------------------- |
| `submitChoice()`     | `POST /fsm/submit-choice` | Submit choice                           |
| `clearStale()`       | `POST /fsm/clear-stale`   | Clear Stale                             |
| `getInstanceState()` | `GET /fsm/instance-state` | Get the current state of a FSM instance |

</details>

<details>
<summary><code>local.graph</code> (21)</summary>

| Method                       | Request                               | Summary                                                                                                   |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `getGraphConfig()`           | `GET /graph/config`                   | Retrieves graph config for a specific device                                                              |
| `getData()`                  | `GET /graph/data`                     | Retrieves graph data in a specific period                                                                 |
| `getDynamicData()`           | `GET /graph/dynamic-data`             | Retrieves available dynamic graph lines and data in a specific period                                     |
| `getIo()`                    | `GET /graph/io`                       | Retrieves io data in a specific period                                                                    |
| `getRoutineData()`           | `GET /graph/routines`                 | Retrieves routine data in a specific period                                                               |
| `calculateJumpTo()`          | `POST /graph/jump-to`                 | Calculate jump to date                                                                                    |
| `getStatusLogData()`         | `GET /graph/status-log`               | Retrieves status log data in a specific period                                                            |
| `getWaterRecycledData()`     | `GET /graph/water-recycled`           | Retrieves water recycled data in a specific period                                                        |
| `getIncomingWaterData()`     | `GET /graph/incoming-water`           | Retrieves incoming water data in a specific period                                                        |
| `getPowerUsageData()`        | `GET /graph/power-usage`              | Retrieves power usage data in a specific period                                                           |
| `getE2eFixtureWindowAudit()` | `GET /graph/e2e-fixture-window-audit` | Retrieves the e2e fixture window audit net (the newest io_data in-window writes with the writer identity) |
| `getIoNamesSensorOnly()`     | `GET /graph/io-names-sensor-only`     | Retrieves the io names which are a sensor                                                                 |
| `getLastKnownIoState()`      | `GET /graph/last-io`                  | Retrieves the last know io state                                                                          |
| `getManualIoAccess()`        | `GET /graph/manual-io-access`         | Check whether manual IO control is currently allowed                                                      |
| `setIoManual()`              | `POST /graph/io-manual`               | Set io manual state                                                                                       |
| `setIoValue()`               | `POST /graph/io-value`                | Set io value state                                                                                        |
| `setActiveHeartBeat()`       | `POST /graph/active-heart-beat`       | Set active heart beat                                                                                     |
| `getDeviceDateRange()`       | `GET /graph/device-date-range`        | Retrieves the date of the first and de last log data of the device                                        |
| `getDeviceLevels()`          | `GET /graph/device-levels`            | Retrieves the device levels                                                                               |
| `getOptions()`               | `GET /graph/export/options`           | Lists available device export fields                                                                      |
| `export()`                   | `POST /graph/export`                  | Exports selected device data to Excel for at most one month                                               |

</details>

<details>
<summary><code>local.graphImport</code> (2)</summary>

| Method      | Request                      | Summary |
| ----------- | ---------------------------- | ------- |
| `preview()` | `POST /graph/import/preview` |         |
| `import()`  | `POST /graph/import`         |         |

</details>

<details>
<summary><code>local.hdmLocal</code> (4)</summary>

| Method         | Request            | Summary                         |
| -------------- | ------------------ | ------------------------------- |
| `get()`        | `GET /`            | Redirect to API documentation   |
| `ping()`       | `GET /ping`        | Ping endpoint for health checks |
| `loadFiles()`  | `GET /load-files`  |                                 |
| `loadImport()` | `GET /load-import` |                                 |

</details>

<details>
<summary><code>local.health</code> (1)</summary>

| Method    | Request       | Summary |
| --------- | ------------- | ------- |
| `check()` | `GET /health` |         |

</details>

<details>
<summary><code>local.ioOnTime</code> (1)</summary>

| Method           | Request                | Summary                    |
| ---------------- | ---------------------- | -------------------------- |
| `listIoOnTime()` | `GET /io-on-time/list` | Lists the on time of an IO |

</details>

<details>
<summary><code>local.kiosk</code> (4)</summary>

| Method                        | Request                                          | Summary                                                   |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `getKioskData()`              | `GET /kiosk/data`                                | Get statistics kiosk data                                 |
| `getKioskDataInit()`          | `GET /kiosk/data-daily`                          | Get statistics kiosk data                                 |
| `getWaterRecycledData()`      | `GET /kiosk/water-recycled-last-week-per-device` | Get statistics kiosk data                                 |
| `getWaterRecycledTodayData()` | `GET /kiosk/water-recycled-today-per-device`     | Get per-device water recycled today (for the kiosk top-3) |

</details>

<details>
<summary><code>local.logData</code> (5)</summary>

| Method                     | Request                             | Summary                                                     |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `store()`                  | `POST /log-data/store`              | Stores log data                                             |
| `storeDeviceOnline()`      | `POST /log-data/online`             |                                                             |
| `storeDeviceOffline()`     | `POST /log-data/offline`            |                                                             |
| `storeConnectivityEvent()` | `POST /log-data/connectivity-event` | Stores a structured connectivity event                      |
| `storeDeviceProgress()`    | `POST /log-data/device-progress`    | Stores device progress (firmware upload or settings update) |

</details>

<details>
<summary><code>local.logDataExternal</code> (1)</summary>

| Method               | Request                                | Summary |
| -------------------- | -------------------------------------- | ------- |
| `storeDevicePower()` | `POST /log-data-external/device-power` |         |

</details>

<details>
<summary><code>local.logging</code> (2)</summary>

| Method               | Request             | Summary |
| -------------------- | ------------------- | ------- |
| `storeLogging()`     | `POST /logging/log` |         |
| `getDeviceLogging()` | `GET /logging/log`  |         |

</details>

<details>
<summary><code>local.maintenance</code> (12)</summary>

| Method                           | Request                                              | Summary                             |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------- |
| `list()`                         | `GET /maintenance/list-actions`                      | List maintenance actions            |
| `forceUpload()`                  | `POST /maintenance/force-upload`                     | Force firmware upload               |
| `restartDevice()`                | `POST /maintenance/restart-device`                   | Restart device                      |
| `updateDeviceSettingsIfNeeded()` | `POST /maintenance/update-device-settings-if-needed` | Update device settings if needed    |
| `resetWifi()`                    | `POST /maintenance/reset-wifi`                       | Reset WIFI                          |
| `startAction()`                  | `POST /maintenance/start-action`                     | Start Maintenance Action            |
| `versionRead()`                  | `POST /maintenance/version-read`                     | Read firmware version               |
| `restartWifi()`                  | `POST /maintenance/restart-wifi`                     | Request wifi restart                |
| `requestWifiRssi()`              | `POST /maintenance/request-wifi-rssi`                | Request Wifi RSSI - Signal strength |
| `getPossibleBranches()`          | `GET /maintenance/possible-branches`                 | Get possible branches of device     |
| `getStatusLog()`                 | `GET /maintenance/status-log`                        | Get status log of device            |
| `listStatusLog()`                | `GET /maintenance/list-status-log`                   |                                     |

</details>

<details>
<summary><code>local.performanceDiagnostics</code> (1)</summary>

| Method             | Request                        | Summary                                                            |
| ------------------ | ------------------------------ | ------------------------------------------------------------------ |
| `getDiagnostics()` | `GET /performance-diagnostics` | Get current local performance diagnostics and recent abnormalities |

</details>

<details>
<summary><code>local.randomData</code> (2)</summary>

| Method                  | Request                    | Summary            |
| ----------------------- | -------------------------- | ------------------ |
| `getInsertRandomData()` | `GET /random-data/insert`  | Insert random data |
| `setInsertRandomData()` | `POST /random-data/insert` | Insert random data |

</details>

<details>
<summary><code>local.rootConnect</code> (8)</summary>

| Method                            | Request                                           | Summary                                                      |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `storeDeviceProgress()`           | `GET /root-connect/device`                        | Get device                                                   |
| `getDeviceByMac()`                | `GET /root-connect/device-by-mac`                 | Get device by its ECU MAC address (with device attributes)   |
| `getEcuById()`                    | `GET /root-connect/ecu-by-id`                     | Get ECU by its id                                            |
| `getDeviceNeedsSettingsUpdated()` | `GET /root-connect/device-needs-settings-updated` | Get whether the device needs its settings updated            |
| `restartDevice()`                 | `POST /root-connect/restart-device`               | Restart the device through HDMConnect                        |
| `changeEcu()`                     | `POST /root-connect/change-ecu`                   | Change the ECU of a device (by MAC address) through HDMRoot  |
| `setTargetBranch()`               | `POST /root-connect/set-target-branch`            | Set the device target branch                                 |
| `getForceUploadState()`           | `GET /root-connect/force-upload-state`            | Get the force-upload state of the device (fase-1 Redis flag) |

</details>

<details>
<summary><code>local.serverActivity</code> (2)</summary>

| Method           | Request                                 | Summary                                            |
| ---------------- | --------------------------------------- | -------------------------------------------------- |
| `getActivity()`  | `GET /server-activity`                  | Get local FSM and manual IO activity               |
| `forceStopFsm()` | `POST /server-activity/fsms/force-stop` | Emergency force-stop a parent FSM and its children |

</details>

<details>
<summary><code>local.settings</code> (29)</summary>

| Method                             | Request                                      | Summary                                                             |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `listPossibleSettings()`           | `GET /settings/list`                         | Lists possible settings                                             |
| `getLastKnownSettings()`           | `GET /settings/last`                         | Get last know setting values                                        |
| `getLastKnownSpecificSetting()`    | `GET /settings/last-specific`                | Get last known setting values from specific settings                |
| `getLastKnownDistPumpSetting()`    | `GET /settings/last-dist-pump-settings`      | Get last known distribution pump setting value                      |
| `refreshDistPumpSettings()`        | `POST /settings/refresh-dist-pump-settings`  | Refresh distribution pump setting value from device                 |
| `changeDistPumpSetting()`          | `POST /settings/change-dist-pump-setting`    | Change the distribution pump speed setting of a Hydraloop           |
| `getLastKnownPrioritySetting()`    | `GET /settings/last-priority-setting`        | Get last known priority setting value                               |
| `refreshPrioritySetting()`         | `POST /settings/refresh-priority-setting`    | Refresh priority setting value from device                          |
| `changePrioritySetting()`          | `POST /settings/change-priority-setting`     | Change the priority setting of a Hydraloop                          |
| `getTankTreatmentState()`          | `GET /settings/tank-treatment-state`         | Get cleaning limits and timestamped treatment timers for tank menus |
| `getLastKnownStateSettings()`      | `GET /settings/last-state-settings`          | Get last known state setting values                                 |
| `refreshStateSettings()`           | `POST /settings/refresh-state-settings`      | Refresh state setting values from device                            |
| `updateDeviceSetting()`            | `POST /settings/update-device-setting`       |                                                                     |
| `getLastKnownSettingsBeforeDate()` | `GET /settings/last-before-date`             | Get last known setting values before date                           |
| `changeSystemActive()`             | `POST /settings/change-system-active`        | Change the Hydraloop system active setting                          |
| `changeFactoryState()`             | `POST /settings/change-factory-state`        | Change the Hydraloop factory state setting                          |
| `changeRecycleAfterDate()`         | `POST /settings/change-recycle-after-date`   | Change the Hydraloop recycle after date setting                     |
| `changeSoapBombActive()`           | `POST /settings/change-soap-bomb-active`     | Change the Hydraloop soap bomb setting                              |
| `getSimulationScenario()`          | `GET /settings/simulation-scenario`          | Get the ECU-simulator scenario of a simulator device                |
| `changeSimulationScenario()`       | `POST /settings/simulation-scenario`         | Change the ECU-simulator scenario of a simulator device             |
| `changeSetting()`                  | `POST /settings/change`                      | Change a Hydraloop device setting                                   |
| `refreshSetting()`                 | `POST /settings/refresh`                     | Ask Hydraloop device to send the setting                            |
| `getHistory()`                     | `GET /settings/history`                      | List value history of setting                                       |
| `requestAppAuthorisation()`        | `POST /settings/request-app-authentication`  | Request App Authentication                                          |
| `migrateEcuData()`                 | `POST /settings/migrate-ecu-data`            | Migrate ECU data                                                    |
| `changeBypassMode()`               | `POST /settings/change-bypass-mode`          | Change bypass mode (activate/deactivate bleach or hair dye mode)    |
| `changeBuzzerSetting()`            | `POST /settings/change-buzzer-setting`       | change buzzer setting                                               |
| `changeWashingMachineMode()`       | `POST /settings/change-washing-machine-mode` | Change washing machine mode (backup water usage)                    |
| `changeOperationMode()`            | `POST /settings/change-operation-mode`       | Change washing machine mode (backup water usage)                    |

</details>

<details>
<summary><code>local.usbConnect</code> (2)</summary>

| Method          | Request                     | Summary                                                                          |
| --------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `getLog()`      | `GET /usb-connect/log`      | Get the stored USB Connect console history of a device (on demand, newest first) |
| `getSessions()` | `GET /usb-connect/sessions` | Get the USB Connect sessions of a device, newest first (HDM-84)                  |

</details>

<details>
<summary><code>local.usbConnectFirmware</code> (1)</summary>

| Method                 | Request                             | Summary                                                           |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `getFirmwareUpdates()` | `GET /usb-connect/firmware-updates` | List the USB firmware updates of the device (audit, newest first) |

</details>

<details>
<summary><code>local.user</code> (1)</summary>

| Method      | Request         | Summary  |
| ----------- | --------------- | -------- |
| `getUser()` | `GET /user/get` | Get user |

</details>

<!-- END GENERATED METHODS -->

## All socket messages

The rooms and messages of the [socket API](#real-time-messages), from [`spec/socket/asyncapi.json`](spec/socket/asyncapi.json). "Observed" means the message was seen with an owner account. The payloads of the other messages are taken from how the HDM web app uses them. Rooms the account has no permission for send nothing.

<!-- BEGIN GENERATED SOCKET MESSAGES -->

#### `graph`

Live graph values, valves and routines, used by the graph of the HDM web app. Device socket.

| Message               | Payload               | Summary                                                    | Observed |
| --------------------- | --------------------- | ---------------------------------------------------------- | -------- |
| `graph:graph`         | `GraphMessage`        | The latest value of each graph line, about every 3 seconds | yes      |
| `graph:io`            | `IoMessage`           | A valve, pump or sensor changed, within about 0.1 seconds  | yes      |
| `graph:routine`       | `RoutineMessage`      | A routine or sub-state of a train changed                  | yes      |
| `graph:restart`       | `RestartPoint`        | The device controller restarted                            | yes      |
| `graph:dynamic-graph` | `DynamicGraphMessage` | New values of dynamic graph lines                          | no       |

#### `device-state`

Settings the device reports, e.g. the time left of filth removal. Device socket.

| Message                      | Payload        | Summary                       | Observed |
| ---------------------------- | -------------- | ----------------------------- | -------- |
| `device-state:setting-value` | `SettingValue` | The device reported a setting | yes      |

#### `device-status`

Whether the device is connected to HDM. Device socket.

| Message                 | Payload       | Summary                                                          | Observed |
| ----------------------- | ------------- | ---------------------------------------------------------------- | -------- |
| `device-status:online`  | `EmptyObject` | The device connected to HDM                                      | yes      |
| `device-status:offline` | `EmptyObject` | The device disconnected from HDM, e.g. for its scheduled restart | yes      |

#### `maintenance`

The status log. Device socket.

| Message                        | Payload          | Summary                                                                                  | Observed |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------- | -------- |
| `maintenance:status-log-entry` | `StatusLogEntry` | A new entry of the status log, e.g. a device signal or a step of a maintenance procedure | no       |

#### `output-priorities`

The priorities of the outlets. Device socket.

| Message                           | Payload        | Summary                                                   | Observed |
| --------------------------------- | -------------- | --------------------------------------------------------- | -------- |
| `output-priorities:setting-value` | `SettingValue` | The `prioritySettings` setting (group 100, id 53) changed | no       |

#### `settings`

Device settings, for the settings page of the HDM web app. Device socket.

| Message                  | Payload        | Summary                  | Observed |
| ------------------------ | -------------- | ------------------------ | -------- |
| `settings:setting-value` | `SettingValue` | A device setting changed | no       |

#### `fsm`

State machines of the device, e.g. maintenance procedures. Device socket.

| Message          | Payload         | Summary                           | Observed |
| ---------------- | --------------- | --------------------------------- | -------- |
| `fsm:transition` | `FsmTransition` | A state machine changed its state | no       |

#### `device-progress`

Firmware uploads. Device socket.

| Message                    | Payload          | Summary                                                                                       | Observed |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------- | -------- |
| `device-progress:progress` | `DeviceProgress` | Progress of a firmware upload. Also sent with percentage -1 when the device comes back online | yes      |

#### `logging`

The device log. Device socket.

| Message         | Payload        | Summary                      | Observed |
| --------------- | -------------- | ---------------------------- | -------- |
| `logging:entry` | `LoggingEntry` | A new line of the device log | no       |

#### `dashboard`

The device dashboard of the HDM web app. Needs permissions owners don't have. Device socket.

| Message                          | Payload                 | Summary                            | Observed |
| -------------------------------- | ----------------------- | ---------------------------------- | -------- |
| `dashboard:graph-data`           | `GraphMessage`          | Same as `graph:graph`              | no       |
| `dashboard:io-data`              | `IoMessage`             | Same as `graph:io`                 | no       |
| `dashboard:routine`              | `RoutineMessage`        | Same as `graph:routine`            | no       |
| `dashboard:setting-value`        | `SettingValue`          | A setting the device reported      | no       |
| `dashboard:time-left-recycling`  | `TimeLeftRecyclingList` | Minutes of cleaning left per train | no       |
| `dashboard:latest-device-task`   | `DeviceTaskList`        | What each train does               | no       |
| `dashboard:recycle-statistics`   | `RecycleStatistics`     | Recycled water totals              | no       |
| `dashboard:firmware-upload-data` | `DeviceProgress`        | Progress of a firmware upload      | no       |

#### `notifications`

Notifications for the owner, e.g. of a leaking toilet. Notifications socket, not supported by `subscribe()`.

| Message              | Payload            | Summary                                           | Observed |
| -------------------- | ------------------ | ------------------------------------------------- | -------- |
| `notifications:new`  | `Notification`     | A new notification                                | no       |
| `notifications:list` | `NotificationList` | The current notifications, sent after registering | no       |

#### `time-log`

Time logs of Hydraloop employees. Person socket, not supported by `subscribe()`.

| Message           | Payload   | Summary                     | Observed |
| ----------------- | --------- | --------------------------- | -------- |
| `time-log:update` | `TimeLog` | A time log started or ended | no       |

#### `communication`

Video calls of the HDM web app. Person socket, not supported by `subscribe()`.

| Message                      | Payload           | Summary                                                                                                       | Observed |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `communication:in-call`      | `CallParticipant` | Someone joined a call                                                                                         | no       |
| `communication:out-call`     | `CallParticipant` | Someone left a call                                                                                           | no       |
| `communication:refresh-call` | `CallRefresh`     | The participants of calls should be sent again. Sent every few minutes while someone has the HDM web app open | yes      |

<!-- END GENERATED SOCKET MESSAGES -->

## License

[ISC](license)
