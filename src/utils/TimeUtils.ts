// ─── Play-time proportional split across calendar years ──────────────────────

/**
 * Returns the share of `totalHours` that belongs to `targetYear`.
 *
 * Rules:
 *  - startDate null  → endDate-only note → 100 % attributed to endDate's year
 *  - same year       → 100 %
 *  - multi-year span → linearly pro-rated by calendar days inside targetYear
 */
export function proportionalPlayTime(
	totalHours: number,
	startDate: Date | null,
	endDate: Date | null,
	targetYear: number,
): number {
	if (totalHours <= 0) return 0;

	// No endDate → assume game hasn't finished, attribute to startDate's year
	if (!endDate) {
		return startDate?.getUTCFullYear() === targetYear ? totalHours : 0;
	}

	// No startDate → attribute everything to endDate's year
	if (!startDate) {
		return endDate.getUTCFullYear() === targetYear ? totalHours : 0;
	}

	const startYear = startDate.getUTCFullYear();
	const endYear = endDate.getUTCFullYear();

	// Same year — simple case
	if (startYear === endYear) {
		return startYear === targetYear ? totalHours : 0;
	}

	// Target year is completely outside the play span
	if (targetYear < startYear || targetYear > endYear) return 0;

	// Clamp to the portion of the span that falls inside targetYear
	const yearStart = new Date(Date.UTC(targetYear, 0, 1));          // Jan 1
	const yearEnd   = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999)); // Dec 31 23:59

	const effectiveStart = startDate > yearStart ? startDate : yearStart;
	const effectiveEnd   = endDate   < yearEnd   ? endDate   : yearEnd;

	const totalDays = (endDate.getTime() - startDate.getTime()) / 86_400_000;
	const daysInYear = (effectiveEnd.getTime() - effectiveStart.getTime()) / 86_400_000;

	if (totalDays <= 0 || daysInYear <= 0) return 0;

	return Math.round(totalHours * (daysInYear / totalDays));
}

// ─── Generic date coercion ────────────────────────────────────────────────────

/** Coerces a frontmatter value (Date object, ISO string, null) to a JS Date or null. */
export function toDate(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
	if (typeof value === 'string' && value.trim()) {
		const s = value.trim();
		// Match YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, or YYYY-MM
		const matchYMD = s.match(/^(\d{4})[-\/\.](\d{1,2})(?:[-\/\.](\d{1,2}))?/);
		if (matchYMD) {
			const year = parseInt(matchYMD[1], 10);
			const month = parseInt(matchYMD[2], 10) - 1;
			const day = matchYMD[3] ? parseInt(matchYMD[3], 10) : 1;
			return new Date(Date.UTC(year, month, day));
		}
		// Match DD-MM-YYYY, DD/MM/YYYY, or DD.MM.YYYY
		const matchDMY = s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
		if (matchDMY) {
			const day = parseInt(matchDMY[1], 10);
			const month = parseInt(matchDMY[2], 10) - 1;
			const year = parseInt(matchDMY[3], 10);
			return new Date(Date.UTC(year, month, day));
		}
		const d = new Date(s);
		return isNaN(d.getTime()) ? null : d;
	}
	return null;
}
