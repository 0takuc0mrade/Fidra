import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "fidra_vendor_session";

export class SessionStore {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  create() {
    const id = randomBytes(32).toString("base64url");
    const session = { id, createdAt: Date.now(), expiresAt: Date.now() + this.ttlMs };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    session.expiresAt = Date.now() + this.ttlMs;
    return session;
  }

  update(id, values) {
    const session = this.get(id);
    if (!session) return null;
    Object.assign(session, values, { expiresAt: Date.now() + this.ttlMs });
    return session;
  }

  delete(id) {
    if (id) this.sessions.delete(id);
  }
}

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

export function sessionCookie(session, secure, sameSite = "Lax") {
  return `${SESSION_COOKIE}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor((session.expiresAt - Date.now()) / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure, sameSite = "Lax") {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure ? "; Secure" : ""}`;
}
