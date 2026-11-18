// Types for the Parkaad partner API client (src/index.js). The API: https://parkaad.com/partners

export declare const VERSION: string;

/** The streaming server software. */
export type ServerType = "icecast" | "shoutcast1" | "shoutcast2";

/** A station as you send it: what listeners see, and the server the DJ broadcasts to. */
export interface StationInput {
  /** Your own id for it (customer or order number): up to 128 characters, no spaces. */
  reference?: string | null;
  station: {
    /** Up to 80 characters: shown in the studio, and the stream name listeners see. */
    name: string;
    /** http:// or https:// */
    website?: string;
    /** Up to 60 characters. */
    genre?: string;
    /** Up to 300 characters. */
    description?: string;
  };
  server: {
    type: ServerType;
    /** Domain name or IPv4 address, without http:// or a port. */
    host: string;
    /** SHOUTcast v1: the listener port (the source goes to port + 1). */
    port: number;
    /** The source / DJ password: kept encrypted by Parkaad, never sent back. */
    password: string;
    /** Icecast only (required there), e.g. "/live". */
    mount?: string;
    /** Icecast: the source user ("source" by default). SHOUTcast v2: the DJ name, if any. */
    username?: string;
    /** SHOUTcast v2 stream id (1 by default). */
    sid?: number;
    /** kbps, 128 by default. */
    bitrate?: 64 | 96 | 128 | 160 | 192 | 256 | 320;
    /** 2 (stereo) by default. */
    channels?: 1 | 2;
  };
}

/** A station as Parkaad keeps it (never with its password). */
export interface Station {
  /** The station's id: for get, delete and renewLink. */
  id: string;
  /** The studio link to send the DJ: https://parkaad.com/live/<linkId>. Whoever has it can broadcast. */
  url: string;
  linkId: string;
  reference: string | null;
  station: { name: string; website: string; genre: string; description: string };
  server: {
    type: ServerType;
    host: string;
    port: number;
    mount?: string;
    sid?: number;
    username: string;
    bitrate: number;
    channels: 1 | 2;
  };
  /** How many times the link has been opened, and when last. */
  opens: number;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedStation extends Station {
  /** true: a new station, with a new link. false: you already had one on this server: updated, same link. */
  created: boolean;
}

export interface StationList {
  /** Newest first. */
  stations: Station[];
  /** How many stations you may have. */
  limit: number;
}

/** The API's error codes, and this library's own. */
export type ParkaadErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "partner_suspended"
  | "host_not_allowed"
  | "not_found"
  | "station_limit"
  | "internal"
  | "network"
  | "timeout"
  | "blocked"
  | "invalid_response"
  | "invalid_api_key"
  | "browser"
  | "no_fetch"
  | (string & {});

export declare class ParkaadError extends Error {
  readonly name: "ParkaadError";
  readonly code: ParkaadErrorCode;
  /** The HTTP status, when the API answered. */
  readonly status: number | null;
}

export interface ParkaadOptions {
  /** <Key ID>.<Secret>. Default: the PARKAAD_API_KEY environment variable. */
  apiKey?: string;
  /** Default: https://parkaad.com */
  baseUrl?: string;
  /** Per request. Default: 15000. */
  timeoutMs?: number;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** The API key gives full control of your stations: only for code that never reaches a browser. */
  dangerouslyAllowBrowser?: boolean;
}

export declare class Parkaad {
  constructor(options?: ParkaadOptions);
  readonly stations: {
    /** Makes a station with a new studio link — or updates the one you have on this server (same link). */
    create(input: StationInput): Promise<CreatedStation>;
    list(): Promise<StationList>;
    /** Throws ParkaadError "not_found" if there's no such station. */
    get(id: string): Promise<Station>;
    /** Its link stops working at once. */
    delete(id: string): Promise<void>;
    /** Deletes the station and makes it again from `input`: a new link (the old one stops working). */
    renewLink(id: string, input: StationInput): Promise<CreatedStation>;
  };
}
