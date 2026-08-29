// ─── Date & field extraction utilities ───────────────────────────────────────

/**
 * Obsidian's YAML parser may return dates as:
 *  - JavaScript Date objects (YAML date format `2024-10-31`)
 *  - ISO strings (if stored as quoted strings)
 *  - null / undefined if the field is missing
 *
 * We normalise all of these to a full year number or null.
 */
export function extractDate(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date && !isNaN(value.getTime())) {
		return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
	}
	if (typeof value === 'string' && value.trim()) {
		const s = value.trim();
		// Match YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, or YYYY-MM
		const matchYMD = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
		if (matchYMD) {
			const year = parseInt(matchYMD[1], 10);
			const month = parseInt(matchYMD[2], 10) - 1;
			const day = matchYMD[3] ? parseInt(matchYMD[3], 10) : 1;
			return new Date(Date.UTC(year, month, day));
		}
		// Match DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
		const matchDMY = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
		if (matchDMY) {
			const day = parseInt(matchDMY[1], 10);
			const month = parseInt(matchDMY[2], 10) - 1;
			const year = parseInt(matchDMY[3], 10);
			return new Date(Date.UTC(year, month, day));
		}
		
		const d = new Date(s);
		if (!isNaN(d.getTime())) {
			return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
		}
	}
	if (typeof value === 'number' && value >= 1000 && value <= 9999) {
		return new Date(Date.UTC(value, 0, 1)); // Construct Date from year
	}
	return null;
}

/** Alias of extractDate for compatibility */
export const toDate = extractDate;

/** Formats a date object as YYYY-MM-DD in UTC */
export function formatDateUTC(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Obsidian's YAML parser may return dates as:
 *  - JavaScript Date objects (YAML date format `2024-10-31`)
 *  - ISO strings (if stored as quoted strings)
 *  - null / undefined if the field is missing
 *
 * We normalise all of these to a full year number or null.
 */
export function extractYear(value: unknown): number | null {
	const d = extractDate(value);
	return d ? d.getUTCFullYear() : null;
}

/** Returns 0-11 month index, or null if unparseable. */
export function extractMonth(value: unknown): number | null {
	const d = extractDate(value);
	return d ? d.getUTCMonth() : null;
}

/** Calculates 1-53 week number according to ISO-8601 */
export function getISOWeek(date: Date): number {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Returns the share of `totalHours` that belongs to `targetYear`.
 */
export function proportionalPlayTime(
	totalHours: number,
	startDate: Date | null,
	endDate: Date | null,
	targetYear: number,
): number {
	if (totalHours <= 0) return 0;

	if (!endDate) {
		return startDate?.getUTCFullYear() === targetYear ? totalHours : 0;
	}

	if (!startDate) {
		return endDate.getUTCFullYear() === targetYear ? totalHours : 0;
	}

	const startYear = startDate.getUTCFullYear();
	const endYear = endDate.getUTCFullYear();

	if (startYear === endYear) {
		return startYear === targetYear ? totalHours : 0;
	}

	if (targetYear < startYear || targetYear > endYear) return 0;

	const yearStart = new Date(Date.UTC(targetYear, 0, 1));
	const yearEnd   = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));

	const effectiveStart = startDate > yearStart ? startDate : yearStart;
	const effectiveEnd   = endDate   < yearEnd   ? endDate   : yearEnd;

	const totalDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
	const daysInYear = (effectiveEnd.getTime() - effectiveStart.getTime()) / 86_400_000;

	if (totalDays <= 0 || daysInYear <= 0) return 0;

	return Math.round(totalHours * (daysInYear / totalDays));
}

/** Ensures the value is always a string array (handles single string, array, or null). */
export function toStringArray(value: unknown): string[] {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value
			.map(v => (typeof v === 'string' ? v : String(v)).trim())
			.filter(v => v.length > 0);
	}
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

/** Safely coerces numeric fields; returns fallback (default 0) for non-numeric or NaN values. */
export function toNumber(value: unknown, fallback = 0): number {
	if (typeof value === 'number') return isNaN(value) ? fallback : value;
	if (typeof value === 'string') {
		const n = parseFloat(value.replace(/[$,]/g, ''));
		return isNaN(n) ? fallback : n;
	}
	return fallback;
}
