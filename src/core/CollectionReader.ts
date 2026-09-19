import type { App, TFile } from 'obsidian';
import type { CollectionConfig, RawRecord } from '../types';
import { extractDate } from '../utils/dateUtils';


/** Resolves start and end dates from frontmatter using collection config or standard property names */
function getRecordDates(fm: Record<string, unknown>, config: CollectionConfig): { dStart: Date | null; dEnd: Date | null } {
	let startVal = config.startDateField ? fm[config.startDateField] : undefined;
	let endVal = config.endDateField ? fm[config.endDateField] : undefined;

	if (startVal === undefined) {
		startVal = fm.startDate ?? fm.started ?? fm.firstPlayed ?? fm.start_date;
	}
	if (endVal === undefined) {
		endVal = fm.endDate ?? fm.finished ?? fm.lastPlayed ?? fm.end_date;
	}

	const dStart = startVal ? extractDate(startVal) : null;
	const dEnd = endVal ? extractDate(endVal) : null;

	if (!dStart && !dEnd) {
		const singleVal = fm.date ?? fm.completed ?? fm.released;
		const dSingle = singleVal ? extractDate(singleVal) : null;
		return { dStart: dSingle, dEnd: dSingle };
	}

	return { dStart, dEnd };
}

/**
 * CollectionReader loads all vault .md files matching a collection config,
 * optionally filtering by year via the collection's dateField.
 */
export class CollectionReader {
	private static fileCache = new Map<string, { files: TFile[]; time: number }>();

	constructor(private app: App) {}

	static invalidateCache(collectionId?: string): void {
		if (collectionId) {
			CollectionReader.fileCache.delete(collectionId);
		} else {
			CollectionReader.fileCache.clear();
		}
	}

	loadRecords(
		config: CollectionConfig,
		mode: 'year' | 'library' | 'month',
		year: number | 'all-time',
		month?: number,
	): RawRecord[] {
		const files = this.getCollectionFiles(config);
		const records: RawRecord[] = [];

		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;

			let prorationFactor = 1;

			// ── Periodic Review inclusion filter (global for this collection) ──
			// In 'year' or 'month' mode, if the user configured a yearFilterField, skip records
			// that don't have the required value (e.g. played = true)
			if ((mode === 'year' || mode === 'month') && config.yearFilterField) {
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
			if (mode === 'year' && year !== 'all-time') {
				const { dStart, dEnd } = getRecordDates(fm as Record<string, unknown>, config);

				if (!dStart && !dEnd) {
					if (config.startDateField || config.endDateField) continue;
				} else if (dStart && dEnd) {
					const sTime = Math.min(dStart.getTime(), dEnd.getTime());
					const eTime = Math.max(dStart.getTime(), dEnd.getTime());
					const totalMs = eTime - sTime;
					const totalDays = Math.max(1, Math.round(totalMs / 86400000) + 1);

					const yearStart = Date.UTC(year, 0, 1);
					const yearEnd = Date.UTC(year, 11, 31);

					const overlapStart = Math.max(sTime, yearStart);
					const overlapEnd = Math.min(eTime, yearEnd);

					if (overlapStart > overlapEnd) {
						continue; // Finished or started outside this year entirely
					}

					if (totalDays > 1) {
						const overlapMs = overlapEnd - overlapStart;
						const overlapDays = Math.max(1, Math.round(overlapMs / 86400000) + 1);
						prorationFactor = Math.min(1, overlapDays / totalDays);
					}
				} else if (dEnd) {
					if (dEnd.getUTCFullYear() !== year) continue;
				} else if (dStart) {
					if (dStart.getUTCFullYear() !== year) continue;
				}
			} else if (mode === 'month' && year !== 'all-time' && typeof month === 'number' && month >= 1 && month <= 12) {
				const { dStart, dEnd } = getRecordDates(fm as Record<string, unknown>, config);

				if (!dStart && !dEnd) {
					if (config.startDateField || config.endDateField) continue;
				} else if (dStart && dEnd) {
					const sTime = Math.min(dStart.getTime(), dEnd.getTime());
					const eTime = Math.max(dStart.getTime(), dEnd.getTime());
					const totalMs = eTime - sTime;
					const totalDays = Math.max(1, Math.round(totalMs / 86400000) + 1);

					const monthStart = Date.UTC(year, month - 1, 1);
					const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
					const monthEnd = Date.UTC(year, month - 1, lastDayOfMonth);

					const overlapStart = Math.max(sTime, monthStart);
					const overlapEnd = Math.min(eTime, monthEnd);

					if (overlapStart > overlapEnd) {
						continue; // Outside this month entirely
					}

					if (totalDays > 1) {
						const overlapMs = overlapEnd - overlapStart;
						const overlapDays = Math.max(1, Math.round(overlapMs / 86400000) + 1);
						prorationFactor = Math.min(1, overlapDays / totalDays);
					}
				} else if (dEnd) {
					if (dEnd.getUTCFullYear() !== year || (dEnd.getUTCMonth() + 1) !== month) continue;
				} else if (dStart) {
					if (dStart.getUTCFullYear() !== year || (dStart.getUTCMonth() + 1) !== month) continue;
				}
			}

			// Build fields map (exclude Obsidian's internal position marker)
			const fields: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(fm)) {
				if (k === 'position') continue;
				fields[k] = v;
			}

			records.push({
				filePath: file.path,
				title: String(fm.title ?? file.basename).trim(),
				fields,
				prorationFactor: prorationFactor < 1 ? prorationFactor : undefined,
			});
		}

		return records;
	}

	/** Count of records in a collection (no year filtering). */
	countAll(config: CollectionConfig): number {
		return this.getCollectionFiles(config).length;
	}

	/** Returns cached or freshly filtered files for a collection */
	getCollectionFiles(config: CollectionConfig): TFile[] {
		const cached = CollectionReader.fileCache.get(config.id);
		const now = Date.now();
		// 30 second TTL cache per collection
		if (cached && now - cached.time < 30000) {
			return cached.files;
		}

		const allFiles = this.app.vault.getMarkdownFiles();
		const files = this.filterFiles(allFiles, config);
		CollectionReader.fileCache.set(config.id, { files, time: now });
		return files;
	}

	private filterFiles(
		allFiles: TFile[],
		config: CollectionConfig,
	): TFile[] {
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
