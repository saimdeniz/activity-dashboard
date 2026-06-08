import { Chart } from 'chart.js';
import { type RawRecord, type WidgetConfig, CHART_PALETTE } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';

/**
 * Renders a ranked list of records by a numeric field value.
 */
export function renderRankingWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	charts: Chart[];
	cssVar: (v: string) => string;
	collectionColor: string;
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, charts, cssVar, collectionColor, onDrilldown } = params;
	const topN = config.topN ?? 10;
	const chartType = config.chartType ?? 'list';

	// Formula-based ranking: evaluate expression per record, sort by result
	const ranked: [string, number][] = (config.aggregation === 'formula' && config.mathExpression)
		? GenericAggregator.formulaRanking(records, config.mathExpression, topN)
		: GenericAggregator.ranking(records, config.field, topN);

	if (!ranked.length) {
		el.createDiv({ text: 'No data for this field.', cls: 'dash-widget-empty' });
		return;
	}

	if (chartType === 'list') {
		const maxVal = ranked[0]?.[1] ?? 1;
		const list = el.createDiv('dash-ranking-list');

		ranked.forEach(([label, value], i) => {
			const row = list.createDiv('dash-ranking-row');
			if (onDrilldown) {
				row.addClass('dash-clickable');
				row.onclick = () => onDrilldown(label);
			}
			const pct = maxVal > 0 ? (value / maxVal) * 100 : 0;

			row.createDiv({ text: String(i + 1), cls: 'dash-ranking-pos' });

			const body = row.createDiv('dash-ranking-body');
			body.createDiv({ text: label, cls: 'dash-ranking-label' });

			const barTrack = body.createDiv('dash-ranking-bar-track');
			const barFill = barTrack.createDiv('dash-ranking-bar-fill');
			barFill.style.width = `${pct}%`;
			barFill.style.backgroundColor = CHART_PALETTE[i % CHART_PALETTE.length];

			row.createDiv({ text: formatValue(value), cls: 'dash-ranking-value' });
		});
		return;
	}

	// Chart rendering
	const text = cssVar('--text-muted') || '#888';
	const gridColor = cssVar('--background-modifier-border') || '#333';
	const labels = ranked.map(([l]) => l);
	const values = ranked.map(([, v]) => v);
	const colors = CHART_PALETTE.slice(0, labels.length) as string[];

	const canvas = el.createEl('canvas', { cls: 'dash-canvas' });

	const isHBar = chartType === 'bar-horizontal';
	const isVBar = chartType === 'bar-vertical';
	const isBar  = isHBar || isVBar;
	const isLine = chartType === 'line';

	let displayLegend = !isBar;
	if (config.legendPosition === 'hidden') displayLegend = false;
	else if (config.legendPosition) displayLegend = true;

	charts.push(new Chart(canvas, {
		type: isBar ? 'bar' : (chartType as any),
		data: {
			labels,
			datasets: [{
				label: config.field,
				data: values,
				backgroundColor: isBar || isLine ? colors.map(c => c + 'cc') : colors,
				borderColor: isLine ? colors[0] : 'transparent',
				borderWidth: isLine ? 2 : 0,
				borderRadius: isBar ? 4 : 0,
				fill: isLine ? true : undefined,
			}],
		},
		options: {
			indexAxis: isHBar ? 'y' : 'x',
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			onClick: (e, activeElements) => {
				if (onDrilldown && activeElements.length > 0) {
					const index = activeElements[0].index;
					onDrilldown(labels[index]);
				}
			},
			plugins: {
				legend: {
					display: displayLegend,
					position: config.legendPosition !== 'hidden' && config.legendPosition ? config.legendPosition : 'right',
					labels: { 
						color: text, 
						boxWidth: 14, 
						useBorderRadius: true,
						borderRadius: 5,
						font: { size: 11 } 
					},
				},
				tooltip: {
					callbacks: {
						label: (context: any) => {
							let label = context.dataset.label || '';
							if (label) {
								label += ': ';
							}
							const val = context.raw as number;
							label += val;
							const chartType = context.chart.config.type;
							if (chartType === 'pie' || chartType === 'doughnut') {
								const dataArr = context.chart.data.datasets[0].data as number[];
								const total = dataArr.reduce((a, b) => a + (Number(b) || 0), 0);
								if (total > 0) {
									const pct = ((val / total) * 100).toFixed(1);
									label += ` (${pct}%)`;
								}
							}
							return label;
						}
					}
				}
			},
			scales: (isBar || isLine) ? {
				x: {
					ticks: { color: text, font: { size: 11 } },
					grid: { color: isHBar ? gridColor : 'transparent' },
					beginAtZero: true,
				},
				y: {
					ticks: { color: text, font: { size: 11 } },
					grid: { color: isVBar || isLine ? gridColor : 'transparent' },
					beginAtZero: true,
				},
			} : {},
		},
	}));
}

function formatValue(n: number): string {
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (Number.isInteger(n)) return String(n);
	return n.toFixed(1);
}
