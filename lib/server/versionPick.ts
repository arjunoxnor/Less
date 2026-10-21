/**
 * Which saved versions of a script History shows.
 *
 * A snapshot is taken every few minutes while the writer works, so "the
 * newest 100" reached back only about five hours of writing: anything older
 * was saved but out of reach. Instead History thins out with age, the way a
 * backup does: the last day closely, then one an hour for the past week, then
 * one a day back to the very first, each stretch spread evenly within its
 * share, and every named version (a draft the writer saved, "Before restore")
 * always. At most `cap`, newest first. Pure, so the API and its tests share it.
 */
export interface VersionRow {
  id: string;
  created_at: string;
  label?: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** n items spread evenly through a list (its first and last always among them). */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  if (n <= 1) return list.slice(0, n);
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(list[Math.round((k * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

export function pickVersions(rows: readonly VersionRow[], now = Date.now(), cap = 100): string[] {
  const sorted = [...rows].filter((r) => Number.isFinite(Date.parse(r.created_at)));
  sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const named: VersionRow[] = [];
  const day: VersionRow[] = [];
  const week: VersionRow[] = [];
  const older: VersionRow[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const t = Date.parse(row.created_at);
    const age = now - t;
    if (row.label) named.push(row);
    else if (age < DAY) day.push(row);
    else {
      // Past a day, one per hour (this week) or per day (before).
      const bucket = age < 7 * DAY ? `h:${Math.floor(t / HOUR)}` : `d:${Math.floor(t / DAY)}`;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      (age < 7 * DAY ? week : older).push(row);
    }
  }
  // Each stretch gets a share of what is left after the named drafts; a share
  // one stretch does not use goes to the next.
  let room = Math.max(0, cap - named.length);
  const take = (list: VersionRow[], share: number) => {
    const got = spread(list, Math.min(room, share));
    room -= got.length;
    return got;
  };
  const keepOlder = take(older, Math.round(room * 0.25));
  const keepWeek = take(week, Math.round(room * 0.45));
  const keepDay = take(day, room);
  const extraOlder = take(older.filter((r) => !keepOlder.includes(r)), room);
  const kept = new Set([...named, ...keepDay, ...keepWeek, ...keepOlder, ...extraOlder].map((r) => r.id));
  return sorted.filter((r) => kept.has(r.id)).map((r) => r.id);
}
