import { setIcon } from 'obsidian';
import type { Chart } from 'chart.js';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { formatValue } from '../utils/ChartUtils';

/**
 * Renders a single large metric card — sum / average / count / min / max
 * of a numeric frontmatter field.
 */
export function renderNumberCardWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	charts?: Chart[];
	cssVar?: (v: string) => string;
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, onDrilldown } = params;
	const agg = config.aggregation ?? 'count';

	const summary = agg === 'formula' && config.mathExpression 
		? GenericAggregator.formulaSummary(records, config.mathExpression)
		: GenericAggregator.numericSummary(records, config.field);

	let value: number;
	switch (agg) {
		case 'formula': value = summary.sum;     break;
		case 'sum':     value = summary.sum;     break;
		case 'average': value = summary.average; break;
		case 'min':     value = summary.min;     break;
		case 'max':     value = summary.max;     break;
		default:        value = summary.count;
	}

	const aggLabel: Record<string, string> = {
		formula: 'Formula', sum: 'Total', average: 'Average', count: 'Count', min: 'Minimum', max: 'Maximum',
	};

	const card = el.createDiv('dash-number-card');
	const iconEl = card.createDiv('dash-number-icon');
	setIcon(iconEl, config.icon ?? 'hash');

	card.createDiv({ text: formatValue(value, 2), cls: 'dash-number-value' });
	card.createDiv({ text: `${aggLabel[agg] ?? agg} · ${records.length} records`, cls: 'dash-number-label' });

	if (onDrilldown) {
		card.addClass('dash-clickable');
		card.onclick = () => onDrilldown(null);
	}
}
