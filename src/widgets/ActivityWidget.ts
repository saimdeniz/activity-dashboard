import { Chart, registerables } from 'chart.js';
import { Menu } from 'obsidian';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { CHART_PALETTE } from '../types';
import { generatePalette } from '../utils/ColorUtils';

Chart.register(...registerables);

type Resolution = 'Monthly' | 'Weekly' | 'Yearly';

/**
 * Renders a stacked bar activity chart (monthly / weekly / yearly) based on a date field.
 */
export function renderActivityWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	charts: Chart[];
	cssVar: (v: string) => string;
	collectionColor: string;
	onDrilldown?: (filterValue: string | null) => void;
	onSave?: () => Promise<void>;
}): void {
	const { el, records, config, charts, cssVar, collectionColor, onDrilldown, onSave } = params;
	const dateField = config.field;

	const data = GenericAggregator.activity(records, dateField);
	const hasData = [...data.monthly, ...data.weekly, ...Object.values(data.yearly)].some(v => v > 0);

	if (!hasData) {
		el.createDiv({ text: 'No date data found for this field.', cls: 'dash-widget-empty' });
		return;
	}

	const text     = cssVar('--text-muted') || '#888';
	const gridCol  = cssVar('--background-modifier-border') || '#333';
	const color    = collectionColor || CHART_PALETTE[0];

	// Resolution selector
	const toolbar = el.createDiv('dash-activity-toolbar');
	const labelEl = toolbar.createEl('button', { cls: 'dash-activity-res-btn' });
	
	let activeRes: Resolution = config.activityResolution ?? 'Monthly';
	labelEl.createSpan({ text: activeRes });

	const wrapper = el.createDiv('dash-canvas-container');
	const canvas  = wrapper.createEl('canvas', { cls: 'dash-canvas-wide' });

	let chart: Chart | null = null;

	const getDataset = (res: Resolution) => {
		if (res === 'Monthly') return {
			labels: GenericAggregator.MONTHS,
			values: data.monthly,
		};
		if (res === 'Weekly') return {
			labels: Array.from({ length: 53 }, (_, i) => `W${String(i + 1).padStart(2, '0')}`),
			values: data.weekly,
		};
		const years = Object.keys(data.yearly).sort();
		return {
			labels: years,
			values: years.map(y => data.yearly[y] ?? 0),
		};
	};

	const drawChart = (res: Resolution, isUserChange = false) => {
		activeRes = res;
		labelEl.querySelector('span')!.textContent = res;
		
		if (isUserChange) {
			config.activityResolution = res;
			if (onSave) void onSave();
		}

		if (chart) {
			const idx = charts.indexOf(chart);
			if (idx > -1) charts.splice(idx, 1);
			chart.destroy();
		}

		const { labels, values } = getDataset(res);
		const chartType = config.chartType ?? 'bar-vertical';
		const isHBar = chartType === 'bar-horizontal';
		const isVBar = chartType === 'bar-vertical';
		const isBar  = isHBar || isVBar;
		const isLineOrRadar = chartType === 'line';

		let displayLegend = !isBar;
		if (config.legendPosition === 'hidden') displayLegend = false;
		else if (config.legendPosition) displayLegend = true;

		const bgColors = generatePalette(color, labels.length).map(c => {
			return (isBar || isLineOrRadar) ? c.replace('hsl(', 'hsla(').replace(')', ', 0.8)') : c;
		});
		const borderColors = isLineOrRadar ? color : 'transparent';

		chart = new Chart(canvas, {
			type: isBar ? 'bar' : (chartType as 'line' | 'bar' | 'pie' | 'doughnut'),
			data: {
				labels,
				datasets: [{
					label: config.title,
					data: values,
					backgroundColor: isLineOrRadar ? (color + '33') : bgColors,
					borderColor: borderColors,
					borderWidth: isLineOrRadar ? 2 : 0,
					borderRadius: isBar ? 3 : 0,
					fill: isLineOrRadar ? true : undefined,
				}],
			},
			options: {
				indexAxis: isHBar ? 'y' : 'x',
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				onClick: (e, activeElements: import('chart.js').ActiveElement[]) => {
					if (onDrilldown && activeElements.length > 0) {
						const index = activeElements[0].index;
						onDrilldown(labels[index]);
					}
				},
				plugins: {
					legend: {
						display: displayLegend,
						position: config.legendPosition !== 'hidden' && config.legendPosition ? config.legendPosition : 'right',
						labels: { color: text, boxWidth: 14, useBorderRadius: true, borderRadius: 5, font: { size: 11 } },
					},
					tooltip: {
						callbacks: {
							label: (context: import('chart.js').TooltipItem<'line' | 'bar' | 'pie' | 'doughnut'>) => {
								let label = context.dataset.label || '';
								if (label) {
									label += ': ';
								}
								const val = context.raw as number;
								label += val;
								const chartType = (context.chart.config as { type?: string }).type;
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
						ticks: { color: text, autoSkip: true, maxTicksLimit: 20, font: { size: 11 } },
						grid: { display: false, color: isHBar ? gridCol : 'transparent' },
					},
					y: {
						ticks: { color: text, stepSize: 1, font: { size: 11 } },
						grid: { color: isVBar || chartType === 'line' ? gridCol : 'transparent' },
						beginAtZero: true,
					},
				} : {},
			},
		});

		charts.push(chart);
	};

	labelEl.onclick = (e) => {
		e.stopPropagation();
		const menu = new Menu();
		(['Weekly', 'Monthly', 'Yearly'] as Resolution[]).forEach(res => {
			menu.addItem(item => {
				item.setTitle(res);
				item.setChecked(activeRes === res);
				item.onClick(() => drawChart(res, true));
			});
		});
		const rect = labelEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	};

	drawChart(activeRes);
}
