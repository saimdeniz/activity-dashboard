import { setIcon } from 'obsidian';
import type { RawRecord, WidgetConfig } from '../types';
import { GenericAggregator } from '../core/GenericAggregator';
import { formatDateUTC, extractDate } from '../utils/dateUtils';
import { hexToHsl } from '../utils/ColorUtils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Renders a GitHub-style 52-week activity matrix (Heatmap).
 * In month mode, renders a compact monthly calendar grid instead.
 */
export function renderHeatmapWidget(params: {
	el: HTMLElement;
	records: RawRecord[];
	config: WidgetConfig;
	cssVar: (v: string) => string;
	collectionColor: string;
	year?: number | 'all-time';
	month?: number;
	mode?: 'year' | 'library' | 'month';
	onDrilldown?: (filterValue: string | null) => void;
}): void {
	const { el, records, config, collectionColor, year, month, mode, onDrilldown } = params;
	const dateField = config.field;
	const numericField = config.heatmapIntensityField;
	const rangeOptions = {
		spreadDateRange: config.spreadDateRange,
		rangeStartField: config.rangeStartField,
		rangeEndField: config.rangeEndField,
	};

	// Collect all available years with records
	const yearCounts = new Map<number, number>();
	for (const r of records) {
		if (config.spreadDateRange) {
			const sField = config.rangeStartField?.trim() || dateField;
			const eField = config.rangeEndField?.trim();
			const dStart = extractDate(r.fields[sField]);
			const dEnd = eField ? extractDate(r.fields[eField]) : null;
			if (dStart && dEnd) {
				const yStart = Math.min(dStart.getUTCFullYear(), dEnd.getUTCFullYear());
				const yEnd = Math.max(dStart.getUTCFullYear(), dEnd.getUTCFullYear());
				for (let y = yStart; y <= yEnd; y++) {
					yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
				}
				continue;
			}
		}

		const d = extractDate(r.fields[dateField]);
		if (d) {
			const y = d.getUTCFullYear();
			yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
		}
	}
	const availableYears = Array.from(yearCounts.keys()).sort((a, b) => b - a);
	const currentYear = new Date().getUTCFullYear();

	let activeHeatmapYear: number;
	const isControlledByGlobalYear = typeof year === 'number' && year > 0;

	if (isControlledByGlobalYear) {
		activeHeatmapYear = year;
	} else if (availableYears.includes(currentYear)) {
		activeHeatmapYear = currentYear;
	} else {
		const pastOrCurrent = availableYears.filter(y => y <= currentYear);
		if (pastOrCurrent.length > 0) {
			activeHeatmapYear = pastOrCurrent[0];
		} else if (availableYears.length > 0) {
			activeHeatmapYear = availableYears[0];
		} else {
			activeHeatmapYear = currentYear;
		}
	}

	// Compute base colors based on collectionColor and theme mode
	const hsl = hexToHsl(collectionColor) || { h: 240, s: 70, l: 60 };
	const h = hsl.h;
	const s = hsl.s;
	const isDark = !(typeof activeDocument !== 'undefined' && activeDocument.body ? activeDocument.body : document.body).classList.contains('theme-light');

	// 5 levels of color (Level 0 = empty track background)
	const colorL1 = isDark ? `hsl(${h}, ${Math.max(25, s - 15)}%, 28%)` : `hsl(${h}, ${Math.max(30, s - 10)}%, 78%)`;
	const colorL2 = isDark ? `hsl(${h}, ${Math.max(35, s - 5)}%, 42%)` : `hsl(${h}, ${Math.max(40, s)}%, 62%)`;
	const colorL3 = isDark ? `hsl(${h}, ${Math.max(45, s + 5)}%, 58%)` : `hsl(${h}, ${Math.max(50, s + 10)}%, 48%)`;
	const colorL4 = isDark ? `hsl(${h}, ${Math.max(55, s + 15)}%, 74%)` : `hsl(${h}, ${Math.max(60, s + 20)}%, 34%)`;

	const getCellColor = (val: number, max: number): string => {
		if (val <= 0) return 'var(--dash-heatmap-empty, var(--background-modifier-border-focus, rgba(255,255,255,0.06)))';

		if (!numericField) {
			// Discrete activity count mode: 1 is always L1, 2 is L2, 3 is L3, 4+ is L4
			if (max <= 4) {
				if (val <= 1) return colorL1;
				if (val === 2) return colorL2;
				if (val === 3) return colorL3;
				return colorL4;
			} else {
				if (val <= 1) return colorL1;
				const ratio = val / max;
				if (ratio <= 0.35) return colorL2;
				if (ratio <= 0.70) return colorL3;
				return colorL4;
			}
		}

		// Numeric intensity mode (e.g. playtime, pages)
		const effectiveMax = Math.max(max, 1);
		const ratio = val / effectiveMax;
		if (ratio <= 0.25) return colorL1;
		if (ratio <= 0.50) return colorL2;
		if (ratio <= 0.75) return colorL3;
		return colorL4;
	};

	const container = el.createDiv('dash-heatmap-container');

	// ── Month Mode: Calendar Grid ──────────────────────────────────────────────
	if (mode === 'month' && typeof month === 'number' && month >= 1 && month <= 12 && typeof activeHeatmapYear === 'number') {
		renderMonthGrid(container, records, dateField, numericField, activeHeatmapYear, month, getCellColor, onDrilldown, rangeOptions);
		return;
	}

	// ── Year / Library Mode: 52-week GitHub Grid ───────────────────────────────
	const renderGrid = (targetYear: number) => {
		container.empty();

		const data = GenericAggregator.heatmap(records, dateField, numericField, targetYear, rangeOptions);

		// Header summary row with Year Navigator
		const summaryRow = container.createDiv('dash-heatmap-summary');
		const periodText = String(targetYear);
		const totalText = numericField
			? `${data.total.toLocaleString()} total ${numericField} in ${periodText}`
			: `${data.total} ${data.total === 1 ? 'activity' : 'activities'} in ${periodText}`;
		summaryRow.createSpan({ text: totalText, cls: 'dash-heatmap-total' });

		// Year navigator: ONLY show inside Heatmap in Library/All-Time mode where there is no global year picker
		const allNavYears = Array.from(new Set([...availableYears, currentYear, targetYear])).sort((a, b) => b - a);
		if (!isControlledByGlobalYear && (allNavYears.length > 1 || year === 'all-time')) {
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
				renderGrid(activeHeatmapYear);
			};

			nextBtn.onclick = (e) => {
				e.stopPropagation();
				if (currIdx !== -1 && currIdx > 0) {
					activeHeatmapYear = allNavYears[currIdx - 1];
				} else {
					activeHeatmapYear = targetYear + 1;
				}
				renderGrid(activeHeatmapYear);
			};
		}

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
		monthPositions.forEach(({ month: mIdx, weekIdx: wIdx }) => {
			const monthLabel = monthsHeader.createDiv('dash-heatmap-month-label');
			monthLabel.setCssStyles({ left: `${(wIdx / totalWeeks) * 100}%` });
			monthLabel.setText(MONTH_NAMES[mIdx]);
		});

		// Footer legend (Less [ ][ ][ ][ ][ ] More)
		const footer = container.createDiv('dash-heatmap-footer');
		const legend = footer.createDiv('dash-heatmap-legend');
		legend.createSpan({ text: 'Less', cls: 'dash-heatmap-legend-text' });

		const levels = [0, 1, 2, 3, 4];
		levels.forEach((lvl) => {
			const swatch = legend.createDiv('dash-heatmap-legend-cell');
			const testVal = numericField ? (lvl === 0 ? 0 : (lvl / 4) * (data.max || 1)) : lvl;
			swatch.setCssStyles({ backgroundColor: getCellColor(testVal, data.max || 1) });
		});

		legend.createSpan({ text: 'More', cls: 'dash-heatmap-legend-text' });
	};

	renderGrid(activeHeatmapYear);
}

