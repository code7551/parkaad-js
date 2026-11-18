// Parkaad partner API client for Node.js: make, list and delete stations, and get the studio
// link (parkaad.com/live/<id>) to hand each station's DJ. No dependencies.
// The API itself is documented at https://parkaad.com/partners.

export const VERSION = "0.1.0";

const DEFAULT_BASE_URL = "https://parkaad.com";
const DEFAULT_TIMEOUT_MS = 15_000;
/** <Key ID>.<Secret>, as the Parkaad team hands it out. */
const API_KEY_RE = /^pk_[A-Za-z0-9]{16,40}\.[A-Za-z0-9_-]{43}$/;

/** What went wrong with a call: the API's own error code, or one of ours (network, timeout…). */
export class ParkaadError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, status?: number | null, cause?: unknown }} details
   */
  constructor(message, { code, status = null, cause }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ParkaadError";
    /** The API's error code ("unauthorized", "station_limit"…) or "network", "timeout", "blocked", "invalid_response". */
    this.code = code;
    /** The HTTP status, when the API answered. */
    this.status = status;
  }
}

/** The partner API. One instance per API key; safe to share. */
export class Parkaad {
  #apiKey;
  #baseUrl;
  #timeoutMs;
  #fetch;

  /**
   * @param {{
   *   apiKey?: string,
   *   baseUrl?: string,
   *   timeoutMs?: number,
   *   fetch?: typeof globalThis.fetch,
   *   dangerouslyAllowBrowser?: boolean,
   * }} [options]
   */
  constructor({
    apiKey = globalThis.process?.env?.PARKAAD_API_KEY,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetch = globalThis.fetch,
    dangerouslyAllowBrowser = false,
  } = {}) {
    // An API key in a web page is a key anyone can read: it makes and deletes stations.
    if (typeof window !== "undefined" && typeof document !== "undefined" && !dangerouslyAllowBrowser) {
      throw new ParkaadError("The Parkaad API key belongs on your server: don't use this library in a browser", { code: "browser" });
    }
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!API_KEY_RE.test(key)) {
      throw new ParkaadError("Pass your Parkaad API key (pk_….<secret>) as apiKey, or set PARKAAD_API_KEY", { code: "invalid_api_key" });
    }
    if (typeof fetch !== "function") throw new ParkaadError("No fetch available: use Node.js 22 or later", { code: "no_fetch" });
    this.#apiKey = key;
    this.#baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetch;
    /** The partner's stations, each with its studio link. */
    this.stations = new Stations((method, path, body) => this.#request(method, path, body));
  }

  /**
   * @param {"GET" | "POST" | "DELETE"} method
   * @param {string} path under /api/partner/v1
   * @param {unknown} [body]
   * @returns {Promise<{ status: number, data: any }>}
   */
  async #request(method, path, body) {
    let response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/api/partner/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          accept: "application/json",
          "user-agent": `parkaad-node/${VERSION}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === "TimeoutError";
      throw new ParkaadError(timedOut ? `No answer from Parkaad within ${this.#timeoutMs} ms` : `Couldn't reach Parkaad: ${err?.message ?? err}`, {
        code: timedOut ? "timeout" : "network",
        cause: err,
      });
    }

    if (response.status === 204) return { status: 204, data: null };
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: something in between answered (a proxy's error or challenge page).
    }
    if (!response.ok) {
      if (data && typeof data.error === "string") {
        throw new ParkaadError(typeof data.message === "string" ? data.message : data.error, { code: data.error, status: response.status });
      }
      throw new ParkaadError(`HTTP ${response.status} from something in front of Parkaad (a proxy or firewall), not the API`, {
        code: "blocked",
        status: response.status,
      });
    }
    if (data === null) throw new ParkaadError("Parkaad's answer wasn't JSON", { code: "invalid_response", status: response.status });
    return { status: response.status, data };
  }
}

/** POST / GET / DELETE /stations. */
class Stations {
  #request;

  /** @param {(method: "GET" | "POST" | "DELETE", path: string, body?: unknown) => Promise<{ status: number, data: any }>} request */
  constructor(request) {
    this.#request = request;
  }

  /**
   * Makes a station with a new studio link — or, for a server (host + port) you already have a
   * station on, updates it (name, details, password) and keeps its link: `created` says which.
   */
  async create(input) {
    const { status, data } = await this.#request("POST", "/stations", input);
    return { ...data, created: status === 201 };
  }

  /** Every station, newest first, and how many you may have. */
  async list() {
    return (await this.#request("GET", "/stations")).data;
  }

  /** One station, by the id `create` gave it. Throws `not_found` if there's no such station. */
  async get(id) {
    return (await this.#request("GET", `/stations/${encodeURIComponent(id)}`)).data;
  }

  /** Deletes a station: its link stops working at once (a show on it ends within 30 s). */
  async delete(id) {
    await this.#request("DELETE", `/stations/${encodeURIComponent(id)}`);
  }

  /**
   * A new link for a station (the old one stops working): deletes it and makes it again from
   * `input` — the API never gives the server password back, so it has to come from you. A
   * station that's already gone is simply made again.
   */
  async renewLink(id, input) {
    try {
      await this.delete(id);
    } catch (err) {
      if (!(err instanceof ParkaadError && err.code === "not_found")) throw err;
    }
    return this.create(input);
  }
}
