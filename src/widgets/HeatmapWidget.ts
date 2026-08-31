import { setIcon } from 'obsidian';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { formatDateUTC, extractDate } from '../utils/dateUtils';
import { hexToHsl } from '../utils/ColorUtils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

/**
 * Renders a GitHub-style 52-week activity matrix (Heatmap).
 */
export function renderHeatmapWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	cssVar: (v: string) => string;
	collectionColor: string;
	year?: number | 'all-time';
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, collectionColor, year, onDrilldown } = params;
	const dateField = config.field;
	const numericField = config.heatmapIntensityField;

	// Collect all available years with records
	const yearCounts = new Map<number, number>();
	for (const r of records) {
		const d = extractDate(r.fields[dateField]);
		if (d) {
			const y = d.getUTCFullYear();
			yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
		}
	}
	const availableYears = Array.from(yearCounts.keys()).sort((a, b) => b - a);
	const currentYear = new Date().getFullYear();

	let activeHeatmapYear: number;
	if (year && year !== 'all-time') {
		activeHeatmapYear = year;
	} else if (availableYears.includes(currentYear)) {
		activeHeatmapYear = currentYear;
	} else {
		// Prefer current year or most recent past year (<= currentYear)
		const pastOrCurrent = availableYears.filter(y => y <= currentYear);
		if (pastOrCurrent.length > 0) {
			activeHeatmapYear = pastOrCurrent[0]; // latest past year
		} else if (availableYears.length > 0) {
			activeHeatmapYear = availableYears[0];
		} else {
			activeHeatmapYear = currentYear;
		}
	}

	const container = el.createDiv('dash-heatmap-container');

	const renderYearGrid = (targetYear: number) => {
		container.empty();

		const data = GenericAggregator.heatmap(records, dateField, numericField, targetYear);

		// Header summary row with Year Navigator
		const summaryRow = container.createDiv('dash-heatmap-summary');
		const totalText = numericField
			? `${data.total.toLocaleString()} total ${numericField} in ${targetYear}`
			: `${data.total} ${data.total === 1 ? 'activity' : 'activities'} in ${targetYear}`;
		summaryRow.createSpan({ text: totalText, cls: 'dash-heatmap-total' });

		// Year navigator: show controls when multiple years exist or in Library Stats / Overview
		const allNavYears = Array.from(new Set([...availableYears, currentYear, targetYear])).sort((a, b) => b - a);
		if (allNavYears.length > 1 || year === 'all-time') {
			const nav = summaryRow.createDiv('dash-heatmap-year-nav');
			const prevBtn = nav.createEl('button', { cls: 'dash-heatmap-nav-btn', attr: { 'aria-label': 'Older Year' } });
			setIcon(prevBtn, 'chevron-left');

			nav.createSpan({ text: String(targetYear), cls: 'dash-heatmap-year-label' });

			const nextBtn = nav.createEl('button', { cls: 'dash-heatmap-nav-btn', attr: { 'aria-label': 'Newer Year' } });
			setIcon(nextBtn, 'chevron-right');

			const currIdx = allNavYears.indexOf(targetYear);

			prevBtn.onclick = (e) => {
				e.stopPropagation();
				if (currIdx !== -1 && currIdx < allNavYears.length - 1) {
					activeHeatmapYear = allNavYears[currIdx + 1];
				} else {
					activeHeatmapYear = targetYear - 1;
				}
				renderYearGrid(activeHeatmapYear);
			};

			nextBtn.onclick = (e) => {
				e.stopPropagation();
				if (currIdx !== -1 && currIdx > 0) {
					activeHeatmapYear = allNavYears[currIdx - 1];
				} else {
					activeHeatmapYear = targetYear + 1;
				}
				renderYearGrid(activeHeatmapYear);
			};
		}

		// Compute base colors based on collectionColor and theme mode
		const hsl = hexToHsl(collectionColor) || { h: 240, s: 70, l: 60 };
		const h = hsl.h;
		const s = hsl.s;
		const isDark = !(typeof activeDocument !== 'undefined' && activeDocument.body ? activeDocument.body : document.body).classList.contains('theme-light');

		// 5 levels of color (Level 0 = empty track background)
		// In dark mode: higher activity is brighter/more saturated
		// In light mode: higher activity is darker/more saturated
		const colorL1 = isDark ? `hsl(${h}, ${Math.max(25, s - 15)}%, 28%)` : `hsl(${h}, ${Math.max(30, s - 10)}%, 78%)`;
		const colorL2 = isDark ? `hsl(${h}, ${Math.max(35, s - 5)}%, 42%)` : `hsl(${h}, ${Math.max(40, s)}%, 62%)`;
		const colorL3 = isDark ? `hsl(${h}, ${Math.max(45, s + 5)}%, 58%)` : `hsl(${h}, ${Math.max(50, s + 10)}%, 48%)`;
		const colorL4 = isDark ? `hsl(${h}, ${Math.max(55, s + 15)}%, 74%)` : `hsl(${h}, ${Math.max(60, s + 20)}%, 34%)`;

		const getCellColor = (val: number, max: number): string => {
			if (val <= 0 || max <= 0) return 'var(--dash-heatmap-empty, var(--background-modifier-border-focus, rgba(255,255,255,0.06)))';
			const ratio = val / max;
			if (ratio <= 0.25) return colorL1;
			if (ratio <= 0.50) return colorL2;
			if (ratio <= 0.75) return colorL3;
			return colorL4;
		};

		// Determine start and end dates for the 52-week calendar grid
		const startDate = new Date(Date.UTC(targetYear, 0, 1));
		const endDate = new Date(Date.UTC(targetYear, 11, 31));

		// Align to previous Monday if Jan 1 is not Monday
		const startDayOfWeek = (startDate.getUTCDay() + 6) % 7; // 0 = Mon, 6 = Sun
		const gridStart = new Date(startDate.getTime() - startDayOfWeek * 86400000);

		// Outer matrix wrapper
		const matrixWrap = container.createDiv('dash-heatmap-matrix-wrap');
		const matrix = matrixWrap.createDiv('dash-heatmap-matrix');

		// Day labels column (Mon, Wed, Fri)
		const dayLabelsCol = matrix.createDiv('dash-heatmap-day-labels');
		DAY_LABELS.forEach(lbl => {
			dayLabelsCol.createDiv({ text: lbl, cls: 'dash-heatmap-day-label' });
		});

		// Weeks container
		const weeksContainer = matrix.createDiv('dash-heatmap-weeks-container');

		// Month header labels
		const monthsHeader = weeksContainer.createDiv('dash-heatmap-months-header');
		const gridColumns = weeksContainer.createDiv('dash-heatmap-grid-columns');

		let currentMonth = -1;
		let currentDate = new Date(gridStart.getTime());
		let weekIdx = 0;
		const monthPositions: { month: number; weekIdx: number }[] = [];

		while (currentDate <= endDate) {
			const weekCol = gridColumns.createDiv('dash-heatmap-week-col');

			for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
				const cellDateStr = formatDateUTC(currentDate);
				const cellYear = currentDate.getUTCFullYear();
				const cellMonth = currentDate.getUTCMonth();
				const isCurrentTargetYear = cellYear === targetYear;

				if (isCurrentTargetYear && cellMonth !== currentMonth) {
					currentMonth = cellMonth;
					monthPositions.push({ month: cellMonth, weekIdx });
				}

				const cellVal = data.daily[cellDateStr] ?? 0;
				const cell = weekCol.createDiv('dash-heatmap-cell');

				if (!isCurrentTargetYear) {
					cell.addClass('dash-heatmap-cell-outside');
				} else {
					cell.setCssStyles({ backgroundColor: getCellColor(cellVal, data.max) });
					const valLabel = numericField ? `${cellVal} (${numericField})` : `${cellVal} record${cellVal === 1 ? '' : 's'}`;
					const tooltip = `${cellDateStr}: ${valLabel}`;
					cell.setAttribute('aria-label', tooltip);
					cell.setAttribute('title', tooltip);

					if (cellVal > 0 && onDrilldown) {
						cell.addClass('dash-clickable');
						cell.onclick = (e) => {
							e.stopPropagation();
							onDrilldown(cellDateStr);
						};
					}
				}

				currentDate = new Date(currentDate.getTime() + 86400000);
			}

			weekIdx++;
			if (weekIdx >= 54) break; // Safety cap
		}

		// Position month labels accurately above their starting week columns
		const totalWeeks = Math.max(weekIdx, 52);
		monthPositions.forEach(({ month, weekIdx: wIdx }) => {
			const monthLabel = monthsHeader.createDiv('dash-heatmap-month-label');
			monthLabel.setCssStyles({ left: `${(wIdx / totalWeeks) * 100}%` });
			monthLabel.setText(MONTH_NAMES[month]);
		});

		// Footer legend (Less [ ][ ][ ][ ][ ] More)
		const footer = container.createDiv('dash-heatmap-footer');
		const legend = footer.createDiv('dash-heatmap-legend');
		legend.createSpan({ text: 'Less', cls: 'dash-heatmap-legend-text' });

		const levels = [0, 0.25, 0.5, 0.75, 1.0];
		levels.forEach((lvl) => {
			const swatch = legend.createDiv('dash-heatmap-legend-cell');
			swatch.setCssStyles({ backgroundColor: getCellColor(lvl > 0 ? (lvl * (data.max || 1)) : 0, data.max || 1) });
		});

		legend.createSpan({ text: 'More', cls: 'dash-heatmap-legend-text' });
	};

	renderYearGrid(activeHeatmapYear);
}
