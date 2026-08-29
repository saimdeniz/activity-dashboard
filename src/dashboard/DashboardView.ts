import { ItemView, WorkspaceLeaf, setIcon, Menu, Notice } from 'obsidian';
import { Chart as ChartJS, registerables, type Chart } from 'chart.js';
import type {
	CollectionConfig, DashboardSettings, OverviewItem,
	RawRecord, WidgetConfig, WidgetSize,
} from '../types';
import { migrateSize, sizeToClass } from '../types';
import { CollectionReader } from '../core/CollectionReader';
import { WidgetFactory } from './WidgetFactory';
import type LibraryDashPlugin from '../main';
import { AddWidgetModal } from '../modals/AddWidgetModal';
import {
	AddOverviewWidgetModal,
	BreakdownEditModal,
	TotalItemsEditModal,
	PinEditModal
} from '../modals/OverviewModals';
import { GlanceDrilldown } from './drilldown/GlanceDrilldown';
import { attachResizeHandles } from './grid/ResizeManager';
import { DragDropManager } from './grid/DragDropManager';
import { hexToRgbString, getAdaptiveForeground, getContrastTextColor, generatePalette } from '../utils/ColorUtils';

ChartJS.register(...registerables);
ChartJS.defaults.plugins.tooltip.cornerRadius = 8;
ChartJS.defaults.plugins.tooltip.padding = 10;

export const VIEW_TYPE_DASHBOARD = 'dynamic-dashboard-view';

export class DashboardView extends ItemView {
	private year: number | 'all-time' = new Date().getFullYear();
	private activeMode: 'year' | 'library' = 'library';
	private activeTab = 'overview'; // collectionId or 'overview'
	private charts: Chart[] = [];
	private chartFactoryQueue: (() => void)[] = [];
	private static copiedWidgets: WidgetConfig[] | null = null;

	private glanceDrilldown: GlanceDrilldown;
	private dragDropManager: DragDropManager;

	private onDragOverHandler = (e: DragEvent) => {
		this.dragDropManager.setDragY(e.clientY);
		this.dragDropManager.startAutoScroll();
	};
	private onDragEndHandler = () => this.dragDropManager.stopAutoScroll();
	private onDropHandler = () => this.dragDropManager.stopAutoScroll();

	constructor(leaf: WorkspaceLeaf, private plugin: LibraryDashPlugin) {
		super(leaf);
		this.glanceDrilldown = new GlanceDrilldown(this.app);
		this.dragDropManager = new DragDropManager(this.contentEl);
	}

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return 'Dashboard'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		this.activeMode = this.settings.activeMode || 'library';
		this.year = this.settings.activeYear || new Date().getFullYear();

