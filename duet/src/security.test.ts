import { describe, expect, it } from "vitest";
import {
  CREATION_MAX_GLOBAL,
  CREATION_MAX_PER_IP,
  CREATION_WINDOW_MS,
  MESSAGE_BURST,
  MESSAGE_REFILL_PER_SECOND,
  RATE_MAX_NEW_SESSIONS,
  RATE_WINDOW_MS,
  allowRoomCreationAttempt,
  authorizeRoom,
  checkConnectionRate,
  constantTimeEquals,
  createBucket,
  deriveRoomToken,
  newCreationGuard,
  spendTokens,
  type ConnectionRateState,
} from "./security";

const credential = "a".repeat(43);
const otherCredential = "b".repeat(43);
const session = (index: number) => index.toString(36).padStart(22, "0");

async function creation(ownerKey: string, roomToken: string) {
  return { token: roomToken, derivedToken: await deriveRoomToken(ownerKey) };
}

describe("Duet room authorization", () => {
  it("rejects a correctly-shaped token that no owner has issued", () => {
    expect(authorizeRoom(undefined, null)).toBe("unissued");
  });

  it("derives a stable 43-character token from an owner key", async () => {
    const first = await deriveRoomToken(credential);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await deriveRoomToken(credential)).toBe(first);
    expect(await deriveRoomToken(otherCredential)).not.toBe(first);
  });

  it("only creates a room whose token is the hash of the offered owner key", async () => {
    const derived = await deriveRoomToken(credential);
    expect(
      authorizeRoom(undefined, credential, await creation(credential, derived))
    ).toBe("issue-owner");
    // An attacker who picks a token and an unrelated owner value gets nothing.
    expect(
      authorizeRoom(undefined, otherCredential, await creation(otherCredential, derived))
    ).toBe("unissued");
    // Nor can creation be forced by simply omitting the derivation.
    expect(authorizeRoom(undefined, credential)).toBe("unissued");
  });

  it("leaves an already-issued room to its stored owner", () => {
    expect(authorizeRoom(credential, credential)).toBe("owner");
    expect(authorizeRoom(credential, otherCredential)).toBe("forbidden");
    expect(authorizeRoom(credential, null)).toBe("guest");
  });

  it("compares credentials without an early exit", () => {
    expect(constantTimeEquals(credential, credential)).toBe(true);
    expect(constantTimeEquals(credential, otherCredential)).toBe(false);
    expect(constantTimeEquals(credential, credential.slice(0, 42))).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("Duet room creation guard", () => {
  it("caps creation attempts per address inside one window", () => {
    const guard = newCreationGuard(0);
    for (let index = 0; index < CREATION_MAX_PER_IP; index++) {
      expect(allowRoomCreationAttempt(guard, "203.0.113.9", index)).toBe(true);
    }
    expect(allowRoomCreationAttempt(guard, "203.0.113.9", 100)).toBe(false);
    // A different address is unaffected until the global ceiling is reached.
    expect(allowRoomCreationAttempt(guard, "203.0.113.10", 100)).toBe(true);
    expect(
      allowRoomCreationAttempt(guard, "203.0.113.9", CREATION_WINDOW_MS + 1)
    ).toBe(true);
  });

  it("caps creation attempts across every address in one isolate", () => {
    const guard = newCreationGuard(0);
    let allowed = 0;
    for (let index = 0; index < CREATION_MAX_GLOBAL * 2; index++) {
      if (allowRoomCreationAttempt(guard, `10.0.${index >> 8}.${index & 255}`, 1)) {
        allowed += 1;
      }
    }
    expect(allowed).toBe(CREATION_MAX_GLOBAL);
  });
});

describe("Duet per-socket token buckets", () => {
  it("spends a burst and then refills over time", () => {
    const bucket = createBucket(MESSAGE_BURST, 0);
    for (let index = 0; index < MESSAGE_BURST; index++) {
      expect(spendTokens(bucket, MESSAGE_BURST, MESSAGE_REFILL_PER_SECOND, 1, 0)).toBe(
        true
      );
    }
    expect(spendTokens(bucket, MESSAGE_BURST, MESSAGE_REFILL_PER_SECOND, 1, 0)).toBe(
      false
    );
    expect(spendTokens(bucket, MESSAGE_BURST, MESSAGE_REFILL_PER_SECOND, 1, 1000)).toBe(
      true
    );
  });

  it("never lets a bucket refill past its capacity", () => {
    const bucket = createBucket(10, 0);
    expect(spendTokens(bucket, 10, 1, 10, 1_000_000)).toBe(true);
    expect(spendTokens(bucket, 10, 1, 1, 1_000_000)).toBe(false);
  });

  it("charges nothing when the cost cannot be covered", () => {
    const bucket = createBucket(10, 0);
    expect(spendTokens(bucket, 10, 1, 20, 0)).toBe(false);
    expect(bucket.tokens).toBe(10);
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
