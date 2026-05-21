export const MELBOURNE_TZ = 'Australia/Melbourne';

const weekdayToIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partsFor(date: Date, withTime = false) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MELBOURNE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    ...(withTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }
      : {}),
  });

  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

export function addDaysYMD(ymd: string, deltaDays: number) {
  const [y, m, d] = String(ymd || '')
    .split('-')
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function melbourneYMD(date = new Date()) {
  const p = partsFor(date, false);
  return `${p.year}-${p.month}-${p.day}`;
}

export function melbourneWeekdayIndex(date = new Date()) {
  const p = partsFor(date, false);
  return weekdayToIndex[p.weekday] ?? 0;
}

export function weekEndingSundayMelbourne(date = new Date()) {
  const today = melbourneYMD(date);
  const dow = melbourneWeekdayIndex(date);
  const add = (7 - dow) % 7;
  return addDaysYMD(today, add);
}

export function dueWeekEndingSundayMelbourne(date = new Date()) {
  const currentWeekEnding = weekEndingSundayMelbourne(date);
  const dow = melbourneWeekdayIndex(date);
  return dow === 0 ? currentWeekEnding : addDaysYMD(currentWeekEnding, -7);
}

export function previousMonthRangeMelbourne(date = new Date()) {
  const p = partsFor(date, false);
  const y = Number(p.year || 1970);
  const m = Number(p.month || 1);
  const firstCurrent = `${y}-${String(m).padStart(2, '0')}-01`;
  const firstPrev = addDaysYMD(firstCurrent, -1);
  const prevY = Number(firstPrev.slice(0, 4));
  const prevM = Number(firstPrev.slice(5, 7));
  const start = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
  const end = firstPrev;
  return {start, end};
}

export function melbourneTimeParts(date = new Date()) {
  const p = partsFor(date, true);
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday || 'Sun',
    weekdayIndex: weekdayToIndex[p.weekday] ?? 0,
    hour: Number(p.hour || 0),
    minute: Number(p.minute || 0),
    second: Number(p.second || 0),
  };
}
