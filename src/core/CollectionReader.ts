import type { App } from 'obsidian';
import type { CollectionConfig, RawRecord } from '../types';
import { extractDate } from '../utils/dateUtils';

/** Determines whether a numeric field represents a cumulative metric that should be prorated. */
function shouldProrateField(key: string): boolean {
	const lower = key.toLowerCase();
	const staticTerms = ['rating', 'score', 'year', 'date', 'id', 'season', 'price', 'cost', 'rank', 'index', 'version', 'uid'];
	if (staticTerms.some(term => lower.includes(term))) {
		return false;
	}
	const cumulativeTerms = ['playtime', 'play-time', 'hours', 'pages', 'episodes', 'chapters', 'progress', 'duration', 'time', 'count', 'amount'];
	return cumulativeTerms.some(term => lower.includes(term));
}

/**
 * CollectionReader loads all vault .md files matching a collection config,
 * optionally filtering by year via the collection's dateField.
 */
export class CollectionReader {
	constructor(private app: App) {}

	loadRecords(
		config: CollectionConfig,
		mode: 'year' | 'library',
		year: number | 'all-time',
	): RawRecord[] {
		const allFiles = this.app.vault.getMarkdownFiles();
		const files = this.filterFiles(allFiles, config);
		const records: RawRecord[] = [];

		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;

			let prorationFactor = 1;

			// ── Year-in-Review inclusion filter (global for this collection) ──
			// In 'year' mode, if the user configured a yearFilterField, skip records
			// that don't have the required value (e.g. played = true)
			if (mode === 'year' && config.yearFilterField) {
				const fv = (fm as Record<string, unknown>)[config.yearFilterField];
				if (config.yearFilterValue) {
					const required = config.yearFilterValue.toLowerCase();
					const actual = String(fv ?? '').toLowerCase();
					if (actual !== required) continue;
				} else {
					// No value specified — only require the field to be truthy
					if (!fv) continue;
				}
			}

			// ── Date Filtering & Prorating ─────────────────────────────────────
			if (mode === 'year') {
				const startVal = config.startDateField ? (fm as Record<string, unknown>)[config.startDateField] : null;
				const endVal = config.endDateField ? (fm as Record<string, unknown>)[config.endDateField] : null;

				const dStart = startVal ? extractDate(startVal) : null;
				const dEnd = endVal ? extractDate(endVal) : null;

				if (year !== 'all-time') {
					// Core rule: In a specific 'year' view, if endDateField is configured,
					// records MUST have an end date (be "finished").
					if (config.endDateField && !dEnd) continue;

					if (dStart && dEnd) {
						// Both dates exist -> we calculate the percentage of days falling into the target year
						const totalMs = dEnd.getTime() - dStart.getTime();
						const totalDays = Math.max(1, (totalMs / 86400000) + 1);

						const yearStart = Date.UTC(year, 0, 1);
						const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59, 999);

						const overlapStart = Math.max(dStart.getTime(), yearStart);
						const overlapEnd = Math.min(dEnd.getTime(), yearEnd);

						if (overlapStart > overlapEnd) {
							continue; // Finished or started outside this year entirely
						}

						const overlapMs = overlapEnd - overlapStart;
						const overlapDays = Math.max(1, (overlapMs / 86400000) + 1);

						prorationFactor = overlapDays / totalDays;

					} else if (dEnd) {
						// Only end date -> exact match required
						if (dEnd.getUTCFullYear() !== year) continue;
					} else if (dStart) {
						// Only start date -> exact match required
						if (dStart.getUTCFullYear() !== year) continue;
					} else if (config.startDateField || config.endDateField) {
						// At least one date field is tracked, but this record has neither.
						// It doesn't belong to any specific year, so exclude it from year filters.
						continue;
					}
				}
			}

			// Build fields map (exclude Obsidian's internal position marker)
			const fields: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(fm)) {
				if (k === 'position') continue;

				// Apply prorating only to cumulative numeric values
				if (prorationFactor < 1 && typeof v === 'number' && shouldProrateField(k)) {
					fields[k] = Math.round((v * prorationFactor) * 100) / 100;
				} else {
					fields[k] = v;
				}
			}

			records.push({
				filePath: file.path,
				title: String(fm.title ?? file.basename).trim(),
				fields,
			});
		}

		return records;
	}

	/** Count of records in a collection (no year filtering). */
	countAll(config: CollectionConfig): number {
		const allFiles = this.app.vault.getMarkdownFiles();
		return this.filterFiles(allFiles, config).length;
	}

	private filterFiles(
		allFiles: ReturnType<App['vault']['getMarkdownFiles']>,
		config: CollectionConfig,
	) {
		if (config.scanMode === 'folder' && config.folderPath) {
			const raw = config.folderPath;
			const prefix = raw.endsWith('/') ? raw : raw + '/';
			return allFiles.filter(
				f => f.path.startsWith(prefix) || f.path === raw,
			);
		}

		const typeField = config.typeField ?? 'type';
		const typeValue = (config.typeValue ?? '').toLowerCase().trim();
		if (!typeValue) return [];

		return allFiles.filter(f => {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) return false;
			return String(fm[typeField] ?? '').trim().toLowerCase() === typeValue;
		});
	}
}
