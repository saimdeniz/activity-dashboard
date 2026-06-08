import { Chart } from 'chart.js';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { CHART_PALETTE } from '../types';
import { generatePalette } from '../utils/ColorUtils';

const MONTHS = GenericAggregator.MONTHS;

/**
 * Renders a distribution chart (pie / doughnut / bar-horizontal / bar-vertical / polarArea)
 * for any text or array frontmatter field.
 */
export function renderDistributionWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	charts: Chart[];
	cssVar: (v: string) => string;
	collectionColor: string;
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, charts, cssVar, collectionColor, onDrilldown } = params;
	const topN = config.topN ?? 12;
	const data = GenericAggregator.distribution(records, config.field, topN);
	const chartType = config.chartType ?? 'doughnut';

	if (!data.length) {
		el.createDiv({ text: 'No data for this field.', cls: 'dash-widget-empty' });
		return;
	}

	const text = cssVar('--text-muted') || '#888';
	const gridColor = cssVar('--background-modifier-border') || '#333';

	const labels = data.map(([l]) => l);
	const values = data.map(([, v]) => v);
	
	// Dynamic palette generation: ensures harmonious, non-repeating colors
	const colors = generatePalette(collectionColor, labels.length);

	// Enhanced Boolean Detection: If the data contains explicit boolean strings, prettify them
	labels.forEach((label, i) => {
		if (label.toLowerCase() === 'true') {
			labels[i] = config.trueLabel || 'True (Yes)';
			colors[i] = cssVar('--interactive-success') || '#4ade80';
		} else if (label.toLowerCase() === 'false') {
			labels[i] = config.falseLabel || 'False (No)';
			colors[i] = cssVar('--text-error') || '#f87171';
		}
	});

	const canvas = el.createEl('canvas', { cls: 'dash-canvas' });

	const isHBar = chartType === 'bar-horizontal';
	const isVBar = chartType === 'bar-vertical';
	const isBar  = isHBar || isVBar;
	const isLineOrRadar = chartType === 'line';

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
				backgroundColor: isBar || isLineOrRadar 
					? colors.map(c => c.replace('hsl(', 'hsla(').replace(')', ', 0.8)')) 
					: colors,
				borderColor: isLineOrRadar ? colors[0] : 'transparent',
				borderWidth: isLineOrRadar ? 2 : 0,
				borderRadius: isBar ? 4 : 0,
				fill: isLineOrRadar ? true : undefined,
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
			scales: (isBar || chartType === 'line') ? {
				x: {
					ticks: { color: text, font: { size: 11 } },
					grid: { color: isHBar ? gridColor : 'transparent' },
					beginAtZero: true,
				},
				y: {
					ticks: { color: text, font: { size: 11 } },
					grid: { color: isVBar || chartType === 'line' ? gridColor : 'transparent' },
					beginAtZero: true,
				},
			} : {},
		},
	}));
}
