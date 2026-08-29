// ─── Chart & Widget Enums ─────────────────────────────────────────────────────

export type ChartType = 'list' | 'doughnut' | 'pie' | 'bar-horizontal' | 'bar-vertical' | 'line' | 'radar';
export type WidgetType = 'distribution' | 'number-card' | 'ranking' | 'activity' | 'heatmap' | 'boolean';

/** Two-dimensional widget size: height (compact mini vs full small) × width (span 3/4/6/9/12) */
export interface WidgetSize {
	height: 'mini' | 'small';  // mini ≈ 145px, small ≈ 290px
	span: 3 | 4 | 6 | 9 | 12; // CSS grid column span
}

/** Legacy string size → new WidgetSize migration helper */
export function migrateSize(raw: unknown): WidgetSize {
	if (raw && typeof raw === 'object' && 'height' in raw && 'span' in raw) {
		const s = raw as Record<string, unknown>;
		return {
			height: s.height === 'mini' ? 'mini' : 'small',
			span: (typeof s.span === 'number' && [3, 4, 6, 9, 12].includes(s.span) ? s.span : 6) as 3 | 4 | 6 | 9 | 12,
		};
	}
	const legacy = raw as string;
	switch (legacy) {
		case 'mini':   return { height: 'mini',  span: 3 };
		case 'small':  return { height: 'small', span: 3 };
		case 'third':  return { height: 'small', span: 4 };
		case 'medium': return { height: 'small', span: 6 };
		case 'large':  return { height: 'small', span: 12 };
		default:       return { height: 'small', span: 6 };
	}
}

/** CSS class for a widget based on its size */
export function sizeToClass(size: WidgetSize): string {
	return `dash-widget-h-${size.height} dash-widget-s${size.span}`;
}

export type AggregationType = 'sum' | 'average' | 'count' | 'max' | 'min' | 'formula';

// ─── Schema Discovery ─────────────────────────────────────────────────────────

export type FieldType = 'text' | 'number' | 'date' | 'array' | 'boolean';

export interface SchemaField {
	key: string;
	type: FieldType;
	sampleValues: string[];  // Up to 5 most common unique values (preview)
	coverage: number;        // 0.0–1.0: fraction of files containing this field
}

// ─── Widget Configuration ─────────────────────────────────────────────────────

export interface WidgetConfig {
	id: string;
	type: WidgetType;
	title: string;
	field: string;               // SchemaField key to visualise
	filterField?: string;        // Optional specific field to pre-filter by (e.g. status)
	filterValue?: string;        // Optional exact value required for the record to be included (e.g. "Completed")
	aggregation?: AggregationType;
	mathExpression?: string;     // E.g., "(episode * duration) / 60" used when aggregation is 'formula'
	icon?: string;               // Lucide icon name for number-card widgets (default: 'hash')
	chartType?: ChartType;
	legendPosition?: 'bottom' | 'right' | 'hidden';
	size: WidgetSize;
	topN?: number;               // Limit entries (default 12)
	pinnedToOverview?: boolean;
	activityResolution?: 'Monthly' | 'Weekly' | 'Yearly';
	heatmapIntensityField?: string; // Optional numeric field to calculate heatmap cell intensity instead of just count
	trueLabel?: string;
	falseLabel?: string;
}

// ─── Drilldown Card View Config ───────────────────────────────────────────────

export interface DrilldownConfig {
	layout: 'cards' | 'table';
	cardSize: number;          // 50–800px: min card width directly in pixels
	fields: string[];          // Gösterilecek field'lar ([] = no pills, just title)
	imageField?: string;       // Resim field adı (yalnız Cards layoutunda gösterilir)
	imageFit: 'cover' | 'contain';
	imageAspectRatio: number;  // 0.25–2.50
}

// ─── Note Detail View Config ──────────────────────────────────────────────────

export interface NoteDetailConfig {
	statusField?: string;       // Frontmatter field for quick buttons (e.g. "ownership", "readStatus", "format")
	statusOptions?: string[];   // Button options (e.g. ["Owned", "Wishlist", "Delisted"])
	highlightFields?: string[]; // Selected highlight fields (max 8)
	linksPosition?: 'cover' | 'topbar'; // 'cover' (under cover poster) or 'topbar' (topbar dropdown menu)
}

