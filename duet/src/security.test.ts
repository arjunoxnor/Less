import { describe, expect, it } from "vitest";
import {
  RATE_MAX_NEW_SESSIONS,
  RATE_WINDOW_MS,
  authorizeRoom,
  checkConnectionRate,
  type ConnectionRateState,
} from "./security";

const credential = "a".repeat(43);
const otherCredential = "b".repeat(43);
const session = (index: number) => index.toString(36).padStart(22, "0");

describe("Duet room authorization", () => {
  it("rejects a correctly-shaped token that no owner has issued", () => {
    expect(authorizeRoom(undefined, null)).toBe("unissued");
  });

  it("issues once and never accepts a different owner credential", () => {
    expect(authorizeRoom(undefined, credential)).toBe("issue-owner");
    expect(authorizeRoom(credential, credential)).toBe("owner");
    expect(authorizeRoom(credential, otherCredential)).toBe("forbidden");
    expect(authorizeRoom(credential, null)).toBe("guest");
  });
});

describe("Duet connection rate limiting", () => {
  it("persists a per-room limit for new sessions", () => {
    let state: ConnectionRateState | undefined;
    for (let index = 0; index < RATE_MAX_NEW_SESSIONS; index++) {
      const decision = checkConnectionRate(
        state,
        "203.0.113.1",
        session(index),
        index,
        10_000
      );
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }

    expect(
      checkConnectionRate(
        state,
        "203.0.113.1",
        session(RATE_MAX_NEW_SESSIONS),
        99,
        10_001
      ).allowed
    ).toBe(false);
  });

  it("allows a known writer to reconnect after new sessions exhaust the window", () => {
    let state: ConnectionRateState | undefined;
    for (let index = 0; index < RATE_MAX_NEW_SESSIONS; index++) {
      state = checkConnectionRate(
        state,
        "203.0.113.2",
        session(index),
        index,
        20_000
      ).state;
    }

    expect(
      checkConnectionRate(state, "203.0.113.2", session(0), 0, 20_001).allowed
    ).toBe(true);
  });

  it("does not let a reconnect identity switch Yjs client ids", () => {
    const first = checkConnectionRate(
      undefined,
      "203.0.113.3",
      session(0),
      7,
      30_000
    );
    const changed = checkConnectionRate(
      first.state,
      "203.0.113.3",
      session(0),
      8,
      30_001
    );
    expect(changed.allowed).toBe(false);
    expect(changed.reason).toBe("session-client-mismatch");
  });

  it("admits new writers after the fixed window expires", () => {
    let state: ConnectionRateState | undefined;
    for (let index = 0; index < RATE_MAX_NEW_SESSIONS; index++) {
      state = checkConnectionRate(
        state,
        "203.0.113.4",
        session(index),
        index,
        40_000
      ).state;
    }
    expect(
      checkConnectionRate(
        state,
        "203.0.113.4",
        session(99),
        99,
        40_000 + RATE_WINDOW_MS + 1
      ).allowed
    ).toBe(true);
  });
});
