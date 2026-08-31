import { Chart } from 'chart.js';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { generatePalette } from '../utils/ColorUtils';
import { buildTooltipLabelCallback, buildScalesConfig } from '../utils/ChartUtils';

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
	colorTheme?: 'classic' | 'pastel' | 'neon' | 'monochrome';
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, charts, cssVar, collectionColor, colorTheme, onDrilldown } = params;
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
	const colors = generatePalette(collectionColor, labels.length, colorTheme);

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

	const wrapper = el.createDiv('dash-canvas-container');
	const canvas = wrapper.createEl('canvas', { cls: 'dash-canvas' });

	const isHBar = chartType === 'bar-horizontal';
	const isVBar = chartType === 'bar-vertical';
	const isBar  = isHBar || isVBar;
	const isLineOrRadar = chartType === 'line' || chartType === 'radar';

	const isMini = config.size?.height === 'mini';
	const isNarrow = (config.size?.span ?? 6) <= 4;

	let displayLegend = !isBar;
	if (isMini) {
		displayLegend = false;
	} else if (config.legendPosition === 'hidden') {
		displayLegend = false;
	} else if (config.legendPosition) {
		displayLegend = true;
	}

	let legendPos: 'top' | 'left' | 'bottom' | 'right' = 'right';
	if (config.legendPosition && config.legendPosition !== 'hidden') {
		legendPos = config.legendPosition;
	} else if (isNarrow) {
		legendPos = 'bottom';
	}

	charts.push(new Chart(canvas, {
		type: isBar ? 'bar' : (chartType as 'line' | 'bar' | 'pie' | 'doughnut' | 'radar'),
		data: {
			labels,
			datasets: [{
				label: config.field,
				data: values,
				backgroundColor: (isBar || isLineOrRadar)
					? colors.map(c => c.startsWith('#') ? c + 'cc' : c) 
					: colors,
				borderColor: isLineOrRadar ? (colors[0] || '#818cf8') : 'transparent',
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
			cutout: chartType === 'doughnut' ? (isMini ? '52%' : '58%') : undefined,
			layout: {
				padding: isMini ? 2 : 6,
			},
			onClick: (e, activeElements: import('chart.js').ActiveElement[]) => {
				if (onDrilldown && activeElements.length > 0) {
					const index = activeElements[0].index;
					onDrilldown(labels[index]);
				}
			},
			plugins: {
				legend: {
					display: displayLegend,
					position: legendPos,
					labels: { 
						color: text, 
						boxWidth: isNarrow ? 8 : 12, 
						useBorderRadius: true,
						borderRadius: 4,
						padding: isNarrow ? 6 : 8,
						font: { size: isNarrow ? 10 : 11 } 
					},
				},
				tooltip: {
					callbacks: {
						label: buildTooltipLabelCallback()
					}
				}
			},
			scales: buildScalesConfig(chartType, text, gridColor, isHBar),
		} as import('chart.js').ChartOptions,
	}));
}