// ─── Collection Configuration ────────────────────────────────────────────────

export type ScanMode = 'folder' | 'type-field';

export interface CollectionConfig {
	id: string;
	name: string;
	icon: string;         // Lucide icon name
	color: string;        // CSS colour from predefined palette
	scanMode: ScanMode;
	folderPath?: string;  // scanMode = 'folder'
	typeField?: string;   // scanMode = 'type-field' (defaults to 'type')
	typeValue?: string;   // Value of typeField that matches this collection
	startDateField?: string;
	endDateField?: string;
	/** Year in Review filter: only include records where this field equals this value */
	yearFilterField?: string;
	yearFilterValue?: string;
	schema: SchemaField[];
	libraryWidgets: WidgetConfig[];
	yearWidgets: WidgetConfig[];
	drilldownConfig?: DrilldownConfig;
	noteDetailConfig?: NoteDetailConfig;
	
	// Deprecated fields kept for migration
	widgets?: WidgetConfig[];
	dateField?: string;
}

// ─── Global Settings ──────────────────────────────────────────────────────────

export interface OverviewPin {
	collectionId: string;
	widgetId: string;
}

export interface OverviewItem {
	type: 'pin' | 'breakdown' | 'total-items';
	id: string; // widgetId for pin, or a unique ID for global widgets
	// For pin:
	collectionId?: string;
	// For global widgets and pin overrides:
	size?: WidgetSize;
	icon?: string;
	chartType?: ChartType;
}

export interface OverviewMediaBreakdownConfig {
	size: WidgetSize;
	chartType: ChartType;
}

export interface DashboardSettings {
	schemaVersion: number;
	collections: CollectionConfig[];
	activeYear: number | 'all-time';
	activeMode: 'year' | 'library';
	overviewPins: OverviewPin[]; // Kept for minimal backup
	overviewLayout?: OverviewItem[]; // Ordered list of items on Overview
	overviewMediaBreakdown?: OverviewMediaBreakdownConfig;
	overviewTotalItems?: { size: WidgetSize; icon?: string };
	overviewColor?: string;
	colorPaletteTheme?: 'classic' | 'pastel' | 'neon' | 'monochrome';
}

// ─── Runtime data types ───────────────────────────────────────────────────────

/** A single parsed record from a vault .md file */
export interface RawRecord {
	filePath: string;
	title: string;
	fields: Record<string, unknown>;
}

/** Frequency distribution: [label, count][] sorted descending */
export type Distribution = [string, number][];

/** Summary of a numeric field across all records */
export interface NumericSummary {
	sum: number;
	average: number;
	min: number;
	max: number;
	count: number; // records where field > 0
}

/** Time-series counts for the activity widget */
export interface ActivityData {
	monthly: number[];               // 12 items (Jan–Dec)
	weekly: number[];                // 53 items (W1–W53)
	yearly: Record<string, number>;  // year string → count
}

/** Daily activity matrix data for the heatmap widget */
export interface HeatmapData {
	daily: Record<string, number>;  // YYYY-MM-DD -> count or numeric sum
	total: number;
	max: number;
}

export const COLLECTION_COLORS = [
	'#818cf8', // Indigo
	'#6366f1', // Deep Indigo
	'#3b82f6', // Sapphire Blue
	'#0ea5e9', // Sky Blue
	'#06b6d4', // Cyan
	'#14b8a6', // Teal
	'#10b981', // Emerald
	'#22c55e', // Green
	'#84cc16', // Lime
	'#eab308', // Amber / Gold
	'#f59e0b', // Warm Amber
	'#f97316', // Orange
	'#ea580c', // Sunset Orange
	'#ef4444', // Crimson Red
	'#f43f5e', // Rose
	'#ec4899', // Pink
	'#d946ef', // Fuchsia
	'#a855f7', // Purple
	'#8b5cf6', // Violet
	'#64748b', // Slate
] as const;

export const CHART_PALETTE = [
	'#818cf8', '#f472b6', '#4ade80', '#fb923c',
	'#22d3ee', '#a78bfa', '#facc15', '#fb7185',
	'#34d399', '#60a5fa', '#a855f7', '#f43f5e',
] as const;

