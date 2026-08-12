// Shared Appwrite client factory. Credentials come from .env.appwrite only.

import { Client, Databases } from "node-appwrite";
import { getConfig } from "./env.js";

export function makeClient() {
  const cfg = getConfig();
  const client = new Client()
    .setEndpoint(cfg.endpoint)
    .setProject(cfg.projectId)
    .setKey(cfg.apiKey);
  return { client, databases: new Databases(client), cfg };
}

/** Appwrite error codes we treat as "already there, nothing to do". */
export const ALREADY_EXISTS = 409;
export const NOT_FOUND = 404;

export const errCode = (err) => err?.code ?? err?.response?.code ?? null;
