function normalizeYmd(raw: any) {
  const value = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function extractYmdFromIso(raw: any) {
  const value = String(raw || '').trim();
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export function readMainCrewDirtyResetDate(settings: any) {
  return normalizeYmd(settings?.mainCrewDirtyResetDate);
}

export function includeMainCrewWeekForDirtyReset(weekEnding: any, settings: any) {
  const weekKey = normalizeYmd(weekEnding);
  const resetDate = readMainCrewDirtyResetDate(settings);
  if (!weekKey) return false;
  if (!resetDate) return true;
  return weekKey >= resetDate;
}

export function includeMainCrewOrderForDirtyReset(order: any, settings: any) {
  const resetDate = readMainCrewDirtyResetDate(settings);
  if (!resetDate) return true;
  const createdKey = extractYmdFromIso(order?.createdAt);
  if (!createdKey) return true;
  return createdKey >= resetDate;
}
