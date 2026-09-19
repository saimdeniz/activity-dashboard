import { setIcon } from 'obsidian';
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
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, onDrilldown } = params;
	const agg = config.aggregation ?? 'count';

	let evalRecords = records;
	if (config.spreadDateRange) {
		evalRecords = records.map(r => {
			if (!r.prorationFactor || r.prorationFactor >= 1) return r;
			const scaledFields = { ...r.fields };
			const rawVal = r.fields[config.field];
			if (typeof rawVal === 'number') {
				scaledFields[config.field] = Math.round((rawVal * r.prorationFactor) * 100) / 100;
			}
			return { ...r, fields: scaledFields };
		});
	}

	const summary = agg === 'formula' && config.mathExpression 
		? (config.spreadDateRange
			? GenericAggregator.formulaSummary(records.map(r => {
				if (!r.prorationFactor || r.prorationFactor >= 1) return r;
				const scaledFields: Record<string, unknown> = { ...r.fields };
				for (const [k, v] of Object.entries(r.fields)) {
					if (typeof v === 'number') {
						scaledFields[k] = Math.round((v * r.prorationFactor) * 100) / 100;
					}
				}
				return { ...r, fields: scaledFields };
			}), config.mathExpression)
			: GenericAggregator.formulaSummary(records, config.mathExpression))
		: GenericAggregator.numericSummary(evalRecords, config.field);

	let value: number;
	switch (agg) {
		case 'formula': value = summary.sum;     break;
		case 'sum':     value = summary.sum;     break;
		case 'average': value = summary.average; break;
		case 'min':     value = summary.min;     break;
		case 'max':     value = summary.max;     break;
		default:
			if (config.spreadDateRange && (!config.field || !config.field.trim())) {
				// Prorated count: sum fractional portions of each record that falls in this period
				value = evalRecords.reduce((acc, r) => acc + (r.prorationFactor ?? 1), 0);
			} else {
				value = (!config.field || !config.field.trim()) ? records.length : summary.count;
			}
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
