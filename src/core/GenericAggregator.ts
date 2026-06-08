import type { RawRecord, Distribution, NumericSummary, ActivityData } from '../types';
import { extractDate, getISOWeek } from '../utils/dateUtils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
	'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * GenericAggregator computes statistics from an array of RawRecords
 * for any property key — no type-specific knowledge required.
 */
export class GenericAggregator {

	/** Frequency distribution for a text/array field → sorted [label, count][] */
	static distribution(records: RawRecord[], field: string, topN = 15): Distribution {
		const counts = new Map<string, number>();

		for (const r of records) {
			const val = r.fields[field];
			if (val === undefined || val === null || val === '') continue;
			
			const items: string[] = Array.isArray(val)
				? val.map(v => String(v).trim()).filter(v => v !== '')
				: [String(val).trim()].filter(v => v !== '');

			for (const item of items) {
				counts.set(item, (counts.get(item) ?? 0) + 1);
			}
		}

		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN);
	}

	/** Numeric summary (sum / avg / min / max / count) for a numeric field */
	static numericSummary(records: RawRecord[], field: string): NumericSummary {
		const values = records
			.map(r => {
				const v = r.fields[field];
				return typeof v === 'number' ? v : parseFloat(String(v ?? ''));
			})
			.filter(v => !isNaN(v) && v > 0);

		if (!values.length) return { sum: 0, average: 0, min: 0, max: 0, count: 0 };

		const sum = values.reduce((a, b) => a + b, 0);
		return {
			sum:     Math.round(sum * 100) / 100,
			average: Math.round((sum / values.length) * 100) / 100,
			min:     Math.min(...values),
			max:     Math.max(...values),
			count:   values.length,
		};
	}

	/** Safely evaluates a math expression using variables from fields. */
	static evaluateSafeExpression(expression: string, fields: Record<string, unknown>): number {
		if (!expression || !expression.trim()) return 0;

		// 1. Get all numeric values from fields
		const numericFields: Record<string, number> = {};
		for (const [k, v] of Object.entries(fields)) {
			const num = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
			numericFields[k] = isNaN(num) ? 0 : num;
		}

		// 2. Sort keys by length descending to match longest first
		const sortedKeys = Object.keys(numericFields).sort((a, b) => b.length - a.length);
		
		let substituted = expression;
		if (sortedKeys.length > 0) {
			for (const key of sortedKeys) {
				const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// Match the key only if it is not part of a larger alphanumeric identifier
				const regex = new RegExp(`(?<![a-zA-Z0-9_])${escapedKey}(?![a-zA-Z0-9_])`, 'g');
				substituted = substituted.replace(regex, String(numericFields[key]));
			}
		}

		// 3. Validate whitelisted Math functions and basic operators
		const allowedMath = /Math\.(abs|min|max|round|floor|ceil)/g;
		const cleanedForValidation = substituted.replace(allowedMath, '');
		const isArithmeticOnly = /^[0-9.+\-*/() ]*$/.test(cleanedForValidation);

		if (!isArithmeticOnly) {
			throw new Error("Invalid characters in expression");
		}

		// 4. Evaluate safely
		const fn = new Function(`return parseFloat(${substituted});`);
		return fn();
	}

	/** Formula summary (custom math expression evaluated per record) */
	static formulaSummary(records: RawRecord[], expression: string): NumericSummary {
		if (!expression || !expression.trim()) return { sum: 0, average: 0, min: 0, max: 0, count: 0 };

		const values: number[] = [];
		for (const r of records) {
			try {
				const result = this.evaluateSafeExpression(expression, r.fields);
				if (!isNaN(result) && isFinite(result)) {
					values.push(result);
				}
			} catch (e) {
				continue;
			}
		}

		if (!values.length) return { sum: 0, average: 0, min: 0, max: 0, count: 0 };
		
		const sum = values.reduce((a, b) => a + b, 0);
		return {
			sum:     Math.round(sum * 100) / 100,
			average: Math.round((sum / values.length) * 100) / 100,
			min:     Math.min(...values),
			max:     Math.max(...values),
			count:   values.length,
		};
	}

	/** Top/bottom ranking by a numeric field → [title, value][] */
	static ranking(
		records: RawRecord[],
		field: string,
		topN = 10,
		ascending = false,
	): [string, number][] {
		return records
			.map(r => {
				const v = r.fields[field];
				const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
				return [r.title, isNaN(n) ? 0 : n] as [string, number];
			})
			.filter(([, v]) => v > 0)
			.sort((a, b) => ascending ? a[1] - b[1] : b[1] - a[1])
			.slice(0, topN);
	}

	/** Formula-based ranking — evaluates expression per record, sorts by result → [title, value][] */
	static formulaRanking(
		records: RawRecord[],
		expression: string,
		topN = 10,
		ascending = false,
	): [string, number][] {
		if (!expression || !expression.trim()) return [];

		const results: [string, number][] = [];
		for (const r of records) {
			try {
				const result = this.evaluateSafeExpression(expression, r.fields);
				if (!isNaN(result) && isFinite(result) && result > 0) {
					results.push([r.title, Math.round(result * 100) / 100]);
				}
			} catch {
				continue;
			}
		}

		return results
			.sort((a, b) => ascending ? a[1] - b[1] : b[1] - a[1])
			.slice(0, topN);
	}

	/** Time-series activity from a date field */
	static activity(records: RawRecord[], dateField: string): ActivityData {
		const monthly = new Array<number>(12).fill(0);
		const weekly  = new Array<number>(53).fill(0);
		const yearly: Record<string, number> = {};

		for (const r of records) {
			const d = extractDate(r.fields[dateField]);
			if (!d) continue;

			const m = d.getMonth();
			const w = getISOWeek(d) - 1;
			const y = String(d.getFullYear());

			if (m >= 0 && m < 12) monthly[m]++;
			if (w >= 0 && w < 53) weekly[w]++;
			yearly[y] = (yearly[y] ?? 0) + 1;
		}

		return { monthly, weekly, yearly };
	}

	/** Month labels (for activity charts). */
	static readonly MONTHS = MONTHS;
}