		this.contentEl.addEventListener('dragover', this.onDragOverHandler);
		this.contentEl.addEventListener('dragend', this.onDragEndHandler);
		this.contentEl.addEventListener('drop', this.onDropHandler);
		
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.removeEventListener('dragover', this.onDragOverHandler);
		this.contentEl.removeEventListener('dragend', this.onDragEndHandler);
		this.contentEl.removeEventListener('drop', this.onDropHandler);
		this.dragDropManager.stopAutoScroll();
		this.destroyCharts();
		this.glanceDrilldown.close();
	}

	/** Add Copy/Paste Layout to the View's "More Options" (...) menu */
	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);

		const col = this.settings.collections.find(c => c.id === this.activeTab);
		if (!col) return;

		menu.addItem(item => {
			item.setTitle('Copy Dashboard Layout');
			item.setIcon('copy');
			item.onClick(() => {
				const widgets = this.getActiveWidgets(col);
				if (!widgets.length) {
					new Notice('No widgets to copy!');
					return;
				}
				DashboardView.copiedWidgets = JSON.parse(JSON.stringify(widgets)) as WidgetConfig[];
				new Notice(`Copied ${widgets.length} widgets from ${col.name} (${this.activeMode}).`);
			});
		});

		menu.addItem(item => {
			item.setTitle('Paste Dashboard Layout');
			item.setIcon('clipboard-paste');
			if (!DashboardView.copiedWidgets) item.setDisabled(true);
			item.onClick(async () => {
				if (!DashboardView.copiedWidgets) return;
				
				const newWidgets: WidgetConfig[] = DashboardView.copiedWidgets.map(w => ({
					...w,
					id: uid()
				}));

				this.setActiveWidgets(col, newWidgets);
				await this.save();
				new Notice(`Pasted ${newWidgets.length} widgets into ${col.name} (${this.activeMode}).`);
				void this.render();
			});
		});
	}

	refresh(): void { void this.render(); }

	// ── Core State & Save Helpers ─────────────────────────────
	private destroyCharts(): void {
		this.charts.forEach(c => c.destroy());
		this.charts = [];
	}

	private cssVar(name: string): string {
		try {
			const body = (typeof activeDocument !== 'undefined' && activeDocument.body) ? activeDocument.body : document.body;
			return getComputedStyle(body).getPropertyValue(name).trim();
		} catch (_) {
			return '';
		}
	}

	private get isDark(): boolean {
		try {
			if (typeof activeDocument !== 'undefined' && activeDocument?.body?.classList) {
				return !activeDocument.body.classList.contains('theme-light');
			}
			if (typeof document !== 'undefined' && document?.body?.classList) {
				return !document.body.classList.contains('theme-light');
			}
		} catch (_) {}
		return true;
	}

	private get settings(): DashboardSettings {
		return this.plugin.settings;
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	private async saveQuiet(): Promise<void> {
		await this.plugin.saveSettingsQuiet();
	}

	private getActiveWidgets(col: CollectionConfig): WidgetConfig[] {
		return this.activeMode === 'library' ? (col.libraryWidgets || []) : (col.yearWidgets || []);
	}

	private setActiveWidgets(col: CollectionConfig, widgets: WidgetConfig[]): void {
		if (this.activeMode === 'library') {
			col.libraryWidgets = widgets;
		} else {
			col.yearWidgets = widgets;
		}
	}

	// ── Main Render Orchestration ─────────────────────────────
	private async render(): Promise<void> {
		try {
			this.destroyCharts();
			this.chartFactoryQueue = [];

			const { contentEl } = this;
			contentEl.empty();
			contentEl.addClass('dash-view');

			const isDarkTheme = this.isDark;
			const activeColor = this.activeTab === 'overview' 
				? (this.settings.overviewColor || '#818cf8') 
				: (this.settings.collections?.find(c => c.id === this.activeTab)?.color || '#818cf8');
			const activeFg = getAdaptiveForeground(activeColor, isDarkTheme);
			const activeRgb = hexToRgbString(activeFg);
			const activeContrast = getContrastTextColor(activeFg);

			contentEl.style.setProperty('--col-color', activeColor);
			contentEl.style.setProperty('--col-fg', activeFg);
			contentEl.style.setProperty('--col-rgb', activeRgb);
			contentEl.style.setProperty('--col-contrast', activeContrast);

			this.renderTopBar(contentEl);
			this.renderPageHeader(contentEl);
			this.renderTabs(contentEl);

			const contentOuter = contentEl.createDiv('dash-content-outer');
			const content = contentOuter.createDiv('dash-content');

			if (this.activeTab === 'overview') {
				this.renderOverview(content);
			} else {
				const col = this.settings.collections?.find(c => c.id === this.activeTab);
				if (col) {
					this.renderCollection(content, col);
				} else {
					this.activeTab = 'overview';
					this.renderOverview(content);
				}
			}

			this.flushChartQueue();
		} catch (err) {
			console.error('[ActivityDashboard] Error rendering dashboard:', err);
			this.contentEl.empty();
			const errDiv = this.contentEl.createDiv('dash-widget-empty');
			errDiv.createDiv({ text: 'Error rendering dashboard. Please refresh or check console.' });
		}
	}

	private flushChartQueue(): void {
		window.requestAnimationFrame(() => {
			this.chartFactoryQueue.forEach(fn => {
				try { fn(); } catch (e) { console.error('[ActivityDashboard] Widget render error:', e); }
			});
			this.chartFactoryQueue = [];
			WidgetFactory.applyIcons(this.contentEl);
		});
	}

	// ── Header & Navigation ───────────────────────────────────
	private renderTopBar(el: HTMLElement): void {
		const isDarkTheme = this.isDark;
		const activeColor = this.activeTab === 'overview' 
			? (this.settings.overviewColor || '#818cf8') 
			: (this.settings.collections?.find(c => c.id === this.activeTab)?.color || '#818cf8');
		const activeFg = getAdaptiveForeground(activeColor, isDarkTheme);
		const activeRgb = hexToRgbString(activeFg);

		const bar = el.createDiv('dash-topbar');
		bar.style.setProperty('--active-theme-color', activeFg);
		bar.style.setProperty('--active-theme-rgb', activeRgb);

		const switchWrap = bar.createDiv('dash-mode-switch');
		(['library', 'year'] as const).forEach(mode => {
			const label = mode === 'year' ? 'Year in Review' : 'Library Stats';
			const btn = switchWrap.createEl('button', {
				text: label,
				cls: `dash-mode-btn ${this.activeMode === mode ? 'active' : ''}`,
			});
			btn.onclick = async () => { 
				this.activeMode = mode; 
				this.settings.activeMode = mode;
				await this.saveQuiet();
				void this.render(); 
			};
		});

		const right = bar.createDiv('dash-topbar-right');

		if (this.activeMode === 'year') {
			const allTimeBtn = right.createEl('button', {
				cls: `dash-nav-btn ${this.year === 'all-time' ? 'active' : ''}`,
				attr: { 'aria-label': 'All Time' },
			});
			setIcon(allTimeBtn, 'infinity');
			allTimeBtn.onclick = async () => {
				this.year = this.year === 'all-time' ? new Date().getUTCFullYear() : 'all-time';
				this.settings.activeYear = this.year;
				await this.saveQuiet();
				void this.render();
			};

			if (this.year !== 'all-time') {
				const prev = right.createEl('button', { cls: 'dash-nav-btn', attr: { 'aria-label': 'Previous year' } });
				setIcon(prev, 'chevron-left');
				prev.onclick = async () => { 
					(this.year as number)--; 
					this.settings.activeYear = this.year;
					await this.saveQuiet();
					void this.render(); 
				};
			}

			right.createSpan({
				text: this.year === 'all-time' ? 'All Time' : String(this.year),
				cls: 'dash-year-label',
			});

			if (this.year !== 'all-time') {
				const next = right.createEl('button', { cls: 'dash-nav-btn', attr: { 'aria-label': 'Next year' } });
				setIcon(next, 'chevron-right');
				next.onclick = async () => { 
					(this.year as number)++; 
					this.settings.activeYear = this.year;
					await this.saveQuiet();
					void this.render(); 
				};
			}
		}

		const refreshBtn = right.createEl('button', { cls: 'dash-refresh-btn', attr: { 'aria-label': 'Refresh' } });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.onclick = () => void this.render();
	}

	private renderPageHeader(el: HTMLElement): void {
		const isDarkTheme = this.isDark;
		let title = 'Overview';
		let iconName = 'home';
		let count = 0;
		let color = this.settings.overviewColor || '#818cf8';

		const reader = new CollectionReader(this.app);
		if (this.activeTab === 'overview') {
			let totalRecs = 0;
			for (const c of this.settings.collections) {
				totalRecs += reader.loadRecords(c, this.activeMode, this.year).length;
			}
			count = totalRecs;
			color = this.settings.overviewColor || '#818cf8';
		} else {
			const col = this.settings.collections.find(c => c.id === this.activeTab);
			if (col) {
				title = col.name;
				iconName = col.icon;
				color = col.color;
				count = reader.loadRecords(col, this.activeMode, this.year).length;
			}
		}

		const headerFg = getAdaptiveForeground(color, isDarkTheme);
		const headerRgb = hexToRgbString(headerFg);

		const header = el.createDiv('dash-page-header');
		header.style.setProperty('--active-theme-color', headerFg);
		header.style.setProperty('--active-theme-rgb', headerRgb);

		const left = header.createDiv('dash-page-header-left');

		const iconWrap = left.createDiv('dash-page-header-icon');
		setIcon(iconWrap, iconName);

		const textWrap = left.createDiv('dash-page-header-text');
		textWrap.createDiv({ text: title, cls: 'dash-page-title' });
		textWrap.createDiv({
			text: `${count} ${count === 1 ? 'item' : 'items'}`,
			cls: 'dash-page-subtitle',
		});
	}

	private renderTabs(el: HTMLElement): void {
		const bar = el.createDiv('dash-tabs');
		const overviewCol = this.settings.overviewColor || '#818cf8';
		this.buildTab(bar, 'overview', 'home', 'Overview', this.activeTab === 'overview', overviewCol);

		const reader = new CollectionReader(this.app);
		for (const col of this.settings.collections) {
			const count = reader.loadRecords(col, this.activeMode, this.year).length;
			this.buildTab(bar, col.id, col.icon, `${col.name} (${count})`, this.activeTab === col.id, col.color);
		}
	}

	private buildTab(
		bar: HTMLElement,
		id: string,
		icon: string,
		label: string,
		active: boolean,
		color?: string,
	): void {
		const isDarkTheme = this.isDark;
		const tabColor = color || '#818cf8';
		const tabFg = getAdaptiveForeground(tabColor, isDarkTheme);
		const rgb = hexToRgbString(tabFg);
		const tabTextCol = getContrastTextColor(tabColor);

		const btn = bar.createEl('button', { cls: `dash-tab ${active ? 'active' : ''}` });
		btn.style.setProperty('--tab-color', tabFg);
		btn.style.setProperty('--tab-rgb', rgb);
		btn.style.setProperty('--tab-text-color', tabTextCol);
		if (active) {
			btn.style.setProperty('--tab-active-bg', tabColor);
		}

		const iconEl = btn.createSpan('dash-tab-icon');
		setIcon(iconEl, icon);
		btn.createSpan({ text: label, cls: 'dash-tab-text' });

		btn.onclick = () => {
			this.activeTab = id;
			void this.render();
		};
	}

	// ── Overview Tab ──────────────────────────────────────────
	private renderOverview(el: HTMLElement): void {
		const cols = this.settings.collections;

		if (!this.settings.overviewLayout) {
			this.settings.overviewLayout = [
				{ type: 'total-items', id: 'total-items' },
				{ type: 'breakdown', id: 'media-breakdown' },
				...(this.settings.overviewPins ?? []).map(p => ({
					type: 'pin' as const,
					id: p.widgetId,
					collectionId: p.collectionId,
				}))
			];
		}

		const toolbar = el.createDiv('dash-collection-toolbar');
		const overviewColor = this.settings.overviewColor || '#818cf8';
		const isDarkTheme = this.isDark;
		const colFg = getAdaptiveForeground(overviewColor, isDarkTheme);
		const colRgb = hexToRgbString(colFg);
		const colContrast = getContrastTextColor(colFg);
		toolbar.style.setProperty('--collection-color', overviewColor);
		toolbar.style.setProperty('--col-fg', colFg);
		toolbar.style.setProperty('--col-rgb', colRgb);
		toolbar.style.setProperty('--col-contrast', colContrast);

		const colLabel = toolbar.createDiv('dash-collection-label');
		const colIcon = colLabel.createDiv('dash-col-icon');
		colIcon.style.setProperty('background-color', colFg);
		colIcon.style.setProperty('color', colContrast);
		setIcon(colIcon, 'home');
		colLabel.createDiv({ text: 'Overview', cls: 'dash-col-name' });

		const addBtn = toolbar.createEl('button', { cls: 'dash-add-widget-btn mod-cta' });
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: 'Add Widget' });
		addBtn.onclick = () => {
			new AddOverviewWidgetModal(this.app, this.settings.overviewLayout!, async (type) => {
				const id = 'glob-' + Math.random().toString(36).substring(2, 11);
				const defaultCfg: Partial<OverviewItem> = {
					size: type === 'breakdown' ? { height: 'small', span: 6 } : { height: 'small', span: 3 },
					chartType: type === 'breakdown' ? 'doughnut' : undefined,
					icon: type === 'total-items' ? 'library' : undefined,
				};
				this.settings.overviewLayout!.unshift({ type, id, ...defaultCfg });
				await this.save();
				void this.render();
			}).open();
		};

		// Cleanup orphaned pins
		const before = this.settings.overviewLayout.length;
		this.settings.overviewLayout = this.settings.overviewLayout.filter(item => {
			if (item.type === 'breakdown' || item.type === 'total-items') return true;
			const col = cols.find(c => c.id === item.collectionId);
			if (!col) return false;
			return (col.libraryWidgets || []).some(w => w.id === item.id) 
				|| (col.yearWidgets || []).some(w => w.id === item.id);
		});

		if (this.settings.overviewLayout.length !== before) {
			void this.saveQuiet();
		}

		const layoutItems = this.settings.overviewLayout;
		if (layoutItems.length === 0 && !cols.length) {
			const empty = el.createDiv('dash-widget-empty');
			empty.createDiv({ text: 'Your overview is empty. Create collections and pin widgets to get started.' });
			return;
		}

		const grid = el.createDiv('dash-grid');

		for (const item of layoutItems) {
			if (item.type === 'total-items') {
				if (cols.length > 0) this.renderTotalItems(grid, item);
			} else if (item.type === 'breakdown') {
				if (cols.length > 0) this.renderMediaBreakdown(grid, item);
			} else if (item.type === 'pin') {
				const col = cols.find(c => c.id === item.collectionId);
				if (!col) continue;
				const widgetCfg = (col.libraryWidgets || []).find(w => w.id === item.id) 
								|| (col.yearWidgets || []).find(w => w.id === item.id);
				if (!widgetCfg) continue;

				const reader = new CollectionReader(this.app);
				const records = reader.loadRecords(col, this.activeMode, this.year);
				this.buildWidgetCard(grid, col, widgetCfg, records, true, true, undefined, item);
			}
		}
	}

	private renderTotalItems(grid: HTMLElement, item: OverviewItem): void {
		const cols = this.settings.collections;
		const reader = new CollectionReader(this.app);
		
		let total = 0;
		for (const col of cols) {
			const records = reader.loadRecords(col, this.activeMode, this.year);
			total += records.length;
		}

		const legacy = this.settings.overviewTotalItems ?? { size: { height: 'small', span: 3 }, icon: 'library' };
		const resolvedSize = migrateSize(item.size ?? legacy.size);
		const icon = item.icon ?? legacy.icon ?? 'library';

		const isDarkTheme = this.isDark;
		const accentColor = this.settings.overviewColor || 'var(--interactive-accent)';
		const colFg = getAdaptiveForeground(accentColor, isDarkTheme);
		const colRgb = hexToRgbString(colFg);

		const card = activeDocument.createElement('div');
		card.className = `dash-widget ${sizeToClass(resolvedSize)} dash-widget-pinref`;
		card.style.setProperty('--collection-color', accentColor);
		card.style.setProperty('--col-fg', colFg);
		card.style.setProperty('--col-rgb', colRgb);
		card.dataset.widgetId = item.id;
		grid.appendChild(card);

		attachResizeHandles(card, grid, resolvedSize, async (newSize) => {
			item.size = newSize;
			await this.saveQuiet();
		}, () => this.charts.forEach(c => c.resize()));

		const header = card.createDiv('dash-widget-header');
		const handle = header.createDiv('dash-widget-drag-handle');
		for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
		handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
		handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));
		
		this.dragDropManager.attachOverviewDragEvents(card, item.id, this.settings, () => this.saveQuiet());

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.setProperty('background-color', colFg);
		titleEl.createDiv({ text: 'TOTAL ITEMS', cls: 'dash-widget-title' });

		const actions = header.createDiv('dash-widget-actions');
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => this.moveWidgetInLayout(cols[0], item.id, -1, true);

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => this.moveWidgetInLayout(cols[0], item.id, 1, true);

		const editBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'aria-label': 'Edit' } });
		setIcon(editBtn, 'settings-2');
		editBtn.onclick = () => {
			new TotalItemsEditModal(this.app, { size: resolvedSize, icon }, async (updated) => {
				item.size = updated.size;
				item.icon = updated.icon;
				await this.saveQuiet();
				void this.render();
			}).open();
		};

		const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'aria-label': 'Remove' } });
		setIcon(removeBtn, 'x');
		removeBtn.onclick = async () => {
			this.settings.overviewLayout = this.settings.overviewLayout!.filter(i => i.id !== item.id);
			await this.saveQuiet();
			card.remove();
		};

		const body = card.createDiv('dash-widget-body');
		const numCard = body.createDiv('dash-number-card dash-clickable');
		numCard.style.cursor = 'pointer';
		numCard.setAttribute('title', 'Click to open Glance View for all items');
		const iconWrap = numCard.createDiv('dash-number-icon');
		setIcon(iconWrap, icon);
		numCard.createDiv({ text: String(total), cls: 'dash-number-value' });
		numCard.createDiv({ text: 'TOTAL ITEMS', cls: 'dash-number-label' });

		numCard.onclick = () => {
			const allRecords: RawRecord[] = [];
			for (const col of cols) {
				allRecords.push(...reader.loadRecords(col, this.activeMode, this.year));
			}
			const overviewCol: CollectionConfig = {
				id: 'overview',
				name: 'All Collections',
				icon: icon,
				color: accentColor,
				scanMode: 'folder',
				schema: [],
				libraryWidgets: [],
				yearWidgets: [],
				drilldownConfig: { layout: 'cards', cardSize: 200, fields: [], imageFit: 'cover', imageAspectRatio: 1.0 }
			};
			this.glanceDrilldown.show({
				parentEl: this.contentEl,
				col: overviewCol,
				config: {
					id: 'total-items-drilldown',
					type: 'number-card',
					title: 'Total Items',
					field: '',
					size: resolvedSize,
				},
				initialFilter: null,
				records: allRecords,
				globalYear: this.activeMode === 'year' ? this.year : 'all-time',
				onSaveQuiet: () => this.saveQuiet(),
				onReloadRecords: () => {
					const rdr = new CollectionReader(this.app);
					const yr = this.activeMode === 'year' ? this.year : 'all-time';
					return this.settings.collections.flatMap(c => rdr.loadRecords(c, this.activeMode, yr));
				}
			});
		};
	}

	private renderMediaBreakdown(grid: HTMLElement, item: OverviewItem): void {
		const cols = this.settings.collections;
		const reader = new CollectionReader(this.app);

		const labels: string[] = [];
		const data: number[] = [];
		const rawColColors: string[] = [];
		let totalItems = 0;

		for (const col of cols) {
			const records = reader.loadRecords(col, this.activeMode, this.year);
			if (records.length > 0) {
				labels.push(col.name);
				data.push(records.length);
				rawColColors.push(col.color);
				totalItems += records.length;
			}
		}

		const bgColors = (this.settings.colorPaletteTheme && this.settings.colorPaletteTheme !== 'classic')
			? generatePalette(this.settings.overviewColor || '#818cf8', labels.length, this.settings.colorPaletteTheme)
			: rawColColors;

		const legacy = this.settings.overviewMediaBreakdown ?? { size: { height: 'small', span: 6 }, chartType: 'doughnut' };
		const resolvedBreakdownSize = migrateSize(item.size ?? legacy.size);
		const chartType = item.chartType ?? legacy.chartType ?? 'doughnut';
		const isDarkTheme = this.isDark;
		const accentColor = this.settings.overviewColor || 'var(--interactive-accent)';
		const colFg = getAdaptiveForeground(accentColor, isDarkTheme);
		const colRgb = hexToRgbString(colFg);

		const card = activeDocument.createElement('div');
		card.className = `dash-widget ${sizeToClass(resolvedBreakdownSize)} dash-widget-pinref`;
		card.style.setProperty('--collection-color', accentColor);
		card.style.setProperty('--col-fg', colFg);
		card.style.setProperty('--col-rgb', colRgb);
		card.dataset.widgetId = item.id;
		grid.appendChild(card);

		attachResizeHandles(card, grid, resolvedBreakdownSize, async (newSize) => {
			item.size = newSize;
			await this.saveQuiet();
		}, () => this.charts.forEach(c => c.resize()));

		const header = card.createDiv('dash-widget-header');
		const handle = header.createDiv('dash-widget-drag-handle');
		for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
		handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
		handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));
		
		this.dragDropManager.attachOverviewDragEvents(card, item.id, this.settings, () => this.saveQuiet());

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.setProperty('background-color', colFg);
		titleEl.createDiv({ text: 'MEDIA BREAKDOWN', cls: 'dash-widget-title' });

		const actions = header.createDiv('dash-widget-actions');
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => this.moveWidgetInLayout(cols[0], item.id, -1, true);

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => this.moveWidgetInLayout(cols[0], item.id, 1, true);

		const editBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'aria-label': 'Edit' } });
		setIcon(editBtn, 'settings-2');
		editBtn.onclick = () => {
			new BreakdownEditModal(this.app, { size: resolvedBreakdownSize, chartType }, async (updated) => {
				item.size = updated.size;
				item.chartType = updated.chartType;
				await this.saveQuiet();
				void this.render();
			}).open();
		};

		const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'aria-label': 'Remove' } });
		setIcon(removeBtn, 'x');
		removeBtn.onclick = async () => {
			this.settings.overviewLayout = this.settings.overviewLayout!.filter(i => i.id !== item.id);
			await this.saveQuiet();
			card.remove();
		};

		const body = card.createDiv('dash-widget-body');
		const heightVal = resolvedBreakdownSize.height === 'mini' ? '120px' : '240px';
		body.style.setProperty('height', heightVal);
		body.style.setProperty('min-height', heightVal);
		body.style.setProperty('max-height', heightVal);

		if (totalItems === 0) {
			body.createDiv({ text: `No data recorded for ${this.year === 'all-time' ? 'all time' : this.year}`, cls: 'dash-widget-empty' });
			return;
		}

		const canvas = body.createEl('canvas', { cls: 'dash-canvas-full' });
		canvas.style.cursor = 'pointer';
		this.chartFactoryQueue.push(() => {
			const ctMap: Record<string, string> = {
				'doughnut': 'doughnut', 'pie': 'pie',
				'bar-vertical': 'bar', 'bar-horizontal': 'bar',
			};
			const jsType = (ctMap[chartType] ?? 'doughnut') as 'doughnut' | 'pie' | 'bar';
			const isHorizontal = chartType === 'bar-horizontal';
			const isBar = chartType === 'bar-vertical' || isHorizontal;
			const isPie = chartType === 'doughnut' || chartType === 'pie';

			const existingChart = ChartJS.getChart(canvas);
			if (existingChart) existingChart.destroy();

			const bodyRect = body.getBoundingClientRect();
			canvas.width = bodyRect.width > 0 ? bodyRect.width : 300;
			canvas.height = bodyRect.height > 0 ? bodyRect.height : 240;

			const chart = new ChartJS(canvas, {
				type: jsType,
				data: {
					labels,
					datasets: [{
						data,
						backgroundColor: bgColors,
						borderWidth: 0,
						hoverOffset: isPie ? 4 : 0,
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					...(isPie ? { cutout: chartType === 'doughnut' ? '55%' : '0%' } : {}),
					indexAxis: isHorizontal ? 'y' : 'x',
					plugins: {
						legend: {
							display: !isBar,
							position: 'bottom',
							labels: { color: this.cssVar('--text-muted'), boxWidth: 8, usePointStyle: true },
						},
						tooltip: {
							callbacks: {
								label: (ctx: { raw: unknown }) => {
									const val = ctx.raw as number;
									const pct = Math.round((val / totalItems) * 100);
									return ` ${val.toLocaleString()} (${pct}%)`;
								}
							}
						}
					},
					scales: isBar ? {
						x: { ticks: { color: this.cssVar('--text-muted') }, grid: { color: this.cssVar('--background-modifier-border') } },
						y: { ticks: { color: this.cssVar('--text-muted') }, grid: { color: this.cssVar('--background-modifier-border') } },
					} : {},
				} as unknown as import('chart.js').ChartConfiguration['options']
			});

			canvas.onclick = (e) => {
				const elements = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
				if (elements.length > 0) {
					const idx = elements[0].index;
					const clickedColName = labels[idx];
					const clickedCol = cols.find(c => c.name === clickedColName);
					if (clickedCol) {
						const colRecords = reader.loadRecords(clickedCol, this.activeMode, this.year);
						this.glanceDrilldown.show({
							parentEl: this.contentEl,
							col: clickedCol,
							config: {
								id: 'overview-breakdown',
								type: 'distribution',
								title: clickedCol.name,
								field: clickedCol.scanMode === 'folder' ? 'folder' : (clickedCol.typeField || 'type'),
								size: { height: 'small', span: 6 },
							},
							initialFilter: null,
							records: colRecords,
							globalYear: this.activeMode === 'year' ? this.year : 'all-time',
							onSaveQuiet: () => this.saveQuiet(),
							onReloadRecords: () => {
								const rdr = new CollectionReader(this.app);
								const yr = this.activeMode === 'year' ? this.year : 'all-time';
								return rdr.loadRecords(clickedCol, this.activeMode, yr);
							}
						});
					}
				}
			};

			this.charts.push(chart as unknown as Chart);
		});
	}

	// ── Collection Tab ────────────────────────────────────────
	private renderCollection(el: HTMLElement, col: CollectionConfig): void {
		const isDarkTheme = this.isDark;
		const colFg = getAdaptiveForeground(col.color, isDarkTheme);
		const colRgb = hexToRgbString(colFg);
		const colContrast = getContrastTextColor(colFg);

		const toolbar = el.createDiv('dash-collection-toolbar');
		toolbar.style.setProperty('--collection-color', col.color);
		toolbar.style.setProperty('--col-fg', colFg);
		toolbar.style.setProperty('--col-rgb', colRgb);
		toolbar.style.setProperty('--col-contrast', colContrast);

		const colLabel = toolbar.createDiv('dash-collection-label');
		const colIcon = colLabel.createDiv('dash-col-icon');
		colIcon.style.setProperty('background-color', colFg);
		colIcon.style.setProperty('color', colContrast);
		setIcon(colIcon, col.icon);
		colLabel.createDiv({ text: col.name, cls: 'dash-col-name' });

		const addBtn = toolbar.createEl('button', { cls: 'dash-add-widget-btn mod-cta' });
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: 'Add Widget' });
		addBtn.onclick = () => {
			if (!col.schema.length) {
				new Notice('Please scan the schema first in Settings.');
				return;
			}
			new AddWidgetModal(this.app, col, async (cfg) => {
				const activeWidgets = this.getActiveWidgets(col);
				activeWidgets.push(cfg);
				this.setActiveWidgets(col, activeWidgets);
				await this.save();
				void this.render();
			}).open();
		};

		const reader = new CollectionReader(this.app);
		const records = reader.loadRecords(col, this.activeMode, this.year);
		const activeWidgets = this.getActiveWidgets(col);
		
		if (!activeWidgets.length) {
			const empty = el.createDiv('dash-widget-empty');
			empty.createDiv({ text: 'No widgets configured yet. Click "Add Widget" to build your dashboard.' });
			return;
		}

		const grid = el.createDiv('dash-grid');
		activeWidgets.forEach(wcfg => {
			this.buildWidgetCard(grid, col, wcfg, records, false, true);
		});
	}

	// ── Widget Card Builder ───────────────────────────────────
	private buildWidgetCard(
		grid: HTMLElement,
		col: CollectionConfig,
		config: WidgetConfig,
		records: RawRecord[],
		isPinRef = false,
		isDraggable = false,
		insertBeforeEl?: HTMLElement,
		overviewItemOverride?: OverviewItem
	): void {
		if (overviewItemOverride) {
			config = { 
				...config, 
				size: migrateSize(overviewItemOverride.size ?? config.size),
			};
		}

		const isDarkTheme = this.isDark;
		const resolvedSize = migrateSize(config.size);
		const card = activeDocument.createElement('div');
		card.className = `dash-widget ${sizeToClass(resolvedSize)} ${isPinRef ? 'dash-widget-pinref' : ''}`;
		if (insertBeforeEl) {
			grid.insertBefore(card, insertBeforeEl);
			insertBeforeEl.remove();
		} else {
			grid.appendChild(card);
		}
		card.dataset.widgetId = config.id;
		const accentColor = isPinRef ? (this.settings.overviewColor || col.color) : col.color;
		const colFg = getAdaptiveForeground(accentColor, isDarkTheme);
		const colRgb = hexToRgbString(colFg);
		card.style.setProperty('--collection-color', accentColor);
		card.style.setProperty('--col-fg', colFg);
		card.style.setProperty('--col-rgb', colRgb);

		attachResizeHandles(card, grid, resolvedSize, async (newSize) => {
			config.size = newSize;
			if (overviewItemOverride) {
				overviewItemOverride.size = newSize;
				await this.saveQuiet();
			} else if (!isPinRef) {
				const wList = this.getActiveWidgets(col);
				const idx = wList.findIndex(w => w.id === config.id);
				if (idx > -1) { 
					wList[idx].size = newSize; 
					this.setActiveWidgets(col, wList); 
				}
				await this.saveQuiet();
			}
		}, () => this.charts.forEach(c => c.resize()));

		const header = card.createDiv('dash-widget-header');

		if (isDraggable) {
			const handle = header.createDiv('dash-widget-drag-handle');
			for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
			handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
			handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));

			if (isPinRef) {
				const overviewId = overviewItemOverride?.id ?? config.id;
				this.dragDropManager.attachOverviewDragEvents(card, overviewId, this.settings, () => this.saveQuiet());
			} else {
				this.dragDropManager.attachCollectionDragEvents(card, config.id, col, this.activeMode, () => this.saveQuiet());
			}
		}

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.setProperty('background-color', accentColor);
		titleEl.createDiv({ text: config.title, cls: 'dash-widget-title' });

		const actions = header.createDiv('dash-widget-actions');
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => {
			const id = isPinRef ? (overviewItemOverride?.id ?? config.id) : config.id;
			await this.moveWidgetInLayout(col, id, -1, isPinRef);
		};

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => {
			const id = isPinRef ? (overviewItemOverride?.id ?? config.id) : config.id;
			await this.moveWidgetInLayout(col, id, 1, isPinRef);
		};

		if (!isPinRef) {
			const pinIcon = (config.pinnedToOverview ?? false) ? 'pin-off' : 'pin';
			const pinBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'aria-label': 'Pin to Overview' } });
			pinBtn.onclick = async () => {
				const pinned = !(config.pinnedToOverview ?? false);
				config.pinnedToOverview = pinned;

				if (pinned) {
					if (!this.settings.overviewPins.find(p => p.widgetId === config.id)) {
						this.settings.overviewPins.push({ collectionId: col.id, widgetId: config.id });
					}
					if (!this.settings.overviewLayout) this.settings.overviewLayout = [{ type: 'breakdown', id: 'media-breakdown' }];
					if (!this.settings.overviewLayout.find(i => i.id === config.id)) {
						this.settings.overviewLayout.push({ type: 'pin', id: config.id, collectionId: col.id });
					}
				} else {
					this.settings.overviewPins = this.settings.overviewPins.filter(p => p.widgetId !== config.id);
					if (this.settings.overviewLayout) {
						this.settings.overviewLayout = this.settings.overviewLayout.filter(i => i.id !== config.id);
					}
				}
				await this.saveQuiet();
				setIcon(pinBtn, pinned ? 'pin-off' : 'pin');
			};
			setIcon(pinBtn, pinIcon);
		}

		if (isPinRef) {
			if (overviewItemOverride) {
				const pinEditBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'aria-label': 'Edit Pin Settings' } });
				setIcon(pinEditBtn, 'settings-2');
				pinEditBtn.onclick = () => {
					new PinEditModal(this.app, { size: config.size }, async (updated) => {
						overviewItemOverride.size = updated.size;
						await this.saveQuiet();
						void this.render();
					}).open();
				};
			}

			const unpinBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'aria-label': 'Remove from Overview' } });
			setIcon(unpinBtn, 'pin-off');
			unpinBtn.onclick = async () => {
				if (this.settings.overviewLayout) {
					this.settings.overviewLayout = this.settings.overviewLayout.filter(i => i.id !== config.id);
				}
				this.settings.overviewPins = this.settings.overviewPins.filter(p => p.widgetId !== config.id);
				config.pinnedToOverview = false;
				await this.saveQuiet();
				card.remove();
			};
		}

		if (!isPinRef) {
			const editBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'aria-label': 'Edit' } });
			setIcon(editBtn, 'settings-2');
			editBtn.onclick = () => {
				new AddWidgetModal(this.app, col, async (cfg) => {
					const activeWidgets = this.getActiveWidgets(col);
					const idx = activeWidgets.findIndex(w => w.id === cfg.id);
					if (idx > -1) activeWidgets[idx] = cfg;
					this.setActiveWidgets(col, activeWidgets);
					await this.saveQuiet();
					
					const reader = new CollectionReader(this.app);
					const recs = reader.loadRecords(col, this.activeMode, this.year);
					const parentGrid = card.parentElement!;
					const placeholder = activeDocument.createElement('div');
					parentGrid.insertBefore(placeholder, card);
					card.remove();
					this.buildWidgetCard(parentGrid, col, cfg, recs, false, true, placeholder);
					this.flushChartQueue();
				}, config).open();
			};

			const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'aria-label': 'Remove' } });
			setIcon(removeBtn, 'x');
			removeBtn.onclick = async () => {
				let activeWidgets = this.getActiveWidgets(col);
				activeWidgets = activeWidgets.filter(w => w.id !== config.id);
				this.setActiveWidgets(col, activeWidgets);
				this.settings.overviewPins = this.settings.overviewPins.filter(p => p.widgetId !== config.id);
				await this.saveQuiet();
				card.remove();
			};
		}

		let widgetRecords = records;
		if (config.filterField && config.filterValue) {
			const targetVal = config.filterValue.toLowerCase();
			widgetRecords = records.filter(r => {
				const val = r.fields[config.filterField!];
				if (Array.isArray(val)) return val.some(v => String(v).toLowerCase() === targetVal);
				return String(val ?? '').toLowerCase() === targetVal;
			});
		}

		const body = card.createDiv('dash-widget-body');
		const factory = new WidgetFactory(this.cssVar.bind(this));
		this.chartFactoryQueue.push(() => {
			factory.render({ 
				body, config, records: widgetRecords, collection: col, charts: this.charts as unknown as import('chart.js').Chart[],
				colorTheme: this.settings.colorPaletteTheme,
				year: this.activeMode === 'year' ? this.year : 'all-time',
				onDrilldown: (filterVal) => {
					let drilldownRecords = widgetRecords;
					if (config.type === 'activity' || config.type === 'heatmap') {
						const reader = new CollectionReader(this.app);
						drilldownRecords = reader.loadRecords(col, this.activeMode, 'all-time');
					}
					const reloadFn = () => {
						const rdr = new CollectionReader(this.app);
						const yr = this.activeMode === 'year' ? this.year : 'all-time';
						let recs = rdr.loadRecords(col, this.activeMode, yr);
						if (config.type === 'activity' || config.type === 'heatmap') {
							recs = rdr.loadRecords(col, this.activeMode, 'all-time');
						}
						if (config.filterField && config.filterValue) {
							const targetVal = config.filterValue.toLowerCase();
							recs = recs.filter(r => {
								const val = r.fields[config.filterField!];
								if (Array.isArray(val)) return val.some(v => String(v).toLowerCase() === targetVal);
								return String(val ?? '').toLowerCase() === targetVal;
							});
						}
						return recs;
					};
					this.glanceDrilldown.show({
						parentEl: this.contentEl,
						col,
						config,
						initialFilter: filterVal,
						records: drilldownRecords,
						globalYear: this.activeMode === 'year' ? this.year : 'all-time',
						onSaveQuiet: () => this.saveQuiet(),
						onReloadRecords: reloadFn,
					});
				},
				onSave: () => this.saveQuiet(),
			});
		});
	}

	private async moveWidgetInLayout(col: CollectionConfig, widgetId: string, direction: -1 | 1, isPinRef: boolean): Promise<void> {
		if (isPinRef) {
			const layout = this.settings.overviewLayout!;
			const idx = layout.findIndex(i => i.id === widgetId);
			if (idx === -1) return;
			const targetIdx = idx + direction;
			if (targetIdx < 0 || targetIdx >= layout.length) return;
			const [item] = layout.splice(idx, 1);
			layout.splice(targetIdx, 0, item);
			this.settings.overviewLayout = layout;
			await this.saveQuiet();
			void this.render();
		} else {
			const activeWidgets = this.getActiveWidgets(col);
			const idx = activeWidgets.findIndex(w => w.id === widgetId);
			if (idx === -1) return;
			const targetIdx = idx + direction;
			if (targetIdx < 0 || targetIdx >= activeWidgets.length) return;
			const [item] = activeWidgets.splice(idx, 1);
			activeWidgets.splice(targetIdx, 0, item);
			this.setActiveWidgets(col, activeWidgets);
			await this.saveQuiet();
			void this.render();
		}
	}
}

function uid(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
