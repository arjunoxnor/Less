// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadRecording, uploadStatusOf } from "./upload";

// Node's own stub localStorage shadows jsdom's (its methods throw without
// --localstorage-file), so install a real in-memory one, as client.test.ts does.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const ID = "0123456789abcdef0123456789abcdef";
const blob = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: "audio/webm" });

function answer(status: number, body: unknown = {}) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  localStorage.setItem("less:session", "token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("sending a recording", () => {
  it("PUTs it under the note's own id, with the session", async () => {
    const fetch = answer(200, { id: ID });
    vi.stubGlobal("fetch", fetch);
    expect(await uploadRecording(ID, blob())).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/assets/${ID}`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect(uploadStatusOf(ID)).toEqual({ state: "done" });
  });

  it("waits for a sign-in when there is no session", async () => {
    localStorage.clear();
    const fetch = answer(200);
    vi.stubGlobal("fetch", fetch);
    expect(await uploadRecording(ID, blob())).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadStatusOf(ID)).toEqual({ state: "waiting", reason: "Sign in to have it transcribed." });
  });

  it("explains a refusal that will not pass by itself", async () => {
    vi.stubGlobal("fetch", answer(403, { error: "Sign in with Google to save voice notes" }));
    expect(await uploadRecording(ID, blob())).toBe(false);
    expect(uploadStatusOf(ID)).toEqual({ state: "waiting", reason: "Sign in with Google to have it transcribed." });
    vi.stubGlobal("fetch", answer(507));
    await uploadRecording(ID, blob());
    expect(uploadStatusOf(ID)?.state).toBe("waiting");
    expect((uploadStatusOf(ID) as { reason?: string }).reason).toMatch(/full/);
  });

  it("quietly tries again later after a passing failure", async () => {
    vi.stubGlobal("fetch", answer(503));
    expect(await uploadRecording(ID, blob())).toBe(false);
    expect(uploadStatusOf(ID)).toEqual({ state: "waiting" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      })
    );
    expect(await uploadRecording(ID, blob())).toBe(false);
    expect(uploadStatusOf(ID)).toEqual({ state: "waiting" });
  });
});
