// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { lsSet } from "./localStore";

afterEach(() => vi.restoreAllMocks());

describe("a nearly full browser", () => {
  it("makes room and saves, with no notice, when room can be made", () => {
    let full = true;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (full) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    });
    const notice = vi.fn();
    const makeRoom = () => (full = false);
    window.addEventListener("less:storagepressure", makeRoom);
    window.addEventListener("less:storagefull", notice);
    expect(lsSet("less:test", "words")).toBe(true);
    expect(notice).not.toHaveBeenCalled();
    window.removeEventListener("less:storagepressure", makeRoom);
    window.removeEventListener("less:storagefull", notice);
  });

  it("raises the notice only when nothing could be freed, and clears it once a save works", () => {
    let full = true;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (full) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    });
    const notice = vi.fn();
    const ok = vi.fn();
    window.addEventListener("less:storagefull", notice);
    window.addEventListener("less:storageok", ok);
    expect(lsSet("less:test", "words")).toBe(false);
    expect(notice).toHaveBeenCalledTimes(1);
    full = false;
    expect(lsSet("less:test", "words")).toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
    window.removeEventListener("less:storagefull", notice);
    window.removeEventListener("less:storageok", ok);
  });
});
