import { setIcon } from 'obsidian';
import type { Chart } from 'chart.js';
import type { CollectionConfig, RawRecord, WidgetConfig } from '../types';
import { renderDistributionWidget } from '../widgets/DistributionWidget';
import { renderNumberCardWidget } from '../widgets/NumberCardWidget';
import { renderRankingWidget } from '../widgets/RankingWidget';
import { renderActivityWidget } from '../widgets/ActivityWidget';

/**
 * WidgetFactory renders the body of a widget given its config and data.
 * Each renderer function is responsible only for filling the provided container.
 */
export class WidgetFactory {
	private cssVar: (v: string) => string;

	constructor(cssVar: (v: string) => string) {
		this.cssVar = cssVar;
	}

	render(params: {
		body: HTMLElement;
		config: WidgetConfig;
		records: RawRecord[];
		collection: CollectionConfig;
		charts: Chart[];
		colorTheme?: 'classic' | 'pastel' | 'neon' | 'monochrome';
		year?: number | 'all-time';
		onDrilldown?: (filterValue: string | null) => void;
		onSave?: () => Promise<void>;
	}): void {
		const { body, config, records, collection, charts, colorTheme, year, onDrilldown, onSave } = params;

		const base = {
			el: body,
			records,
			config,
			charts,
			cssVar: this.cssVar,
			collectionColor: collection.color,
			colorTheme,
			year,
			onDrilldown,
			onSave,
		};

		switch (config.type) {
			case 'distribution':
			case 'boolean':  // boolean is a distribution restricted to boolean fields
				renderDistributionWidget(base);
				break;
			case 'number-card':
				renderNumberCardWidget(base);
				break;
			case 'ranking':
				renderRankingWidget(base);
				break;
			case 'activity':
				renderActivityWidget(base);
				break;
			default:
				body.createDiv({ text: `Unknown widget type: ${config.type}`, cls: 'dash-widget-empty' });
		}
	}

	/** Apply Lucide icons to action buttons after they are inserted into the DOM. */
	static applyIcons(container: HTMLElement): void {
		container.querySelectorAll<HTMLButtonElement>('[data-icon]').forEach(btn => {
			const icon = btn.dataset.icon;
			if (icon) {
				setIcon(btn, icon);
				btn.removeAttribute('data-icon');
			}
		});
	}
}

/** Supported widget types with human-readable labels */
export const WIDGET_TYPE_LABELS: Record<string, string> = {
	distribution: 'Distribution Chart',
	'number-card': 'Number Card',
	ranking: 'Ranking List',
	activity: 'Activity Chart',
	boolean: 'Boolean Chart',
};

/** Chart type options with labels */
export const CHART_TYPE_LABELS: Record<string, string> = {
	doughnut: 'Donut',
	pie: 'Pie',
	'bar-horizontal': 'Bar (Horizontal)',
	'bar-vertical': 'Bar (Vertical)',
	polarArea: 'Polar Area',
	radar: 'Radar',
};

/** Aggregation options with labels */
export const AGG_LABELS: Record<string, string> = {
	count: 'Count',
	sum: 'Sum',
	average: 'Average',
	min: 'Minimum',
	max: 'Maximum',
};
