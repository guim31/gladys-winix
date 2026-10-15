# Winix for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that controls **Winix connected air purifiers** (C545, C610, AM90, T810,
5500-2 Wi-Fi, Tower…) through the Winix cloud, the one of the Winix Smart app.

> **Developed without the hardware: feedback welcome.** The integration
> speaks the protocol described by the open-source Winix projects (see
> [Credits](#credits)) and is tested against their real answers, but it has
> not been run against a real purifier nor a real Winix account yet. Please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-winix/issues).

This project is **not affiliated with Winix**. Winix and PlasmaWave are
trademarks of their owner.

## Features

- **One device per air purifier** of the Winix account, named as in the app:
  - **Power**, **Mode** (Auto, Manual, Sleep), **Fan speed** (0 sleep, 1 low,
    2 medium, 3 high, 4 turbo, 5 Super Clean on the Tower Prime) and
    **Plasmawave**: all controllable, from the dashboard and from scenes;
  - **Air pollution**: the Winix color ring (good, fair, poor, very poor) on
    the 0-3 risk scale of Gladys, colored like the ring;
  - **PM2.5** (µg/m³) and **ambient light** on the models with those sensors;
  - **Filter life** (%) and **filter hours left**;
  - **Online**: whether the Winix cloud has news of the purifier.
- **Dashboard widget** "Winix purifier": live PM2.5 and filter, mode, air
  quality and filter hours of one purifier, with **Auto**, **Manual**,
  **Sleep** and **Turn off** buttons (**Turn on** when it is off).
- A connection status in the Configuration screen that says what is wrong
  (password refused, password to reset, Winix cloud down, rate limit).
- Every text in English, French, German and Spanish.

No scene trigger nor scene action: the features already serve the scenes
(a "filter to replace" is the threshold _Filter life ≤ 5 %_, fired once when
crossed).

## Requirements

- Gladys Assistant **5.1.0** or later (dashboard widget).
- A Winix Wi-Fi air purifier set up in the **Winix Smart** app, and the
  e-mail address and password of that account. Winix dehumidifiers and air
  conditioners are not supported (ignored).
- Internet access from Gladys: there is no local API.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-winix`
   (or install **Winix** from the catalog once it is listed).
2. In **Configuration**, enter the e-mail address and the password of the
   Winix account; pick the refresh interval (1 to 5 minutes, 2 by default)
   and the language of the feature names. Save.
3. Open the **Discover** tab and add the purifiers.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Sign-in**: AWS Cognito (`us-east-1_Ofd50EosD`, the public app client of
  Winix Smart 1.5.7, rotated by Winix on 2026-04-16), with the **SRP**
  exchange written on `node:crypto` and `BigInt` — no AWS SDK, the password
  never leaves the container. Then the Cognito identity id (identity pool),
  and the handshake of the mobile API (`registerUser`, `init`,
  `checkAccessToken`), whose bodies are AES-256-CBC encrypted with the key of
  the app.
- **Listing**: `getDeviceInfoList` (mobile API) gives the purifiers;
  `getAllModelGroupInfoList` the filter life of each model.
- **Reading and control** go through `us.api.winix-iot.com`: the state needs
  only the device id, a command the device id and the identity id. Neither
  needs the mobile session, which Winix keeps **one per account** (a new
  sign-in logs the phone app out, and the other way round, result code 900
  "MULTI LOGIN"). So the integration opens a session only to list the
  purifiers (first start, scan), and keeps the refresh token, the identity id
  and the list in `/data/winix-session.json` (mode 600): a restart does not
  sign in again, and the phone taking the session back does not stop Gladys.
- **Tokens**: an access token close to expiry is refreshed; a refused refresh
  (expired or revoked) falls back to a sign-in with the configured password; a
  refused password stops every sign-in until the credentials change in the
  configuration, so as not to lock the account. The status says which.
- **Refresh**: the container reads each purifier added to Gladys every 1 to
  5 minutes, one after the other, with its own timer (the core may never poll
  an external device, GladysAssistant/Gladys#3198); the core's `onPoll` (every
  minute) is a fallback that never doubles a read. Only the values that
  changed are published, every value again at least every 6 hours. After a
  command, the purifier is read again 5 seconds later.
- **Quotas**: Winix publishes no API nor quota. The device API answers a
  burst with HTTP 403/429 for about a minute: the integration then waits
  60 seconds. A command answered 500/503 is retried once.
- **Logs**: nothing at the info level for a normal cycle; one line when a
  purifier goes offline or comes back, when the cloud fails or recovers, and
  per user command. `LOG_LEVEL=debug` shows each reading. No token, password,
  e-mail or identity id ever reaches the logs (a test checks it).

## What was checked, and what was not

- Checked here: the whole integration against the SDK's fake Gladys and a
  fake Winix cloud that verifies the SRP signature like Cognito, keeps one
  mobile session per account and serves the real answers published by the
  Winix projects (`test/fixtures/winix/`); the store validator; and, against
  the **real Cognito**, that the user pool and the app client of 2026 answer
  a fake account with `UserNotFoundException` (`scripts/probe.mjs`).
- Not checked: a real Winix account and purifier, the encrypted mobile API
  and the device API (unreachable from the development sandbox). Run
  `node scripts/probe.mjs` from a machine with Internet access: it goes
  through the real endpoints with a fake account until each refusal, read
  only, without printing anything sensitive.

## Development

```bash
npm ci
npm run format:check   # Prettier (code and Markdown)
npm run lint           # ESLint
npm test               # node --test, against the SDK's fake Gladys and a fake Winix cloud
node scripts/probe.mjs # the real Winix cloud with a fake account (needs Internet)
npx -y github:GladysAssistant/integration-store . --skip-image-check   # store checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="winix" \
WINIX_DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

Versions are published by the **Release** workflow (Actions → Release); see
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

The Winix cloud protocol was reverse-engineered by others; this integration
re-implements it in JavaScript from their work:

- [hfern/winix](https://github.com/hfern/winix) by Hunter Fernandes (MIT):
  the first Winix client, attribute codes and the client uuid scheme.
- [iprak/winix](https://github.com/iprak/winix) by Indu Prakash (MIT), the
  Home Assistant integration: the 2026 Cognito client, the encrypted mobile
  API, the session handshake, the model filter life table and the sample
  answers reused as test fixtures.
- [regaw-leinad/winix-api](https://github.com/regaw-leinad/winix-api), the
  client of homebridge-winix-purifiers, read to understand the session
  invalidation, the rate limit and the result codes (no code copied: the
  repository has no license).
- The SRP computation follows the algorithm of the AWS Amplify
  `AuthenticationHelper` (Apache-2.0).

## License

[Apache-2.0](LICENSE).
