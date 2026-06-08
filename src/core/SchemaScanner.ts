import type { App, TFile } from 'obsidian';
import type { CollectionConfig, FieldType, SchemaField } from '../types';
import { extractDate } from '../utils/dateUtils';

/**
 * SchemaScanner scans all .md files matching a collection config and builds
 * a cached list of SchemaField descriptors from their frontmatter.
 */
export class SchemaScanner {
	constructor(private app: App) {}

	async scan(
		config: Pick<CollectionConfig, 'scanMode' | 'folderPath' | 'typeField' | 'typeValue'>,
	): Promise<SchemaField[]> {
		const files = this.getMatchingFiles(config);

		// Per-key accumulator: list of raw values and inferred types
		const fieldData = new Map<string, { values: unknown[]; types: FieldType[] }>();

		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;

			for (const [key, value] of Object.entries(fm)) {
				// Skip Obsidian's internal frontmatter position marker
				if (key === 'position') continue;

				if (!fieldData.has(key)) fieldData.set(key, { values: [], types: [] });
				const entry = fieldData.get(key)!;
				entry.values.push(value);
				const inferred = this.inferType(value);
				if (inferred !== null) entry.types.push(inferred);
			}
		}

		const total = files.length || 1;
		const fields: SchemaField[] = [];

		for (const [key, { values, types }] of fieldData.entries()) {
			const type = this.dominantType(types);
			fields.push({
				key,
				type,
				sampleValues: this.extractSamples(values, type),
				// Coverage = fraction of files with a *non-empty* value for this field
				coverage: values.filter(v => v !== null && v !== undefined && v !== '').length / total,
			});
		}

		// Sort by coverage (most present first), then alphabetically
		return fields.sort((a, b) =>
			b.coverage - a.coverage || a.key.localeCompare(b.key),
		);
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	getMatchingFiles(
		config: Pick<CollectionConfig, 'scanMode' | 'folderPath' | 'typeField' | 'typeValue'>,
	): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();

		if (config.scanMode === 'folder' && config.folderPath) {
			const raw = config.folderPath;
			const prefix = raw.endsWith('/') ? raw : raw + '/';
			return allFiles.filter(
				f => f.path.startsWith(prefix) || f.path === raw,
			);
		}

		// type-field mode
		const typeField = config.typeField ?? 'type';
		const typeValue = (config.typeValue ?? '').toLowerCase().trim();
		if (!typeValue) return [];

		return allFiles.filter(f => {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) return false;
			return String(fm[typeField] ?? '').trim().toLowerCase() === typeValue;
		});
	}

	private inferType(value: unknown): FieldType | null {
		if (value === null || value === undefined) return null;
		if (typeof value === 'boolean') return 'boolean';
		if (typeof value === 'number') return 'number';
		if (Array.isArray(value)) return 'array';
		if (value instanceof Date) return 'date';
		if (typeof value === 'string') {
			const s = value.trim();
			if (!s) return null;
			// Strict Date detection to prevent URLs and Titles from falsely becoming dates
			const isDatePattern = /^\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2}/.test(s) || // YYYY-MM-DD
								  /^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4}/.test(s) || // DD-MM-YYYY
								  /^\d{4}[-\/\.]\d{1,2}$/.test(s) ||             // YYYY-MM
								  /^[a-zA-Z]{3,}\s+\d{1,2},?\s+\d{4}/.test(s);   // Oct 15, 2024
			
			if (isDatePattern && extractDate(s) !== null) {
				return 'date';
			}
			// Numeric string
			if (!isNaN(Number(s))) return 'number';
		}
		return 'text';
	}

	private dominantType(types: FieldType[]): FieldType {
		if (types.length === 0) return 'text';

		const counts = new Map<FieldType, number>();
		for (const t of types) {
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		
		// Return strictly the most frequently occurring ACTUAL type.
		// Since we now ignore null/empty fields entirely, if Date is the most common among non-empty fields, it wins cleanly.
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'text';
	}

	private extractSamples(values: unknown[], type: FieldType): string[] {
		const seen = new Set<string>();
		const samples: string[] = [];

		for (const v of values) {
			if (samples.length >= 5) break;

			if (type === 'array' && Array.isArray(v)) {
				for (const item of v) {
					if (samples.length >= 5) break;
					const s = String(item).trim();
					if (s && !seen.has(s)) { seen.add(s); samples.push(s); }
				}
			} else {
				const s = String(v ?? '').trim();
				if (s && !seen.has(s)) { seen.add(s); samples.push(s); }
			}
		}

		return samples;
	}

	/**
	 * Incrementally updates the collection schema with metadata from a single modified file.
	 * Avoids scanning the entire vault by merging new keys/types O(1).
	 */
	updateSchemaWithFile(file: TFile, col: CollectionConfig, totalFiles: number): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return false;

		let changed = false;
		const schemaMap = new Map<string, SchemaField>((col.schema || []).map(f => [f.key, f]));

		for (const [key, value] of Object.entries(fm)) {
			if (key === 'position') continue;

			const inferred = this.inferType(value);
			if (inferred === null) continue;

			const existing = schemaMap.get(key);
			if (!existing) {
				const newField: SchemaField = {
					key,
					type: inferred,
					sampleValues: this.extractSamples([value], inferred),
					coverage: 1 / Math.max(1, totalFiles)
				};
				schemaMap.set(key, newField);
				changed = true;
			} else {
				const oldSamples = [...existing.sampleValues];
				const newSamples = this.extractSamples([value, ...oldSamples], existing.type);
				if (JSON.stringify(oldSamples) !== JSON.stringify(newSamples)) {
					existing.sampleValues = newSamples;
					changed = true;
				}
				if (existing.type === 'text' && inferred !== 'text') {
					existing.type = inferred;
					changed = true;
				}
			}
		}

		if (changed) {
			col.schema = [...schemaMap.values()].sort((a, b) => b.coverage - a.coverage || a.key.localeCompare(b.key));
		}
		return changed;
	}
}
