export function floorToWindow(isoTime: string, windowMinutes: number): string {
  const date = new Date(isoTime);
  const minute = date.getUTCMinutes();
  const floored = minute - (minute % windowMinutes);
  date.setUTCMinutes(floored, 0, 0);
  return date.toISOString();
}

export function buildDedupeKey(jobType: string, targetId: string, windowStartIso: string): string {
  return `${jobType}:${targetId}:${windowStartIso}`;
}

