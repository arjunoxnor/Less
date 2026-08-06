// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  createProject,
  hasPendingCloudWork,
  markCloudCreated,
  patchProjectMeta,
  setDirty,
  setStatusDirty,
  setTitleDirty,
  setTitlePageDirty,
} from "./projects";

function freshStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
}

describe("sign-out data-loss guard", () => {
  beforeEach(freshStorage);

  it("blocks for every kind of pending cloud-backed project write", () => {
    const project = createProject("screenplay");
    markCloudCreated(project.id);
    expect(hasPendingCloudWork()).toBe(false);

    for (const setPending of [setDirty, setTitlePageDirty, setTitleDirty, setStatusDirty]) {
      setPending(project.id, true);
      expect(hasPendingCloudWork()).toBe(true);
      setPending(project.id, false);
    }
  });

  it("does not block anonymous work that remains on the device", () => {
    const project = createProject("screenplay");
    setDirty(project.id, true);
    expect(hasPendingCloudWork()).toBe(false);
  });

  it("blocks while an anonymous project's first cloud insert is unresolved", () => {
    const project = createProject("screenplay");
    patchProjectMeta(project.id, { cloudCreatePending: true });
    expect(hasPendingCloudWork()).toBe(true);
    patchProjectMeta(project.id, { cloudCreatePending: false });
    expect(hasPendingCloudWork()).toBe(false);
  });
});
