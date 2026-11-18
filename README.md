# parkaad

Node.js client for the [Parkaad](https://parkaad.com) partner API.

Make a station for each of your customers' streaming servers, and get back a **studio link**
(`https://parkaad.com/live/<id>`) to send their DJ. The DJ opens it in Google Chrome and goes on
air — no sign-up, no server settings. The server's password stays with Parkaad; the link is
just a random id.

- No dependencies. Node.js 22 or later.
- Types included.
- Full API reference (Thai): [parkaad.com/partners](https://parkaad.com/partners)

## Install

```sh
npm install github:code7551/parkaad-js
```

(Once it's published to npm: `npm install parkaad`.)

## Use

You get an **API key** (`pk_….<secret>`) from the Parkaad team. Keep it on your server — in an
environment variable or a secret manager — never in a web page or an app.

```js
import { Parkaad } from "parkaad";

const parkaad = new Parkaad({ apiKey: process.env.PARKAAD_API_KEY });

const station = await parkaad.stations.create({
  reference: "customer-123", // your own id for it (optional)
  station: { name: "Radio Example 95.5", website: "https://radio.example.com" },
  server: {
    type: "icecast", // "icecast" | "shoutcast2" | "shoutcast1"
    host: "stream.example.com",
    port: 8000,
    mount: "/live", // Icecast only
    password: process.env.ICECAST_SOURCE_PASSWORD,
  },
});

console.log(station.url); // https://parkaad.com/live/k7Qm2XbP9wZr — send this to the DJ
```

`apiKey` defaults to the `PARKAAD_API_KEY` environment variable.

### One station per server

A station is one streaming server (host + port), and it has one link. Calling `create` again for
a server you already have updates its name, details and password, and keeps the link:
`station.created` is `false` then.

### List, get, delete

```js
const { stations, limit } = await parkaad.stations.list(); // newest first
const one = await parkaad.stations.get(station.id);
await parkaad.stations.delete(station.id); // the link stops working at once
```

### A new link

If a link leaks, or the station gets a new DJ, give it a new link — the old one stops working:

```js
const renewed = await parkaad.stations.renewLink(station.id, input);
```

This deletes the station and makes it again from `input` (the API never gives a password back,
so the station's details have to come from you).

## Errors

Every failure is a `ParkaadError` with a `code` (and `status` when the API answered):

| `code`               | When                                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| `invalid_request`    | Something in the station is missing or wrong — `message` says what     |
| `unauthorized`       | No API key, a wrong one, or one that was revoked or replaced            |
| `partner_suspended`  | Your partner account is suspended                                       |
| `host_not_allowed`   | That server isn't on your allowed list: ask the Parkaad team            |
| `not_found`          | No such station (or it was deleted)                                     |
| `station_limit`      | You have all the stations you may have: delete one first                |
| `network`, `timeout` | Parkaad couldn't be reached                                             |
| `blocked`            | Something in between (a proxy or firewall) answered instead of the API  |

```js
import { Parkaad, ParkaadError } from "parkaad";

try {
  await parkaad.stations.create(input);
} catch (err) {
  if (err instanceof ParkaadError && err.code === "station_limit") {
    // …
  }
  throw err;
}
```

## Options

```js
new Parkaad({
  apiKey: "pk_….<secret>", // default: PARKAAD_API_KEY
  baseUrl: "https://parkaad.com",
  timeoutMs: 15000, // per request
  fetch, // default: the global fetch
});
```

The library refuses to run in a browser: the API key can make and delete stations, and anything
in a web page can be read.

## Security

- The API key is for your server only. If it leaks, tell the Parkaad team (they revoke it) and
  give **every** station a new link — whoever had the key could have listed them.
- A studio link lets whoever has it broadcast to that server: send it to the DJ privately.
- Use a separate source password for each station.

## License

MIT
