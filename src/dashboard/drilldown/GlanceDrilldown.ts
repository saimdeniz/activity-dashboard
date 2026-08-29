import { App, setIcon } from 'obsidian';
import type { RawRecord, CollectionConfig, WidgetConfig } from '../../types';
import { extractDate, getISOWeek, toNumber } from '../../utils/dateUtils';
import { CardRenderer } from './CardRenderer';
import { TableRenderer } from './TableRenderer';
import { DrilldownConfigPanel } from './DrilldownConfigPanel';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../../utils/ColorUtils';
import { CollectionReader } from '../../core/CollectionReader';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class GlanceDrilldown {
	private backdropEl: HTMLElement | null = null;
	private cardRenderer = new CardRenderer();
	private tableRenderer = new TableRenderer();
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor(private app: App) {}

	show(params: {
		parentEl: HTMLElement;
		col: CollectionConfig;
		config: WidgetConfig;
		initialFilter: string | null;
		records: RawRecord[];
		globalYear: number | 'all-time';
		onSaveQuiet: () => Promise<void>;
		onReloadRecords?: () => RawRecord[];
	}): void {
		this.close();

		const { col, config, initialFilter, records, globalYear, onSaveQuiet, onReloadRecords } = params;

		let drilldownYear: number | 'all-time' = globalYear;

		// ── Extract Categories / Tabs ───────────────────────────
		let catList: string[] = [];
		type ActivityResolution = 'monthly' | 'weekly' | 'yearly';
		let activityResolution: ActivityResolution = 'monthly';

		if (config.type === 'activity' && initialFilter) {
			if (/^W\d+$/.test(initialFilter)) activityResolution = 'weekly';
			else if (/^\d{4}$/.test(initialFilter)) activityResolution = 'yearly';
			else activityResolution = 'monthly';
		}

		if (config.type === 'activity') {
			if (activityResolution === 'monthly') {
				const monthsWithData = new Set<string>();
				records.forEach(r => {
					const d = extractDate(r.fields[config.field]);
					if (d) monthsWithData.add(MONTHS[d.getUTCMonth()]);
				});
				catList = MONTHS.filter(m => monthsWithData.has(m));
			} else if (activityResolution === 'weekly') {
				const weeks = new Set<string>();
				records.forEach(r => {
					const d = extractDate(r.fields[config.field]);
					if (d) weeks.add(`W${String(getISOWeek(d)).padStart(2, '0')}`);
				});
				catList = Array.from(weeks).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
			} else {
				const years = new Set<string>();
				records.forEach(r => {
					const d = extractDate(r.fields[config.field]);
					if (d) years.add(String(d.getUTCFullYear()));
				});
				catList = Array.from(years).sort();
			}
		} else if (config.type === 'heatmap') {
			// For heatmap, if an initial date (YYYY-MM-DD) was clicked, we keep it as the single active filter
			if (initialFilter) {
				catList = [initialFilter];
			}
		} else if (config.type === 'boolean') {
			const trueLabel = config.trueLabel || 'True (Yes)';
			const falseLabel = config.falseLabel || 'False (No)';
			catList = [trueLabel, falseLabel];
		} else {
			const categories = new Set<string>();
			records.forEach(r => {
				const val = r.fields[config.field];
				const vals = Array.isArray(val) ? val : [val];
				vals.forEach(v => {
					if (v === null || v === undefined) return;
					let label = String(v);
					const isTrue = v === true || label.toLowerCase() === 'true' || v === 1 || label.toLowerCase() === 'yes';
					const isFalse = v === false || label.toLowerCase() === 'false' || v === 0 || label.toLowerCase() === 'no';
					if (isTrue) label = config.trueLabel || 'True (Yes)';
					else if (isFalse) label = config.falseLabel || 'False (No)';
					categories.add(label);
				});
			});
			catList = Array.from(categories).sort();
		}

		let activeTab = initialFilter && (catList.includes(initialFilter) || config.type === 'heatmap') ? initialFilter : 'All';
		if (!initialFilter && catList.length > 0) activeTab = 'All';

		if (!col.drilldownConfig) {
			col.drilldownConfig = { layout: 'cards', cardSize: 200, fields: [], imageFit: 'cover', imageAspectRatio: 1.0 };
		}
		const dc = col.drilldownConfig;
		if (dc.cardSize < 50) dc.cardSize = 200;

		// ── Create Backdrop & Window Shell ───────────────────────
		const backdrop = activeDocument.body.createDiv('dash-glance-backdrop');
		this.backdropEl = backdrop;

		const glanceWindow = backdrop.createDiv('dash-glance-window');
		const isDark = activeDocument?.body?.classList.contains('theme-light') ? false : true;
		const colFg = getAdaptiveForeground(col.color || '#818cf8', isDark);
		const colRgb = hexToRgbString(colFg);
		const contrastText = getContrastTextColor(colFg);

		glanceWindow.style.setProperty('--collection-color', col.color || '#818cf8');
		glanceWindow.style.setProperty('--col-fg', colFg);
		glanceWindow.style.setProperty('--col-rgb', colRgb);
		glanceWindow.style.setProperty('--col-contrast', contrastText);

		// Close on clicking backdrop outside window
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) this.close();
		});

		// Close on Escape key
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') this.close();
		};
		activeDocument.addEventListener('keydown', this.keydownHandler);

		// ── Glance Top Bar ───────────────────────────────────────
		const headerContainer = glanceWindow.createDiv('dash-glance-header-container');
		const titleRow = headerContainer.createDiv('dash-glance-title-row');

		const titleLeft = titleRow.createDiv('dash-glance-title-left');
		const iconWrap = titleLeft.createDiv('dash-glance-title-icon');
		iconWrap.style.setProperty('color', col.color);
		setIcon(iconWrap, col.icon || 'layers');
		titleLeft.createDiv({ text: config.title, cls: 'dash-glance-title' });

		const titleRight = titleRow.createDiv('dash-glance-title-right');

		// Fullscreen / expand button
		const expandBtn = titleRight.createEl('button', { cls: 'dash-glance-action-btn', attr: { 'aria-label': 'Toggle Fullscreen' } });
		setIcon(expandBtn, 'maximize-2');
		let isMaximized = false;
		expandBtn.onclick = () => {
			isMaximized = !isMaximized;
			glanceWindow.toggleClass('dash-glance-maximized', isMaximized);
			setIcon(expandBtn, isMaximized ? 'minimize-2' : 'maximize-2');
		};

		// Config button
		const configBtn = titleRight.createEl('button', { cls: 'dash-glance-action-btn', attr: { 'aria-label': 'Configure view' } });
		setIcon(configBtn, 'settings-2');

		// Close button
		const closeBtn = titleRight.createEl('button', { cls: 'dash-glance-action-btn dash-glance-close-btn', attr: { 'aria-label': 'Close (Esc)' } });
		setIcon(closeBtn, 'x');
		closeBtn.onclick = () => this.close();

		// Category Tabs
		const tabsRow = headerContainer.createDiv('dash-glance-tabs');

		// Search & Sort Controls
		const controlsRow = headerContainer.createDiv('dash-glance-controls');
		const searchInput = controlsRow.createEl('input', {
			cls: 'dash-glance-search',
			placeholder: 'Search notes…',
			attr: { spellcheck: 'false', autocomplete: 'off' },
		});

		const sortWrap = controlsRow.createDiv('dash-glance-sort-wrap');
		sortWrap.createSpan({ text: 'Sort by: ', cls: 'dash-glance-sort-label' });

		const sortOptions = [
			{ value: 'title-asc', label: 'Title (A-Z)' },
			{ value: 'title-desc', label: 'Title (Z-A)' },
			...col.schema.filter(f => f.type === 'number').flatMap(f => [
				{ value: `${f.key}-desc`, label: `${f.key} (High-Low)` },
				{ value: `${f.key}-asc`, label: `${f.key} (Low-High)` }
			])
		];

		let searchQuery = '';
		let sortBy = 'title-asc';

		const sortDropWrap = sortWrap.createDiv('dash-custom-dropdown');
		const sortDropBtn = sortDropWrap.createDiv('dash-custom-dropdown-btn');
		const sortDropLabel = sortDropBtn.createSpan({ text: 'Title (A-Z)', cls: 'dash-custom-dropdown-label' });
		const sortDropArrow = sortDropBtn.createSpan({ cls: 'dash-custom-dropdown-arrow' });
		setIcon(sortDropArrow, 'chevron-down');
		const sortDropList = sortDropWrap.createDiv('dash-custom-dropdown-list hidden');

		sortOptions.forEach(opt => {
			const item = sortDropList.createDiv({
				cls: `dash-custom-dropdown-item${sortBy === opt.value ? ' active' : ''}`
			});
			item.setText(opt.label);
			item.onclick = (e) => {
				e.stopPropagation();
				sortBy = opt.value;
				sortDropLabel.setText(opt.label);
				sortDropList.querySelectorAll('.dash-custom-dropdown-item').forEach(i => i.removeClass('active'));
				item.addClass('active');
				sortDropList.addClass('hidden');
				sortDropBtn.removeClass('open');
				renderContent(true);
			};
		});

		sortDropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !sortDropList.hasClass('hidden');
			sortDropList.toggleClass('hidden', isOpen);
			sortDropBtn.toggleClass('open', !isOpen);
		};

		// ── Main Body & Config Panel ─────────────────────────────
		const mainArea = glanceWindow.createDiv('dash-glance-main');
		const configPanel = mainArea.createDiv('dash-glance-config-panel hidden');
		const contentArea = mainArea.createDiv('dash-glance-content');

		configBtn.onclick = () => {
			if (configPanel.hasClass('hidden')) {
				configPanel.removeClass('hidden');
				configBtn.addClass('active');
				DrilldownConfigPanel.build(configPanel, col, onSaveQuiet, () => renderContent(true), this.app);
			} else {
				configPanel.addClass('hidden');
				configBtn.removeClass('active');
			}
		};

		// ── Render Content Function ──────────────────────────────
		let savedScrollTop = 0;

		const renderContent = (preserveScroll = false) => {
			if (preserveScroll) {
				savedScrollTop = contentArea.scrollTop;
			}

			// Render Tabs
			tabsRow.empty();
			const tabsToRender = catList.length > 1 ? ['All', ...catList] : catList;
			tabsToRender.forEach(cat => {
				const tab = tabsRow.createDiv({ cls: `dash-glance-tab ${cat === activeTab ? 'active' : ''}` });
				tab.innerText = cat;
				tab.onclick = () => {
					activeTab = cat;
					renderContent(false);
				};
			});

			contentArea.empty();

			let baseRecords = records;
			if (config.type === 'activity' && activityResolution !== 'yearly' && drilldownYear !== 'all-time') {
				baseRecords = records.filter(r => {
					const d = extractDate(r.fields[config.field]);
					return d ? d.getUTCFullYear() === drilldownYear : false;
				});
			}

			// Filter by activeTab
			let filtered = activeTab === 'All'
				? baseRecords
				: baseRecords.filter(r => {
					const val = r.fields[config.field];

					if (config.type === 'heatmap') {
						const d = extractDate(val);
						if (!d) return false;
						const y = d.getUTCFullYear();
						const m = String(d.getUTCMonth() + 1).padStart(2, '0');
						const day = String(d.getUTCDate()).padStart(2, '0');
						return `${y}-${m}-${day}` === activeTab;
					}

					if (config.type === 'activity') {
						const d = extractDate(val);
						if (!d) return false;
						if (activityResolution === 'weekly') return `W${String(getISOWeek(d)).padStart(2, '0')}` === activeTab;
						else if (activityResolution === 'yearly') return String(d.getUTCFullYear()) === activeTab;
						else return MONTHS[d.getUTCMonth()] === activeTab;
					}

					if (config.type === 'boolean' || typeof val === 'boolean' || String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'false') {
						const isTrue = val === true || String(val).toLowerCase() === 'true' || val === 1 || String(val).toLowerCase() === 'yes';
						const trueLabel = config.trueLabel || 'True (Yes)';
						const falseLabel = config.falseLabel || 'False (No)';
						return activeTab === (isTrue ? trueLabel : falseLabel);
					}

					if (Array.isArray(val)) return val.some(v => String(v) === activeTab);
					return String(val) === activeTab;
				});

			// Filter by search query
			if (searchQuery) {
				filtered = filtered.filter(r => r.title.toLowerCase().includes(searchQuery));
			}

			// Sort
			filtered.sort((a, b) => {
				if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
				if (sortBy === 'title-desc') return b.title.localeCompare(a.title);

				const parts = sortBy.split('-');
				const direction = parts.pop();
				const key = parts.join('-');

				const valA = toNumber(a.fields[key], 0);
				const valB = toNumber(b.fields[key], 0);

				return direction === 'asc' ? valA - valB : valB - valA;
			});

			if (filtered.length === 0) {
				contentArea.createDiv({ text: 'No matching records found.', cls: 'dash-widget-empty' });
				return;
			}

			const fieldsToShow = dc.fields;

			const handleRecordUpdated = () => {
				CollectionReader.invalidateCache(col.id);
				let updated: RawRecord[] = [];
				if (onReloadRecords) {
					updated = onReloadRecords();
				} else {
					const reader = new CollectionReader(this.app);
					const mode = drilldownYear === 'all-time' ? 'library' : 'year';
					updated = reader.loadRecords(col, mode, drilldownYear);
					if (config.filterField && config.filterValue) {
						const targetVal = config.filterValue.toLowerCase();
						updated = updated.filter(r => {
							const val = r.fields[config.filterField!];
							if (Array.isArray(val)) return val.some(v => String(v).toLowerCase() === targetVal);
							return String(val ?? '').toLowerCase() === targetVal;
						});
					}
				}
				records.length = 0;
				records.push(...updated);
				renderContent(true);
			};

			const handleOpenNote = (filePath: string) => {
				this.close();
				void this.app.workspace.openLinkText(filePath, '', true);
			};

			if (dc.layout === 'cards') {
				this.cardRenderer.render(this.app, contentArea, filtered, col, dc, fieldsToShow, handleRecordUpdated, handleOpenNote, onSaveQuiet);
			} else {
				this.tableRenderer.render(this.app, contentArea, filtered, col, dc, fieldsToShow, handleRecordUpdated, handleOpenNote, onSaveQuiet);
			}

			if (preserveScroll) {
				window.requestAnimationFrame(() => {
					contentArea.scrollTop = savedScrollTop;
				});
			}
		};

		searchInput.oninput = () => {
			searchQuery = searchInput.value.toLowerCase();
			renderContent(true);
		};

		renderContent(false);
	}

	close(): void {
		if (this.keydownHandler) {
			activeDocument.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}
		this.cardRenderer.cleanup();
		this.tableRenderer.cleanup();
		if (this.backdropEl) {
			this.backdropEl.remove();
			this.backdropEl = null;
		}
	}
}
