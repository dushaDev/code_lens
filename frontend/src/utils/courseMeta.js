/**
 * Helpers for the optional course metadata fields (tech requirements + deadline).
 *
 * The deadline is entered as a separate date and an optional time. When the time
 * is left blank it defaults to midnight (00:00) at the start of that day, so a
 * deadline of "30 Nov" means anything pushed from 30 Nov 00:00 onwards is late.
 *
 * Values are sent as naive local ISO strings (no timezone suffix) to match the
 * naive DateTime columns the backend stores.
 */

/** Combine a `yyyy-mm-dd` date and an optional `hh:mm` time into a naive ISO string. */
export function buildDeadline(date, time) {
  if (!date) return null;
  return `${date}T${time || '00:00'}:00`;
}

/** Split a stored deadline back into `{ date, time }` for the form inputs. */
export function splitDeadline(deadline) {
  if (!deadline) return { date: '', time: '' };

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };

  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

/** Human-readable deadline for cards and headers. */
export function formatDeadline(deadline) {
  if (!deadline) return null;

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** True when the deadline has passed — commits after this point count as late. */
export function isPastDeadline(deadline) {
  if (!deadline) return false;

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.getTime() < Date.now();
}
