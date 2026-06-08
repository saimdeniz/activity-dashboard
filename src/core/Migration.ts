import type { CollectionConfig, DashboardSettings, WidgetConfig } from '../types';
import { COLLECTION_COLORS } from '../types';

const SCHEMA_VERSION = 3;

/**
 * Migrates old settings format (v1: Game/Series/Movie hardcoded) to v2 (dynamic collections).
 * Returns a valid DashboardSettings object.
 */
export function migrateSettings(loaded: Record<string, unknown> | null | undefined): DashboardSettings {
	const defaults: DashboardSettings = {
		schemaVersion: SCHEMA_VERSION,
		collections: [],
		activeYear: new Date().getFullYear(),
		activeMode: 'year',
		overviewPins: [],
	};

	if (!loaded || typeof loaded !== 'object') return defaults;

	// Already current version — pass through with defaults merged
	if ((loaded.schemaVersion as number) >= SCHEMA_VERSION && Array.isArray(loaded.collections)) {
		return {
			...defaults,
			...(loaded as Partial<DashboardSettings>),
		};
	}

	// ── Migrate v2 to v3 (Dual Dashboard & Date Splits) ────────────────────
	
	if ((loaded.schemaVersion as number) === 2 && Array.isArray(loaded.collections)) {
		const migratedV2 = { ...defaults, ...(loaded as Partial<DashboardSettings>) };
		migratedV2.schemaVersion = 3;
		migratedV2.collections = migratedV2.collections.map(c => {
			const lib = c.libraryWidgets || c.widgets || [];
			const yr = c.yearWidgets || c.widgets || [];
			return {
				...c,
				endDateField: c.endDateField || c.dateField,
				libraryWidgets: JSON.parse(JSON.stringify(lib)) as WidgetConfig[], // Deep clone to break reference
				yearWidgets: JSON.parse(JSON.stringify(yr)) as WidgetConfig[],
				widgets: [], // Clear old refs
			};
		});
		return migratedV2;
	}

	// ── Migrate v1 settings ──────────────────────────────────────────────────

	const collections: CollectionConfig[] = [];
	let colorIdx = 0;

	const makeCollection = (
		name: string,
		icon: string,
		scanMode: 'folder' | 'type-field',
		folderPath: string | undefined,
		typeField: string | undefined,
		typeValue: string | undefined,
		dateField: string,
	): CollectionConfig => ({
		id: uid(),
		name,
		icon,
		color: COLLECTION_COLORS[colorIdx++ % COLLECTION_COLORS.length],
		scanMode,
		folderPath,
		typeField: typeField ?? 'type',
		typeValue,
		endDateField: dateField,
		schema: [],
		libraryWidgets: [],
		yearWidgets: [],
	});

	// Old separate-folders mode
	const scanMode = (loaded.scanMode as string | undefined) ?? 'type-field';
	const typeField  = (loaded.typeField as string | undefined)  ?? 'type';

	if (loaded.enableGames !== false) {
		const folder = loaded.gameFolderPath as string | undefined;
		const value  = loaded.gameTypeValue  as string | undefined;
		if (folder || value) {
			collections.push(makeCollection(
				'Games', 'gamepad-2',
				scanMode === 'separate-folders' && folder ? 'folder' : 'type-field',
				folder || undefined, typeField, value ?? 'game', 'endDate',
			));
		}
	}

	if (loaded.enableSeries !== false) {
		const folder = loaded.seriesFolderPath as string | undefined;
		const value  = loaded.seriesTypeValue  as string | undefined;
		if (folder || value) {
			collections.push(makeCollection(
				'Series', 'tv',
				scanMode === 'separate-folders' && folder ? 'folder' : 'type-field',
				folder || undefined, typeField, value ?? 'series', 'lastWatched',
			));
		}
	}

	if (loaded.enableMovies !== false) {
		const folder = loaded.movieFolderPath as string | undefined;
		const value  = loaded.movieTypeValue  as string | undefined;
		if (folder || value) {
			collections.push(makeCollection(
				'Movies', 'film',
				scanMode === 'separate-folders' && folder ? 'folder' : 'type-field',
				folder || undefined, typeField, value ?? 'movie', 'lastWatched',
			));
		}
	}

	return {
		...defaults,
		collections,
		activeYear: (loaded.activeYear as number | 'all-time') ?? defaults.activeYear,
		activeMode: (loaded.activeMode as 'year' | 'library') ?? defaults.activeMode,
	};
}

function uid(): string {
	// crypto.randomUUID is available in modern Electron/Obsidian environments
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
