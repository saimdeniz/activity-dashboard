import type { ChartType } from '../types';

/**
 * Standard tooltip label formatter for Chart.js across all widgets.
 * Displays value and automatically calculates percentage for pie/doughnut charts.
 */
export function buildTooltipLabelCallback() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (context: any): string => {
		let label = context.dataset?.label || '';
		if (label) {
			label += ': ';
		}
		const val = Number(context.raw ?? 0);
		label += isNaN(val) ? String(context.raw ?? '') : val;
		const chartType = context.chart?.config?.type;
		if (chartType === 'pie' || chartType === 'doughnut') {
			const dataArr = (context.chart?.data?.datasets?.[0]?.data || []) as number[];
			const total = dataArr.reduce((a, b) => a + (Number(b) || 0), 0);
			if (total > 0 && !isNaN(val)) {
				const pct = ((val / total) * 100).toFixed(1);
				label += ` (${pct}%)`;
			}
		}
		return label;
	};
}

/**
 * Standard scales configuration for Bar, Line, and Radar charts.
 */
export function buildScalesConfig(chartType: ChartType | string, textColor: string, gridColor: string, isHBar = false) {
	const isBar = chartType === 'bar' || chartType === 'bar-horizontal' || chartType === 'bar-vertical';
	const isVBar = chartType === 'bar' || chartType === 'bar-vertical';

	if (isBar || chartType === 'line') {
		return {
			x: {
				ticks: { color: textColor, font: { size: 11 } },
				grid: { color: isHBar ? gridColor : 'transparent' },
				beginAtZero: true,
			},
			y: {
				ticks: { color: textColor, font: { size: 11 } },
				grid: { color: isVBar || chartType === 'line' ? gridColor : 'transparent' },
				beginAtZero: true,
			},
		};
	}

	if (chartType === 'radar') {
		return {
			r: {
				angleLines: { color: gridColor },
				grid: { color: gridColor },
				pointLabels: { color: textColor, font: { size: 10 } },
				ticks: { showLabelBackdrop: false, color: textColor, font: { size: 9 } },
			},
		};
	}

	return {};
}

/**
 * Format numbers cleanly with optional thousand abbreviation.
 */
export function formatValue(n: number, decimals = 1): string {
	if (isNaN(n) || n === null || n === undefined) return '0';
	if (n >= 100_000) return `${Math.round(n / 1000)}k`;
	if (Number.isInteger(n)) return String(n);
	return parseFloat(n.toFixed(decimals)).toString();
}