// ── Monthly Calendar Heatmap ───────────────────────────────────────────────────
function renderMonthGrid(
	container: HTMLElement,
	records: RawRecord[],
	dateField: string,
	numericField: string | undefined,
	year: number,
	month: number, // 1-based
	getCellColor: (val: number, max: number) => string,
	onDrilldown?: (filterValue: string | null) => void,
	rangeOptions?: {
		spreadDateRange?: boolean;
		rangeStartField?: string;
		rangeEndField?: string;
	},
): void {
	// Compute heatmap data for the specific year
	const data = GenericAggregator.heatmap(records, dateField, numericField, year, rangeOptions);

	// Count totals only within the target month
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	let monthTotal = 0;
	let monthMax = 0;
	for (let d = 1; d <= daysInMonth; d++) {
		const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		const val = data.daily[key] ?? 0;
		monthTotal += val;
		if (val > monthMax) monthMax = val;
	}
	monthTotal = Math.round(monthTotal * 100) / 100;

	const mName = MONTH_NAMES[month - 1];
	const mNameFull = MONTH_NAMES_FULL[month - 1];

	// ── Header row ────────────────────────────────────────────────
	const summaryRow = container.createDiv('dash-heatmap-summary');
	const totalLabel = numericField
		? `${monthTotal.toLocaleString()} total ${numericField} in ${mName} ${year}`
		: `${monthTotal} ${monthTotal === 1 ? 'activity' : 'activities'} in ${mName} ${year}`;
	summaryRow.createSpan({ text: totalLabel, cls: 'dash-heatmap-total' });

	// ── Month Calendar Grid ───────────────────────────────────────
	const calWrap = container.createDiv('dash-heatmap-cal-wrap');

	// Weekday header row: Mon Tue Wed Thu Fri Sat Sun
	const headerRow = calWrap.createDiv('dash-heatmap-cal-header');
	WEEKDAY_HEADERS.forEach(label => {
		headerRow.createDiv({ text: label, cls: 'dash-heatmap-cal-weekday' });
	});

	// Grid area — 7 columns
	const grid = calWrap.createDiv('dash-heatmap-cal-grid');

	// First day of month: what weekday? (0=Mon ... 6=Sun, ISO-style)
	const firstDayDate = new Date(Date.UTC(year, month - 1, 1));
	const firstWeekday = (firstDayDate.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun

	// Leading empty cells
	for (let i = 0; i < firstWeekday; i++) {
		const blank = grid.createDiv('dash-heatmap-cal-cell dash-heatmap-cal-cell-blank');
		blank.setAttribute('aria-hidden', 'true');
	}

	// Day cells
	for (let day = 1; day <= daysInMonth; day++) {
		const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		const val = data.daily[dateStr] ?? 0;
		const effectiveMax = Math.max(monthMax, data.max || 0);
		const bgColor = getCellColor(val, effectiveMax);

		const cell = grid.createDiv('dash-heatmap-cal-cell');
		cell.setCssStyles({ backgroundColor: bgColor });

		// Day number label
		cell.createSpan({ text: String(day), cls: 'dash-heatmap-cal-day-num' });

		// Tooltip
		const valLabel = numericField ? `${val} (${numericField})` : `${val} record${val === 1 ? '' : 's'}`;
		const tooltip = `${mNameFull} ${day}, ${year}: ${valLabel}`;
		cell.setAttribute('title', tooltip);
		cell.setAttribute('aria-label', tooltip);

		// Clickable if has data
		if (val > 0 && onDrilldown) {
			cell.addClass('dash-clickable');
			cell.onclick = (e) => {
				e.stopPropagation();
				onDrilldown(dateStr);
			};
		}
	}

	// Trailing empty cells to fill last row
	const totalCells = firstWeekday + daysInMonth;
	const trailingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
	for (let i = 0; i < trailingCells; i++) {
		const blank = grid.createDiv('dash-heatmap-cal-cell dash-heatmap-cal-cell-blank');
		blank.setAttribute('aria-hidden', 'true');
	}

	// ── Footer legend ─────────────────────────────────────────────
	const footer = container.createDiv('dash-heatmap-footer');
	const legend = footer.createDiv('dash-heatmap-legend');
	legend.createSpan({ text: 'Less', cls: 'dash-heatmap-legend-text' });

	const levels = [0, 1, 2, 3, 4];
	const effectiveMax = Math.max(monthMax, data.max || 0);
	levels.forEach((lvl) => {
		const swatch = legend.createDiv('dash-heatmap-legend-cell');
		const testVal = numericField ? (lvl === 0 ? 0 : (lvl / 4) * (effectiveMax || 1)) : lvl;
		swatch.setCssStyles({ backgroundColor: getCellColor(testVal, effectiveMax) });
	});

	legend.createSpan({ text: 'More', cls: 'dash-heatmap-legend-text' });
}
