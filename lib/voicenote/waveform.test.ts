import { describe, expect, it } from "vitest";
import { compressPeaks, decodePeaks, encodePeaks, formatDuration, levelOf, SUMMARY_BARS } from "./waveform";

describe("the recording bar", () => {
  it("grows one bar per sample until it is full", () => {
    expect(compressPeaks([0.1, 0.5, 0.2], 10)).toEqual([0.1, 0.5, 0.2]);
  });

  it("then squeezes the whole recording to fit, and a single word still stands out", () => {
    const samples = Array.from({ length: 1000 }, (_, i) => (i === 777 ? 1 : 0.1));
    const bars = compressPeaks(samples, 100);
    expect(bars).toHaveLength(100);
    const tallest = bars.indexOf(Math.max(...bars));
    expect(tallest).toBe(77);
    expect(bars.filter((b) => b > 0.3)).toHaveLength(1);
  });

  it("keeps the pauses of a long note visible once squeezed", () => {
    // Ten minutes at twenty samples a second: talk for a minute, pause for a minute.
    const samples = Array.from({ length: 12000 }, (_, i) =>
      Math.floor(i / 1200) % 2 === 0 ? 0.3 + 0.6 * Math.abs(Math.sin(i)) : 0.02
    );
    const bars = compressPeaks(samples, 60);
    const talking = bars.filter((_, i) => Math.floor(i / 6) % 2 === 0);
    const pausing = bars.filter((_, i) => Math.floor(i / 6) % 2 === 1);
    expect(Math.min(...talking)).toBeGreaterThan(0.5);
    expect(Math.max(...pausing)).toBeLessThan(0.05);
    expect(Math.max(...talking)).toBeLessThan(0.99);
  });

  it("stores a short summary and reads it back", () => {
    const summary = encodePeaks(Array.from({ length: 500 }, (_, i) => (i % 50) / 49));
    expect(summary).toHaveLength(SUMMARY_BARS);
    expect(summary).toMatch(/^[0-9a-z]+$/);
    const back = decodePeaks(summary);
    expect(back).toHaveLength(SUMMARY_BARS);
    expect(Math.max(...back)).toBeLessThanOrEqual(1);
    expect(encodePeaks([0.5, 1])).toHaveLength(SUMMARY_BARS);
    expect(decodePeaks(42)).toEqual([]);
    expect(decodePeaks("z!")).toEqual([1, 0]);
  });

  it("measures a level from a frame of audio", () => {
    expect(levelOf(new Float32Array(128))).toBe(0);
    expect(levelOf(new Float32Array(128).fill(0.5))).toBe(1);
    const quiet = levelOf(new Float32Array(128).fill(0.02));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(0.3);
  });

  it("writes lengths like a voice memo app", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(272)).toBe("4:32");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});
