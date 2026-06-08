import { ItemView, WorkspaceLeaf, setIcon, Modal, App, Notice, TFile, SliderComponent, Menu } from 'obsidian';
import { Chart, registerables } from 'chart.js';
import type {
	CollectionConfig, DashboardSettings, OverviewItem,
	RawRecord, WidgetConfig, WidgetSize, WidgetType, ChartType, AggregationType,
} from '../types';
import { migrateSize, sizeToClass } from '../types';
import { CollectionReader } from '../core/CollectionReader';
import { WidgetFactory, WIDGET_TYPE_LABELS } from './WidgetFactory';
import type LibraryDashPlugin from '../main';
import { extractDate, getISOWeek, toNumber } from '../utils/dateUtils';

Chart.register(...registerables);
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = 10;

export const VIEW_TYPE_DASHBOARD = 'dynamic-dashboard-view';

// ─── Add Widget Modal ──────────────────────────────────────────────────────────

class AddWidgetModal extends Modal {
	private collection: CollectionConfig;
	private onSave: (cfg: WidgetConfig) => void | Promise<void>;
	private editing: WidgetConfig | null;

	constructor(
		app: App,
		collection: CollectionConfig,
		onSave: (cfg: WidgetConfig) => void | Promise<void>,
		editing: WidgetConfig | null = null,
	) {
		super(app);
		this.collection = collection;
		this.onSave = onSave;
		this.editing = editing;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-add-widget-modal');

		const e = this.editing;
		contentEl.createDiv({ text: e ? 'Edit Widget' : 'Add Widget', cls: 'dash-modal-title' });

		// ── Widget Type (pills) ───────────────────────────────────────────────
		let widgetType: WidgetType = e?.type ?? 'distribution';
		this.buildSectionLabel(contentEl, 'Widget Type');
		const typeGroup = contentEl.createDiv('dash-modal-pill-group');
		const typeEntries: [WidgetType, string][] = [
			['distribution', 'Distribution'],
			['number-card', 'Number Card'],
			['ranking',     'Ranking'],
			['activity',    'Activity'],
			['boolean',     'Boolean'],
		];
		typeEntries.forEach(([val, label]) => {
			const btn = typeGroup.createEl('button', {
				text: label,
				cls: `dash-modal-pill ${widgetType === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				typeGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				widgetType = val;
				refreshConditional();
			};
		});

		// ── Field (custom themed dropdown) ────────────────────────────────────
		this.buildSectionLabel(contentEl, 'Field');
		let field = e?.field ?? '';
		const fieldPickerWrap = contentEl.createDiv('dash-field-picker');
		
		const fieldHeader = fieldPickerWrap.createDiv('dash-field-header');
		const fieldSelectedText = fieldHeader.createSpan({ text: field || 'Select a field', cls: 'dash-field-selected-text' });
		fieldHeader.createSpan({ text: '▼', cls: 'dash-field-chevron' });

		const fieldDropdown = fieldPickerWrap.createDiv('dash-field-dropdown dash-hidden');

		const fieldSearch = fieldDropdown.createEl('input', {
			cls: 'dash-field-search',
			placeholder: 'Search fields…',
			attr: { spellcheck: 'false', autocomplete: 'off' },
		});
		const fieldListEl = fieldDropdown.createDiv('dash-field-list');

		const toggleDropdown = (force?: boolean) => {
			const isOpen = force !== undefined ? force : fieldDropdown.hasClass('dash-hidden');
			if (isOpen) {
				fieldDropdown.removeClass('dash-hidden');
				fieldPickerWrap.addClass('dash-field-dropdown-open');
				fieldSearch.focus();
				renderFieldList();
			} else {
				fieldDropdown.addClass('dash-hidden');
				fieldPickerWrap.removeClass('dash-field-dropdown-open');
			}
		};
		fieldHeader.onclick = () => toggleDropdown();

		const renderFieldList = () => {
			fieldListEl.empty();
			const compatible = this.collection.schema.filter(s => {
				if (widgetType === 'number-card' || widgetType === 'ranking') return s.type === 'number';
				if (widgetType === 'activity') return s.type === 'date';
				if (widgetType === 'boolean') return s.type === 'boolean';
				// distribution: text / array / boolean OK
				return s.type === 'text' || s.type === 'array' || s.type === 'boolean';
			});
			const q = fieldSearch.value.toLowerCase();
			const shown = q ? compatible.filter(s => s.key.toLowerCase().includes(q)) : compatible;
			if (!shown.length) {
				fieldListEl.createDiv({ text: 'No compatible fields for this widget type', cls: 'dash-field-empty' });
				return;
			}
			// Auto-select first if nothing chosen or field no longer compatible
			if (!shown.find(s => s.key === field)) {
				field = shown[0].key;
				fieldSelectedText.setText(field);
			} else {
				fieldSelectedText.setText(field);
			}
			shown.forEach(s => {
				const item = fieldListEl.createDiv({ cls: `dash-field-item${field === s.key ? ' active' : ''}` });
				item.createSpan({ text: s.key, cls: 'dash-field-key' });
				item.createSpan({ text: `${Math.round(s.coverage * 100)}%`, cls: 'dash-field-pct' });
				item.onclick = (ev) => {
					ev.stopPropagation();
					field = s.key;
					fieldSelectedText.setText(field);
					fieldListEl.querySelectorAll('.dash-field-item').forEach(i => i.removeClass('active'));
					item.addClass('active');
					toggleDropdown(false);
				};
			});
		};
		fieldSearch.oninput = renderFieldList;

		// Close dropdown when clicking outside
		const closeOutside = (ev: MouseEvent) => {
			if (!fieldPickerWrap.contains(ev.target as Node)) {
				toggleDropdown(false);
			}
		};
		activeDocument.addEventListener('click', closeOutside);
		
		// Cleanup listener when modal closes
		const origClose = this.close.bind(this);
		this.close = () => {
			activeDocument.removeEventListener('click', closeOutside);
			origClose();
		};



		// ── Chart Type pills (distribution only) ──────────────────────────────
		const chartWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(chartWrap, 'Chart Type');
		let chartType: ChartType = e?.chartType ?? (widgetType === 'ranking' ? 'list' : 'doughnut');
		const chartGroup = chartWrap.createDiv('dash-modal-pill-group');
		const chartEntries: [ChartType, string][] = [
			...(widgetType === 'ranking' ? [['list', 'List'] as [ChartType, string]] : []),
			['doughnut',      'Donut'],
			['pie',           'Pie'],
			['bar-horizontal','Bar H'],
			['bar-vertical',  'Bar V'],
			['line',          'Line'],
		];
		chartEntries.forEach(([val, label]) => {
			const btn = chartGroup.createEl('button', {
				text: label,
				cls: `dash-modal-pill ${chartType === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				chartGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				chartType = val;
			};
		});

		// ── Aggregation pills (number-card / ranking only) ────────────────────
		const aggWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(aggWrap, 'Aggregation');
		let aggregation: AggregationType = e?.aggregation ?? 'count';
		const aggGroup = aggWrap.createDiv('dash-modal-pill-group');
		const aggEntries: [AggregationType, string][] = [
			['count',   'Count'],
			['sum',     'Sum'],
			['average', 'Average'],
			['min',     'Min'],
			['max',     'Max'],
			['formula', 'Formula'],
		];
		
		const formulaWrap = contentEl.createDiv('dash-modal-inputs-row');
		formulaWrap.style.display = aggregation === 'formula' ? 'flex' : 'none';
		const fMathWrap = formulaWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fMathWrap.createDiv({ text: 'Math Expression (e.g. episode * duration)', cls: 'dash-modal-input-label' });
		const mathExpressionInput = fMathWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'episode * duration',
			value: e?.mathExpression ?? '',
		});

		// Variable Autocomplete Helper
		const helperContainer = fMathWrap.createDiv('dash-formula-helper');
		helperContainer.createSpan({ text: 'Insert variable: ', cls: 'dash-formula-helper-label' });
		const numericFields = this.collection.schema.filter(s => s.type === 'number');
		if (numericFields.length === 0) {
			helperContainer.createSpan({ text: 'No numeric fields discovered.', cls: 'dash-formula-helper-empty' });
		} else {
			numericFields.forEach(f => {
				const pill = helperContainer.createEl('button', {
					text: f.key,
					cls: 'dash-formula-pill-btn',
					attr: { type: 'button', tabindex: '-1' }
				});
				pill.onclick = (ev) => {
					ev.preventDefault();
					const input = mathExpressionInput;
					const start = input.selectionStart ?? input.value.length;
					const end = input.selectionEnd ?? input.value.length;
					const val = input.value;
					input.value = val.substring(0, start) + f.key + val.substring(end);
					input.focus();
					input.setSelectionRange(start + f.key.length, start + f.key.length);
				};
			});
		}
		
		aggEntries.forEach(([val, label]) => {
			const btn = aggGroup.createEl('button', {
				text: label,
				cls: `dash-modal-pill ${aggregation === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				aggGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				aggregation = val;
				formulaWrap.style.display = aggregation === 'formula' ? 'flex' : 'none';
			};
		});

		// ── Pre-filter ────────────────────────────────────────────────────────
		const preFilterWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(preFilterWrap, 'Pre-filter (Optional)');
		const filterWrap = preFilterWrap.createDiv('dash-modal-inputs-row');
		
		const fFieldWrap = filterWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fFieldWrap.createDiv({ text: 'Filter Field', cls: 'dash-modal-input-label' });
		const filterFieldInput = fFieldWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g., status',
			value: e?.filterField ?? '',
		});

		const fValWrap = filterWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fValWrap.createDiv({ text: 'Required Value', cls: 'dash-modal-input-label' });
		const filterValueInput = fValWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g., true / completed',
			value: e?.filterValue ?? '',
		});

		// ── Boolean Labels (boolean only) ───────────────────────────────────
		const booleanLabelsWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(booleanLabelsWrap, 'Custom Boolean Labels (Optional)');
		const bLabelsRow = booleanLabelsWrap.createDiv('dash-modal-inputs-row');

		const trueLabelWrap = bLabelsRow.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		trueLabelWrap.createDiv({ text: 'True Label (e.g. Watched)', cls: 'dash-modal-input-label' });
		const trueLabelInput = trueLabelWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. Watched / Yes',
			value: e?.trueLabel ?? '',
		});

		const falseLabelWrap = bLabelsRow.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		falseLabelWrap.createDiv({ text: 'False Label (e.g. Unwatched)', cls: 'dash-modal-input-label' });
		const falseLabelInput = falseLabelWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. Unwatched / No',
			value: e?.falseLabel ?? '',
		});

		// ── Legend Position (distribution only) ──────────────────────────────
		const legendWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(legendWrap, 'Legend Position');
		let legendPosition = e?.legendPosition ?? 'right';
		const legendGroup = legendWrap.createDiv('dash-modal-pill-group');
		const legendEntries: ['bottom'|'right'|'hidden', string][] = [
			['right', 'Right'],
			['bottom', 'Bottom'],
			['hidden', 'Hidden'],
		];
		legendEntries.forEach(([val, label]) => {
			const btn = legendGroup.createEl('button', {
				text: label,
				cls: `dash-modal-pill ${legendPosition === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				legendGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				legendPosition = val;
			};
		});

		// ── Visibility logic ──────────────────────────────────────────────────
		let iconPickerWrap: HTMLElement | null = null;
		const refreshConditional = () => {
			renderFieldList();
			const isChartType = widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking';
			chartWrap.style.display = isChartType ? '' : 'none';
			aggWrap.style.display   = (widgetType === 'number-card' || widgetType === 'ranking') ? '' : 'none';
			legendWrap.style.display = (isChartType && (chartType as string) !== 'value-area') ? '' : 'none';
			preFilterWrap.style.display = widgetType === 'activity' ? 'none' : '';
			booleanLabelsWrap.style.display = widgetType === 'boolean' ? '' : 'none';
			// Show icon picker only for number-card
			if (iconPickerWrap) iconPickerWrap.style.display = widgetType === 'number-card' ? '' : 'none';
		};
		refreshConditional();

		// ── Limit + Title — two-column grid, labels always top-aligned ────────
		const inputsWrap = contentEl.createDiv('dash-modal-inputs-grid');

		const lWrap = inputsWrap.createDiv('dash-modal-input-group');
		lWrap.createDiv({ text: 'Top N', cls: 'dash-modal-input-label' });
		let topN = e?.topN ?? 12;
		const topNInput = lWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			type: 'text',
			value: String(topN),
		});
		topNInput.min = '1'; topNInput.max = '50';
		topNInput.onchange = () => { topN = parseInt(topNInput.value) || 12; };

		const tWrap = inputsWrap.createDiv('dash-modal-input-group');
		tWrap.createDiv({ text: 'Title (optional)', cls: 'dash-modal-input-label' });
		const titleInput = tWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'Auto-filled from field name',
			value: e?.title ?? '',
		});

		// ── Icon Picker (number-card only, settings-panel style) ──────────────
		const ICON_OPTIONS = [
			'hash', 'clock', 'star', 'film', 'tv', 'book', 'book-open',
			'gamepad-2', 'trophy', 'library', 'layers', 'trending-up',
			'activity', 'calendar', 'heart', 'zap', 'target', 'award',
			'headphones', 'music', 'camera', 'image', 'package', 'box',
		];
		let selectedIcon: string = e?.icon ?? 'hash';

		iconPickerWrap = contentEl.createDiv('dash-modal-section dash-icon-picker-wrap');
		this.buildSectionLabel(iconPickerWrap, 'Icon');
		iconPickerWrap.createDiv({ 
			text: 'Click an icon to select it, or type a custom Lucide icon name below.',
			cls: 'dash-icon-picker-subtitle',
		});

		// Bordered container like settings panel
		const iconPickerBox = iconPickerWrap.createDiv('dash-icon-picker-box');
		const iconGrid = iconPickerBox.createDiv('dash-icon-picker-grid');
		ICON_OPTIONS.forEach(ico => {
			const btn = iconGrid.createEl('button', {
				cls: `dash-icon-picker-btn ${ico === selectedIcon ? 'active' : ''}`,
				attr: { 'aria-label': ico, 'title': ico },
			});
			setIcon(btn, ico);
			btn.onclick = () => {
				iconGrid.querySelectorAll('.dash-icon-picker-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				selectedIcon = ico;
				customIconInput.value = ico;
			};
		});

		// Custom icon name input
		const customRow = iconPickerWrap.createDiv('dash-icon-picker-custom-row');
		customRow.createSpan({ text: 'Custom:', cls: 'dash-icon-picker-custom-label' });
		const customIconInput = customRow.createEl('input', {
			cls: 'dash-icon-picker-custom-input',
			attr: { placeholder: 'e.g. flame, cpu, anchor…', value: selectedIcon },
		});
		customIconInput.oninput = () => {
			const val = customIconInput.value.trim();
			if (val) {
				selectedIcon = val;
				// Deselect all preset buttons since it's now custom
				iconGrid.querySelectorAll('.dash-icon-picker-btn').forEach(b => {
					b.toggleClass('active', (b as HTMLElement).getAttribute('aria-label') === val);
				});
			}
		};

		// ── Footer ────────────────────────────────────────────────────────────
		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', {
			text: e ? 'Save Changes' : 'Add Widget',
			cls: 'dash-modal-save mod-cta',
		});
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' })
			.onclick = () => this.close();

		saveBtn.onclick = () => {
			const f = field;
			if (!f) { new Notice('Please select a field.'); return; }

			const cfg: WidgetConfig = {
				id: e?.id ?? uid(),
				type: widgetType,
				title: titleInput.value.trim() || `${f} — ${WIDGET_TYPE_LABELS[widgetType]}`,
				field: f,
				filterField: filterFieldInput.value.trim() || undefined,
				filterValue: filterValueInput.value.trim() || undefined,
				aggregation: (widgetType === 'number-card' || widgetType === 'ranking') ? aggregation : undefined,
				mathExpression: ((widgetType === 'number-card' || widgetType === 'ranking') && aggregation === 'formula') ? mathExpressionInput.value.trim() : undefined,
				chartType: (widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking') ? chartType : undefined,
				legendPosition: (widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking') ? legendPosition : undefined,
				size: e ? migrateSize(e.size) : { height: 'small', span: 6 },
				topN,
				icon: widgetType === 'number-card' ? selectedIcon : undefined,
				pinnedToOverview: e?.pinnedToOverview ?? false,
				trueLabel: widgetType === 'boolean' ? trueLabelInput.value.trim() : undefined,
				falseLabel: widgetType === 'boolean' ? falseLabelInput.value.trim() : undefined,
			};
			void this.onSave(cfg);
			this.close();
		};
	}

	onClose() { this.contentEl.empty(); }

	private buildSectionLabel(parent: HTMLElement, text: string): void {
		parent.createDiv({ text, cls: 'dash-modal-section-label' });
	}
}

// ─── Add Overview Widget Modal ────────────────────────────────────────────────

class AddOverviewWidgetModal extends Modal {
	private onSave: (type: 'breakdown' | 'total-items') => void | Promise<void>;
	private existingLayout: OverviewItem[];

	constructor(app: App, existingLayout: OverviewItem[], onSave: (type: 'breakdown' | 'total-items') => void | Promise<void>) {
		super(app);
		this.existingLayout = existingLayout || [];
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-add-widget-modal');

		contentEl.createDiv({ text: 'Add Global Widget', cls: 'dash-modal-title' });

		const existingTypes = new Set(this.existingLayout.map(i => i.type));
		const typeEntries: ['total-items' | 'breakdown', string][] = [];
		if (!existingTypes.has('total-items')) typeEntries.push(['total-items', 'Total Items']);
		if (!existingTypes.has('breakdown')) typeEntries.push(['breakdown', 'Media Breakdown']);

		if (typeEntries.length === 0) {
			contentEl.createDiv({ text: 'All global widgets are already pinned to your Overview.', cls: 'dash-modal-section-label' });
			const footer = contentEl.createDiv('dash-modal-footer');
			footer.createEl('button', { text: 'Close', cls: 'dash-modal-cancel' }).onclick = () => this.close();
			return;
		}

		let widgetType: 'breakdown' | 'total-items' = typeEntries[0][0];
		contentEl.createDiv({ text: 'Widget Type', cls: 'dash-modal-section-label' });
		const typeGroup = contentEl.createDiv('dash-modal-pill-group');
		typeEntries.forEach(([val, label]) => {
			const btn = typeGroup.createEl('button', {
				text: label,
				cls: `dash-modal-pill ${widgetType === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				typeGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				widgetType = val;
			};
		});

		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', {
			text: 'Add Widget',
			cls: 'dash-modal-save mod-cta',
		});
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' })
			.onclick = () => this.close();

		saveBtn.onclick = () => {
			void this.onSave(widgetType);
			this.close();
		};
	}

	onClose() { this.contentEl.empty(); }
}

// ─── DashboardView ────────────────────────────────────────────────────────────

export class DashboardView extends ItemView {
	private year: number | 'all-time' = new Date().getFullYear();
	private activeMode: 'year' | 'library' = 'library';
	private activeTab: string = 'overview'; // collectionId or 'overview'
	private charts: Chart[] = [];
	private chartFactoryQueue: (() => void)[] = [];
	private static copiedWidgets: WidgetConfig[] | null = null;

	private dragY = -1;
	private autoScrollRaf: number | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: LibraryDashPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return 'Dashboard'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		this.contentEl.addEventListener('dragover', (e) => {
			this.dragY = e.clientY;
			this.startAutoScroll();
		});
		this.contentEl.addEventListener('dragend', () => this.stopAutoScroll());
		this.contentEl.addEventListener('drop', () => this.stopAutoScroll());
		
		await this.render();
	}

	async onClose(): Promise<void> {
		this.stopAutoScroll();
		this.destroyCharts();
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
				
				// Re-generate IDs to avoid conflicts
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

	private startAutoScroll() {
		if (this.autoScrollRaf) return;
		const loop = () => {
			if (this.dragY !== -1) {
				const rect = this.contentEl.getBoundingClientRect();
				const threshold = 60; // 60px from the screen edge
				if (this.dragY >= rect.top && this.dragY - rect.top < threshold) {
					this.contentEl.scrollTop -= 15;
				} else if (this.dragY <= rect.bottom && rect.bottom - this.dragY < threshold) {
					this.contentEl.scrollTop += 15;
				}
			}
			this.autoScrollRaf = window.requestAnimationFrame(loop);
		};
		loop();
	}

	private stopAutoScroll() {
		if (this.autoScrollRaf) window.cancelAnimationFrame(this.autoScrollRaf);
		this.autoScrollRaf = null;
		this.dragY = -1;
	}

	// ── Core ──────────────────────────────────────────────────────────────────

	private destroyCharts(): void {
		this.charts.forEach(c => c.destroy());
		this.charts = [];
	}

	private cssVar(name: string): string {
		return getComputedStyle(activeDocument.body).getPropertyValue(name).trim();
	}

	private get settings(): DashboardSettings {
		return this.plugin.settings;
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
	}

	/** Save without triggering full re-render; used for config panel changes. */
	private async saveQuiet(): Promise<void> {
		await this.plugin.saveSettingsQuiet();
	}

	// ── Render ────────────────────────────────────────────────────────────────

	private async render(): Promise<void> {
		this.destroyCharts();
		this.chartFactoryQueue = [];

		const { contentEl } = this;

		// Height lock to prevent flicker
		const h = contentEl.offsetHeight;
		if (h > 0) contentEl.style.minHeight = `${h}px`;

		const fragment = activeDocument.createDocumentFragment();
		const wrapper  = activeDocument.createElement('div');
		wrapper.className = 'dash-view';
		fragment.appendChild(wrapper);

		this.renderTopBar(wrapper);
		this.renderPageHeader(wrapper);
		this.renderTabs(wrapper);

		const contentOuter = wrapper.createDiv('dash-content-outer');
		const content = contentOuter.createDiv('dash-content');
		if (this.activeTab === 'overview') {
			this.renderOverview(content);
		} else {
			const col = this.settings.collections.find(c => c.id === this.activeTab);
			if (col) this.renderCollection(content, col);
		}

		contentEl.empty();
		contentEl.appendChild(fragment);

		// Defer Chart.js drawing until CSS layout is computed
		// Defer Chart.js drawing until CSS layout is computed
		this.flushChartQueue();
		window.requestAnimationFrame(() => {
			contentEl.style.removeProperty('min-height');
		});
	}

	private flushChartQueue() {
		window.requestAnimationFrame(() => {
			this.chartFactoryQueue.forEach(fn => fn());
			this.chartFactoryQueue = [];
			WidgetFactory.applyIcons(this.contentEl);
		});
	}


	// ── Page Header (title + count, between topbar and tabs) ──────────────────

	private renderPageHeader(el: HTMLElement): void {
		const header = el.createDiv('dash-page-header');

		const left = header.createDiv('dash-page-header-left');

		// Determine title and count based on active tab
		let title = 'Overview';
		let iconName = 'home';
		let count = 0;
		let color = this.cssVar('--interactive-accent');

		if (this.activeTab === 'overview') {
			const totalPins = this.settings.overviewPins.length;
			count = totalPins;
		} else {
			const col = this.settings.collections.find(c => c.id === this.activeTab);
			if (col) {
				title = col.name;
				iconName = col.icon;
				color = col.color;
				const reader = new CollectionReader(this.app);
				count = reader.loadRecords(col, this.activeMode, this.year).length;
			}
		}

		const iconWrap = left.createDiv('dash-page-header-icon');
		iconWrap.style.color = color;
		setIcon(iconWrap, iconName);

		const textWrap = left.createDiv('dash-page-header-text');
		textWrap.createDiv({ text: title, cls: 'dash-page-title' });
		textWrap.createDiv({
			text: `${count} ${count === 1 ? 'item' : 'items'}`,
			cls: 'dash-page-subtitle',
		});
	}

	// ── Top Bar ───────────────────────────────────────────────────────────────

	private renderTopBar(el: HTMLElement): void {
		const bar = el.createDiv('dash-topbar');

		// Mode switch (Year in Review / Library)
		const switchWrap = bar.createDiv('dash-mode-switch');
		(['library', 'year'] as const).forEach(mode => {
			const label = mode === 'year' ? 'Year in Review' : 'Library Stats';
			const btn = switchWrap.createEl('button', {
				text: label,
				cls: `dash-mode-btn ${this.activeMode === mode ? 'active' : ''}`,
			});
			btn.onclick = () => { this.activeMode = mode; void this.render(); };
		});

		// Right side — year navigation (year mode only) + refresh
		const right = bar.createDiv('dash-topbar-right');

		if (this.activeMode === 'year') {
			const allTimeBtn = right.createEl('button', {
				cls: `dash-nav-btn ${this.year === 'all-time' ? 'active' : ''}`,
				attr: { 'aria-label': 'All Time' },
			});
			setIcon(allTimeBtn, 'infinity');
			allTimeBtn.onclick = () => {
				this.year = this.year === 'all-time' ? new Date().getFullYear() : 'all-time';
				void this.render();
			};

			if (this.year !== 'all-time') {
				const prev = right.createEl('button', { cls: 'dash-nav-btn', attr: { 'aria-label': 'Previous year' } });
				setIcon(prev, 'chevron-left');
				prev.onclick = () => { (this.year as number)--; void this.render(); };
			}

			right.createSpan({
				text: this.year === 'all-time' ? 'All Time' : String(this.year),
				cls: 'dash-year-label',
			});

			if (this.year !== 'all-time') {
				const next = right.createEl('button', { cls: 'dash-nav-btn', attr: { 'aria-label': 'Next year' } });
				setIcon(next, 'chevron-right');
				next.onclick = () => { (this.year as number)++; void this.render(); };
			}
		}

		const refreshBtn = right.createEl('button', { cls: 'dash-refresh-btn', attr: { 'aria-label': 'Refresh' } });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.onclick = () => void this.render();
	}

	// ── Tab Bar (pill style) ──────────────────────────────────────────────────

	private renderTabs(el: HTMLElement): void {
		const bar = el.createDiv('dash-tabs');

		// Overview tab (always first)
		this.buildTab(bar, 'overview', 'home', 'Overview', this.activeTab === 'overview');

		// One tab per collection
		for (const col of this.settings.collections) {
			const reader = new CollectionReader(this.app);
			const count  = reader.loadRecords(col, this.activeMode, this.year).length;
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
		const btn = bar.createEl('button', { cls: `dash-tab ${active ? 'active' : ''}` });
		// For active collection tabs use their color, not accent
		if (active && color) {
			btn.style.setProperty('--tab-active-bg', color);
		}

		const iconEl = btn.createSpan('dash-tab-icon');
		setIcon(iconEl, icon);
		btn.createSpan({ text: label, cls: 'dash-tab-text' });

		btn.onclick = () => { this.activeTab = id; void this.render(); };
	}

	private getActiveWidgets(col: CollectionConfig): WidgetConfig[] {
		return this.activeMode === 'library' ? (col.libraryWidgets || []) : (col.yearWidgets || []);
	}

	private setActiveWidgets(col: CollectionConfig, widgets: WidgetConfig[]) {
		if (this.activeMode === 'library') {
			col.libraryWidgets = widgets;
		} else {
			col.yearWidgets = widgets;
		}
	}

	// ── Overview (Pinboard & Global Breakdown) ────────────────────────────────

	private renderOverview(el: HTMLElement): void {
		const cols = this.settings.collections;

		// Initialize overviewLayout if missing
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

		// ── Overview Toolbar ──────────────────────────────────────────────────
		const toolbar = el.createDiv('dash-collection-toolbar');
		const colLabel = toolbar.createDiv('dash-collection-label');
		const colIcon = colLabel.createDiv('dash-col-icon dash-col-icon-accent');
		setIcon(colIcon, 'layout-dashboard');
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

		// ── Auto-clean orphaned pins (widget or collection was deleted) ──────
		const before = this.settings.overviewLayout.length;
		this.settings.overviewLayout = this.settings.overviewLayout.filter(item => {
			if (item.type === 'breakdown' || item.type === 'total-items') return true; // always keep
			const col = cols.find(c => c.id === item.collectionId);
			if (!col) return false; // collection deleted
			const exists = (col.libraryWidgets || []).some(w => w.id === item.id) 
						|| (col.yearWidgets || []).some(w => w.id === item.id);
			return exists; // widget deleted
		});
		// Keep overviewPins in sync
		this.settings.overviewPins = this.settings.overviewPins.filter(p => {
			const col = cols.find(c => c.id === p.collectionId);
			if (!col) return false;
			return (col.libraryWidgets || []).some(w => w.id === p.widgetId)
				|| (col.yearWidgets || []).some(w => w.id === p.widgetId);
		});
		if (this.settings.overviewLayout.length !== before) {
			void this.saveQuiet(); // persist cleanup silently
		}

		const layoutItems = this.settings.overviewLayout;

		if (layoutItems.length === 0 && !cols.length) {
			const empty = el.createDiv('dash-overview-empty');
			setIcon(empty.createDiv('dash-empty-icon'), 'pin');
			empty.createDiv({ text: 'Your overview is empty', cls: 'dash-empty-title' });
			empty.createDiv({
				text: 'Create collections and pin widgets to build your dashboard.',
				cls: 'dash-empty-desc',
			});
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

				const reader  = new CollectionReader(this.app);
				const records = reader.loadRecords(col, this.activeMode, this.year);

				// Render pin and connect to layout
				this.buildWidgetCard(grid, col, widgetCfg, records, true, true, undefined, item);
			}
		}
	}

	private renderTotalItems(grid: HTMLElement, item?: OverviewItem): void {
		const cols = this.settings.collections;
		const reader = new CollectionReader(this.app);
		
		let total = 0;
		for (const col of cols) {
			const records = reader.loadRecords(col, this.activeMode, this.year);
			total += records.length;
		}

		if (total === 0 && !cols.length) return;
        if (!item) return;

		const legacy = this.settings.overviewTotalItems ?? { size: { height: 'small', span: 3 }, icon: 'library' };
		const resolvedSize = migrateSize(item.size ?? legacy.size);
		const icon = item.icon ?? legacy.icon ?? 'library';

		const card = activeDocument.createElement('div');
		card.className = `dash-widget ${sizeToClass(resolvedSize)} dash-widget-pinref`;
		const accentColor = this.settings.overviewColor || 'var(--interactive-accent)';
		card.style.setProperty('--collection-color', accentColor);
		card.dataset.widgetId = item.id;
		grid.appendChild(card);

		// ── Resize Handles ───────────────────────────────────────────────────────
		this.attachResizeHandles(card, grid, resolvedSize, async (newSize) => {
			item.size = newSize;
			await this.saveQuiet();
			// No render() needed, class is updated in-place by attachResizeHandles
		});

		// ── Header ───────────────────────────────────────────────────────────
		const header = card.createDiv('dash-widget-header');
		
		const handle = header.createDiv('dash-widget-drag-handle');
		for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
		
		// Only make card draggable when hovering over the handle
		handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
		handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));
		
		this.attachOverviewDragEvents(card, item.id);

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.backgroundColor = this.settings.overviewColor || 'var(--interactive-accent)';
		titleEl.createDiv({ text: 'TOTAL ITEMS', cls: 'dash-widget-title' });

		const actions = header.createDiv('dash-widget-actions');

		// Move up / down buttons for easy reordering (especially on mobile)
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-up', 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => {
			await this.moveWidgetInLayout(cols[0], item.id, -1, true);
		};

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-down', 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => {
			await this.moveWidgetInLayout(cols[0], item.id, 1, true);
		};

		const editBtn = actions.createEl('button', {
			cls: 'dash-widget-action-btn',
			attr: { 'data-icon': 'settings-2', 'aria-label': 'Edit' },
		});
		setIcon(editBtn, 'settings-2');
		editBtn.onclick = () => {
			new TotalItemsEditModal(this.app, { size: resolvedSize, icon }, async (updated) => {
				item.size = updated.size;
				item.icon = updated.icon;
				await this.saveQuiet();
				void this.render();
			}).open();
		};

		const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'data-icon': 'x', 'aria-label': 'Remove' } });
		setIcon(removeBtn, 'x');
		removeBtn.onclick = async () => {
			this.settings.overviewLayout = this.settings.overviewLayout!.filter(i => i.id !== item.id);
			await this.saveQuiet();
			card.remove();
		};

		// ── Body ─────────────────────────────────────────────────────────────
		const body = card.createDiv('dash-widget-body');
		
		const numCard = body.createDiv('dash-number-card');
		const iconWrap = numCard.createDiv('dash-number-icon');
		setIcon(iconWrap, icon);
		
		numCard.createDiv({ text: String(total), cls: 'dash-number-value' });
		numCard.createDiv({ text: 'TOTAL ITEMS', cls: 'dash-number-label' });
	}

	private renderMediaBreakdown(grid: HTMLElement, item?: OverviewItem): void {
		const cols = this.settings.collections;
		const reader = new CollectionReader(this.app);

		const labels: string[] = [];
		const data: number[] = [];
		const bgColors: string[] = [];
		let totalItems = 0;

		for (const col of cols) {
			const records = reader.loadRecords(col, this.activeMode, this.year);
			if (records.length > 0) {
				labels.push(col.name);
				data.push(records.length);
				bgColors.push(col.color);
				totalItems += records.length;
			}
		}

		// if (totalItems === 0) return;
        if (!item) return;

		// Load persisted settings or fall back to defaults
		const legacy = this.settings.overviewMediaBreakdown ?? { size: { height: 'small', span: 6 }, chartType: 'doughnut' };
		const resolvedBreakdownSize = migrateSize(item.size ?? legacy.size);
		const chartType = item.chartType ?? legacy.chartType ?? 'doughnut';

		const card = activeDocument.createElement('div');
		card.className = `dash-widget ${sizeToClass(resolvedBreakdownSize)} dash-widget-pinref`;
		const accentColor = this.settings.overviewColor || 'var(--interactive-accent)';
		card.style.setProperty('--collection-color', accentColor);
		card.dataset.widgetId = item.id;
		grid.appendChild(card);

		// ── Resize Handles ───────────────────────────────────────────────────────
		this.attachResizeHandles(card, grid, resolvedBreakdownSize, async (newSize) => {
			item.size = newSize;
			await this.saveQuiet();
			// No render() needed, class is updated in-place by attachResizeHandles
		});

		// ── Header ───────────────────────────────────────────────────────────
		const header = card.createDiv('dash-widget-header');

		const handle = header.createDiv('dash-widget-drag-handle');
		for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
		
		// Only make card draggable when hovering over the handle
		handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
		handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));
		
		this.attachOverviewDragEvents(card, item.id);

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.backgroundColor = this.settings.overviewColor || 'var(--interactive-accent)';
		titleEl.createDiv({ text: 'MEDIA BREAKDOWN', cls: 'dash-widget-title' });

		// Edit button to change size & chart type
		const actions = header.createDiv('dash-widget-actions');

		// Move up / down buttons for easy reordering (especially on mobile)
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-up', 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => {
			await this.moveWidgetInLayout(cols[0], item.id, -1, true);
		};

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-down', 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => {
			await this.moveWidgetInLayout(cols[0], item.id, 1, true);
		};

		const editBtn = actions.createEl('button', {
			cls: 'dash-widget-action-btn',
			attr: { 'data-icon': 'settings-2', 'aria-label': 'Edit' },
		});
		setIcon(editBtn, 'settings-2');
		editBtn.onclick = () => {
			new BreakdownEditModal(this.app, { size: resolvedBreakdownSize, chartType }, async (updated) => {
				item.size = updated.size;
				item.chartType = updated.chartType;
				await this.saveQuiet();
				void this.render();
			}).open();
		};

		const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'data-icon': 'x', 'aria-label': 'Remove' } });
		setIcon(removeBtn, 'x');
		removeBtn.onclick = async () => {
			this.settings.overviewLayout = this.settings.overviewLayout!.filter(i => i.id !== item.id);
			await this.saveQuiet();
			card.remove();
		};

		// ── Body ─────────────────────────────────────────────────────────────
		const body = card.createDiv('dash-widget-body');
		// Bind chart height to size height: mini ≈ 120px, small ≈ 240px
		const heightVal = resolvedBreakdownSize.height === 'mini' ? '120px' : '240px';
		body.style.height = heightVal;
		body.style.minHeight = heightVal;
		body.style.maxHeight = heightVal;

		if (totalItems === 0) {
			body.addClass('dash-widget-body-empty');
			body.createDiv({ 
				text: `No data recorded for ${this.year === 'all-time' ? 'all time' : this.year}`, 
				cls: 'dash-widget-empty-msg' 
			});
			return;
		}

		const canvas = body.createEl('canvas', { cls: 'dash-canvas-full' });

		this.chartFactoryQueue.push(() => {
			// Map our ChartType to Chart.js type
			const ctMap: Record<string, string> = {
				'doughnut': 'doughnut', 'pie': 'pie',
				'bar-vertical': 'bar', 'bar-horizontal': 'bar',
			};
			const jsType = (ctMap[chartType] ?? 'doughnut') as 'doughnut' | 'pie' | 'bar' | 'line';
			const isHorizontal = chartType === 'bar-horizontal';
			const isBar = chartType === 'bar-vertical' || isHorizontal;
			const isPie = chartType === 'doughnut' || chartType === 'pie';

			// Destroy any existing chart on this canvas to avoid "canvas already in use"
			const existingChart = Chart.getChart(canvas);
			if (existingChart) existingChart.destroy();

			// Force pixel dimensions so pie/doughnut charts aren't zero-sized
			const bodyRect = body.getBoundingClientRect();
			const canvasW = bodyRect.width > 0 ? bodyRect.width : body.offsetWidth || 300;
			const canvasH = bodyRect.height > 0 ? bodyRect.height : body.offsetHeight || 240;
			canvas.width = canvasW;
			canvas.height = canvasH;

			const chart = new Chart(canvas, {
				type: jsType,
				data: {
					labels,
					datasets: [{
						data,
						backgroundColor: bgColors,
						borderWidth: isBar ? 0 : 0,
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
							labels: { color: this.cssVar('--text-muted'), font: { family: 'inherit' }, usePointStyle: true, boxWidth: 8 },
						},
						tooltip: {
							callbacks: {
								label: (ctx: import('chart.js').TooltipItem<'line' | 'bar' | 'pie' | 'doughnut'>) => {
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
			this.charts.push(chart);
		});
	}

	/** Attach lightweight drag events to an overview card (doesn't touch collection widgets) */
	private attachOverviewDragEvents(card: HTMLElement, itemId: string): void {
		card.addEventListener('dragstart', (e) => {
			card.addClass('dash-dragging');
			e.dataTransfer?.setData('text/plain', itemId);
		});
		card.addEventListener('dragend', () => {
			card.removeClass('dash-dragging');
			activeDocument.querySelectorAll('.dash-drag-over').forEach(el => el.removeClass('dash-drag-over'));
		});
		card.addEventListener('dragover', (e) => {
			e.preventDefault();
			const srcId = e.dataTransfer?.getData('text/plain');
			if (srcId && srcId !== itemId) card.addClass('dash-drag-over');
		});
		card.addEventListener('dragleave', () => card.removeClass('dash-drag-over'));
		card.addEventListener('drop', (e) => {
			e.preventDefault();
			card.removeClass('dash-drag-over');
			const srcId = e.dataTransfer?.getData('text/plain');
			if (!srcId || srcId === itemId) return;

			const layout2 = this.settings.overviewLayout!;
			const fromIdx = layout2.findIndex(i => i.id === srcId);
			const toIdx   = layout2.findIndex(i => i.id === itemId);
			if (fromIdx === -1 || toIdx === -1) return;

			const [moved] = layout2.splice(fromIdx, 1);
			layout2.splice(toIdx, 0, moved);
			this.settings.overviewLayout = layout2;
			void this.saveQuiet().then(() => {
				// Move visually without re-render
				const grid = card.parentElement;
				if (grid) {
					const draggedEl = grid.querySelector(`[data-widget-id="${srcId}"]`) as HTMLElement;
					if (draggedEl) {
						if (fromIdx < toIdx) {
							card.after(draggedEl);
						} else {
							card.before(draggedEl);
						}
					}
				}
			});
		});
	}

	// ── Collection Tab ────────────────────────────────────────────────────────

	private renderCollection(el: HTMLElement, col: CollectionConfig): void {
		// Toolbar
		const toolbar = el.createDiv('dash-collection-toolbar');
		const colLabel = toolbar.createDiv('dash-collection-label');
		const colIcon = colLabel.createDiv('dash-col-icon');
		colIcon.style.backgroundColor = col.color;
		setIcon(colIcon, col.icon);
		colLabel.createDiv({ text: col.name, cls: 'dash-col-name' });

		if (!col.schema.length) {
			colLabel.createDiv({
				text: 'Schema not scanned yet — go to Settings to scan.',
				cls: 'dash-col-hint',
			});
		}

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

		// Load records
		const reader  = new CollectionReader(this.app);
		const records = reader.loadRecords(col, this.activeMode, this.year);

		// Widget grid
		let activeWidgets = this.getActiveWidgets(col);
		
		if (!activeWidgets.length) {
			const empty = el.createDiv('dash-overview-empty');
			setIcon(empty.createDiv('dash-empty-icon'), 'layers');
			empty.createDiv({ text: 'No widgets yet', cls: 'dash-empty-title' });
			empty.createDiv({ text: 'Click "Add Widget" to build your dashboard.', cls: 'dash-empty-desc' });
			return;
		}

		const grid = el.createDiv('dash-grid');
		// Reordering handled by attachDragEvents below

		// Replace default buildCard with a wrapper that calls our full card builder
		activeWidgets.forEach(wcfg => {
			this.buildWidgetCard(grid, col, wcfg, records, false, true);
		});
	}

	// ── Partial widget re-render (replaces a single card DOM node in-place) ──
	private refreshWidgetCard(card: HTMLElement, grid: HTMLElement, col: CollectionConfig, config: WidgetConfig, records: RawRecord[], isDraggable?: boolean) {
		const next = activeDocument.createElement('div');
		grid.insertBefore(next, card);
		card.remove();
		this.buildWidgetCard(grid, col, config, records, false, isDraggable, next);
		this.flushChartQueue();
	}
	// ── Widget Card ───────────────────────────────────────────────────────────

	private attachResizeHandles(
		card: HTMLElement,
		grid: HTMLElement,
		currentSize: WidgetSize,
		onResizeEnd: (newSize: WidgetSize) => Promise<void>
	): void {
		// Helper to apply classes without full DOM re-render
		const applySizeClass = (size: WidgetSize) => {
			const toRemove = Array.from(card.classList).filter(c => 
				c.startsWith('dash-widget-s') || c.startsWith('dash-widget-h-')
			);
			toRemove.forEach(c => card.classList.remove(c));
			card.classList.add(`dash-widget-h-${size.height}`);
			card.classList.add(`dash-widget-s${size.span}`);
		};

		// ── Snap-to-Grid right handle ──
		const SPANS = [3, 4, 6, 9, 12] as const;
		const resizeHandle = card.createDiv('dash-widget-resize-handle');
		resizeHandle.setAttribute('title', 'Drag to resize width');
		resizeHandle.addEventListener('mousedown', (startEv) => {
			startEv.preventDefault();
			startEv.stopPropagation();
			card.addClass('dash-resizing');
			const startX = startEv.clientX;
			const gridWidth = grid.offsetWidth;
			const colWidth = gridWidth / 12;
			const curSpan = currentSize.span;

			const onMove = (mv: MouseEvent) => {
				const dx = mv.clientX - startX;
				const targetCols = Math.round(curSpan + dx / colWidth);
				const snapped = SPANS.reduce((prev, cur) =>
					Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
				);
				card.style.gridColumn = `span ${snapped}`;
			};

			const onUp = (upEv: MouseEvent) => {
				activeDocument.removeEventListener('mousemove', onMove);
				activeDocument.removeEventListener('mouseup', onUp);
				card.removeClass('dash-resizing');
				card.style.removeProperty('grid-column');

				const dx = upEv.clientX - startX;
				const targetCols = Math.round(curSpan + dx / colWidth);
				const snapped = SPANS.reduce((prev, cur) =>
					Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
				);

				if (snapped !== curSpan) {
					currentSize.span = snapped;
					applySizeClass(currentSize);
					void onResizeEnd(currentSize).then(() => {
						// Notify charts to redraw
						this.charts.forEach(c => c.resize());
					});
				}
			};

			activeDocument.addEventListener('mousemove', onMove);
			activeDocument.addEventListener('mouseup', onUp);
		});

		// Touch support for right handle
		resizeHandle.addEventListener('touchstart', (startEv) => {
			if (startEv.touches.length !== 1) return;
			startEv.preventDefault();
			startEv.stopPropagation();
			card.addClass('dash-resizing');
			const startX = startEv.touches[0].clientX;
			const gridWidth = grid.offsetWidth;
			const colWidth = gridWidth / 12;
			const curSpan = currentSize.span;

			const onTouchMove = (mv: TouchEvent) => {
				if (mv.touches.length !== 1) return;
				const dx = mv.touches[0].clientX - startX;
				const targetCols = Math.round(curSpan + dx / colWidth);
				const snapped = SPANS.reduce((prev, cur) =>
					Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
				);
				card.style.gridColumn = `span ${snapped}`;
			};

			const onTouchEnd = (upEv: TouchEvent) => {
				activeDocument.removeEventListener('touchmove', onTouchMove);
				activeDocument.removeEventListener('touchend', onTouchEnd);
				card.removeClass('dash-resizing');
				card.style.removeProperty('grid-column');

				if (upEv.changedTouches.length === 0) return;
				const dx = upEv.changedTouches[0].clientX - startX;
				const targetCols = Math.round(curSpan + dx / colWidth);
				const snapped = SPANS.reduce((prev, cur) =>
					Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
				);

				if (snapped !== curSpan) {
					currentSize.span = snapped;
					applySizeClass(currentSize);
					void onResizeEnd(currentSize).then(() => {
						this.charts.forEach(c => c.resize());
					});
				}
			};

			activeDocument.addEventListener('touchmove', onTouchMove, { passive: false });
			activeDocument.addEventListener('touchend', onTouchEnd);
		}, { passive: false });


		// ── Bottom height-toggle handle ──
		const heightHandle = card.createDiv('dash-widget-height-handle');
		heightHandle.setAttribute('title', 'Drag vertically or click to resize height');
		
		heightHandle.addEventListener('mousedown', (startEv) => {
			startEv.preventDefault();
			startEv.stopPropagation();
			card.addClass('dash-resizing');
			
			const startY = startEv.clientY;
			const initialHeight = currentSize.height;

			const onMove = (mv: MouseEvent) => {
				const dy = mv.clientY - startY;
				let targetHeight = initialHeight;
				if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
				else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
				
				// Preview
				if (targetHeight === 'small') {
					card.removeClass('dash-widget-h-mini');
					card.addClass('dash-widget-h-small');
				} else {
					card.removeClass('dash-widget-h-small');
					card.addClass('dash-widget-h-mini');
				}
			};

			const onUp = (upEv: MouseEvent) => {
				activeDocument.removeEventListener('mousemove', onMove);
				activeDocument.removeEventListener('mouseup', onUp);
				card.removeClass('dash-resizing');

				// Check drag distance. If it was very small (like < 3px), treat it as a click toggle.
				const dy = upEv.clientY - startY;
				let targetHeight = initialHeight;
				
				if (Math.abs(dy) < 5) {
					// Toggle behavior on click
					targetHeight = initialHeight === 'mini' ? 'small' : 'mini';
				} else {
					// Drag behavior
					if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
					else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
				}

				if (targetHeight !== initialHeight) {
					currentSize.height = targetHeight;
					applySizeClass(currentSize);
					void onResizeEnd(currentSize).then(() => {
						// Notify charts to redraw
						this.charts.forEach(c => c.resize());
					});
				} else {
					// Revert to actual initial height if not dragged enough
					applySizeClass(currentSize);
				}
			};

			activeDocument.addEventListener('mousemove', onMove);
			activeDocument.addEventListener('mouseup', onUp);
		});

		// Touch support for bottom handle
		heightHandle.addEventListener('touchstart', (startEv) => {
			if (startEv.touches.length !== 1) return;
			startEv.preventDefault();
			startEv.stopPropagation();
			card.addClass('dash-resizing');
			
			const startY = startEv.touches[0].clientY;
			const initialHeight = currentSize.height;

			const onTouchMove = (mv: TouchEvent) => {
				if (mv.touches.length !== 1) return;
				const dy = mv.touches[0].clientY - startY;
				let targetHeight = initialHeight;
				if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
				else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
				
				if (targetHeight === 'small') {
					card.removeClass('dash-widget-h-mini');
					card.addClass('dash-widget-h-small');
				} else {
					card.removeClass('dash-widget-h-small');
					card.addClass('dash-widget-h-mini');
				}
			};

			const onTouchEnd = (upEv: TouchEvent) => {
				activeDocument.removeEventListener('touchmove', onTouchMove);
				activeDocument.removeEventListener('touchend', onTouchEnd);
				card.removeClass('dash-resizing');

				if (upEv.changedTouches.length === 0) return;
				const dy = upEv.changedTouches[0].clientY - startY;
				let targetHeight = initialHeight;
				
				if (Math.abs(dy) < 5) {
					targetHeight = initialHeight === 'mini' ? 'small' : 'mini';
				} else {
					if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
					else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
				}

				if (targetHeight !== initialHeight) {
					currentSize.height = targetHeight;
					applySizeClass(currentSize);
					void onResizeEnd(currentSize).then(() => {
						this.charts.forEach(c => c.resize());
					});
				} else {
					applySizeClass(currentSize);
				}
			};

			activeDocument.addEventListener('touchmove', onTouchMove, { passive: false });
			activeDocument.addEventListener('touchend', onTouchEnd);
		}, { passive: false });
	}
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
		card.style.setProperty('--collection-color', accentColor);

		// ── Resize Handles ───────────────────────────────────────────────────────
		this.attachResizeHandles(card, grid, resolvedSize, async (newSize) => {
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
			// No render() needed, class is updated in-place by attachResizeHandles
		});

		// Header
		const header = card.createDiv('dash-widget-header');

		// Drag handle — collection view uses collection D&D, overview pins use overview D&D
		if (isDraggable) {
			const handle = header.createDiv('dash-widget-drag-handle');
			for (let i = 0; i < 3; i++) handle.createDiv('dash-drag-line');
			
			// Only make card draggable when hovering over the handle
			handle.addEventListener('mouseenter', () => card.setAttribute('draggable', 'true'));
			handle.addEventListener('mouseleave', () => card.removeAttribute('draggable'));

			if (isPinRef) {
				// In overview: reorder within overviewLayout
				const overviewId = overviewItemOverride?.id ?? config.id;
				this.attachOverviewDragEvents(card, overviewId);
			} else {
				// In collection tab: reorder within that collection's widgets
				this.attachDragEvents(card, config.id, col);
			}
		}

		const titleEl = header.createDiv('dash-widget-title-wrap');
		const dot = titleEl.createDiv('dash-widget-color-dot');
		dot.style.backgroundColor = isPinRef ? (this.settings.overviewColor || col.color) : col.color;
		titleEl.createDiv({ text: config.title, cls: 'dash-widget-title' });

		// Action buttons
		const actions = header.createDiv('dash-widget-actions');

		// Move up / down buttons for easy reordering (especially on mobile)
		const upBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-up', 'aria-label': 'Move Up' } });
		setIcon(upBtn, 'chevron-up');
		upBtn.onclick = async () => {
			const id = isPinRef ? (overviewItemOverride?.id ?? config.id) : config.id;
			await this.moveWidgetInLayout(col, id, -1, isPinRef);
		};

		const downBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-move', attr: { 'data-icon': 'chevron-down', 'aria-label': 'Move Down' } });
		setIcon(downBtn, 'chevron-down');
		downBtn.onclick = async () => {
			const id = isPinRef ? (overviewItemOverride?.id ?? config.id) : config.id;
			await this.moveWidgetInLayout(col, id, 1, isPinRef);
		};

		// Pin button (only in collection view, not in overview)
		if (!isPinRef) {
			const pinIcon = (config.pinnedToOverview ?? false) ? 'pin-off' : 'pin';
			const pinBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'data-icon': pinIcon, 'aria-label': 'Pin to Overview' } });
			pinBtn.onclick = async () => {
				const pinned = !(config.pinnedToOverview ?? false);
				config.pinnedToOverview = pinned;

				if (pinned) {
					// Legacy pins array
					if (!this.settings.overviewPins.find(p => p.widgetId === config.id)) {
						this.settings.overviewPins.push({ collectionId: col.id, widgetId: config.id });
					}
					// New layout array — add at end if not present
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
				// Just update the pin icon in-place — no full re-render needed
				setIcon(pinBtn, pinned ? 'pin-off' : 'pin');
				pinBtn.setAttribute('data-icon', pinned ? 'pin-off' : 'pin');
			};
			setIcon(pinBtn, pinIcon);
		}

		// In overview: show an "unpin" button to remove from overview
		if (isPinRef) {
			if (overviewItemOverride) {
				const pinEditBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'data-icon': 'settings-2', 'aria-label': 'Edit Pin Settings' } });
				setIcon(pinEditBtn, 'settings-2');
				pinEditBtn.onclick = () => {
					new PinEditModal(this.app, { size: config.size }, async (updated) => {
						overviewItemOverride.size = updated.size;
						await this.saveQuiet();
						void this.render();
					}).open();
				};
			}

			const unpinBtn = actions.createEl('button', {
				cls: 'dash-widget-action-btn dash-action-delete',
				attr: { 'data-icon': 'pin-off', 'aria-label': 'Remove from Overview' },
			});
			setIcon(unpinBtn, 'pin-off');
			unpinBtn.onclick = async () => {
				// Remove from overviewLayout
				if (this.settings.overviewLayout) {
					this.settings.overviewLayout = this.settings.overviewLayout.filter(i => i.id !== config.id);
				}
				// Remove from overviewPins (legacy)
				this.settings.overviewPins = this.settings.overviewPins.filter(p => p.widgetId !== config.id);
				// Unmark the widget itself
				config.pinnedToOverview = false;
				await this.saveQuiet();
				(card as HTMLElement).remove();
			};
		}

		if (!isPinRef) {
			// Edit button
			const editBtn = actions.createEl('button', { cls: 'dash-widget-action-btn', attr: { 'data-icon': 'settings-2', 'aria-label': 'Edit' } });
			editBtn.onclick = () => {
				new AddWidgetModal(this.app, col, async (cfg) => {
					let activeWidgets = this.getActiveWidgets(col);
					const idx = activeWidgets.findIndex(w => w.id === cfg.id);
					if (idx > -1) activeWidgets[idx] = cfg;
					this.setActiveWidgets(col, activeWidgets);
					await this.saveQuiet();
					// Re-render just this widget card in-place
					const reader = new CollectionReader(this.app);
					const recs = reader.loadRecords(col, this.activeMode, this.year);
					const cardEl = card as HTMLElement;
					const parentGrid = cardEl.parentElement!;
					const placeholder = activeDocument.createElement('div');
					parentGrid.insertBefore(placeholder, cardEl);
					cardEl.remove();
					this.buildWidgetCard(parentGrid, col, cfg, recs, false, true, placeholder);
					this.flushChartQueue();
				}, config).open();
			};

			// Remove button
			const removeBtn = actions.createEl('button', { cls: 'dash-widget-action-btn dash-action-delete', attr: { 'data-icon': 'x', 'aria-label': 'Remove' } });
			removeBtn.onclick = async () => {
				let activeWidgets = this.getActiveWidgets(col);
				activeWidgets = activeWidgets.filter(w => w.id !== config.id);
				this.setActiveWidgets(col, activeWidgets);
				this.settings.overviewPins = this.settings.overviewPins.filter(p => p.widgetId !== config.id);
				await this.saveQuiet();
				// Just remove card from DOM — no full re-render
				(card as HTMLElement).remove();
			};
		}

		// ── Widget-Level Pre-Filtering ───────────────────────────────
		let widgetRecords = records;
		if (config.filterField && config.filterValue) {
			const targetVal = config.filterValue.toLowerCase();
			widgetRecords = records.filter(r => {
				const val = r.fields[config.filterField!];
				if (Array.isArray(val)) return val.some(v => String(v).toLowerCase() === targetVal);
				return String(val ?? '').toLowerCase() === targetVal;
			});
		}

		// Body — defer Chart.js rendering
		const body = card.createDiv('dash-widget-body');
		const factory = new WidgetFactory(this.cssVar.bind(this));
		this.chartFactoryQueue.push(() => {
			factory.render({ 
				body, config, records: widgetRecords, collection: col, charts: this.charts,
				onDrilldown: (filterVal) => {
					let drilldownRecords = widgetRecords;
					if (config.type === 'activity') {
						const reader = new CollectionReader(this.app);
						drilldownRecords = reader.loadRecords(col, this.activeMode, 'all-time');
					}
					this.showDrilldown(col, config, filterVal, drilldownRecords);
				},
				onSave: () => this.saveQuiet(),
			});
		});
	}

	// ── Drill-down (Interactive Data View) ────────────────────────────────────

	private showDrilldown(col: CollectionConfig, config: WidgetConfig, initialFilter: string | null, records: RawRecord[]) {
		let wrapper = this.contentEl.querySelector('.dash-drilldown-wrapper');
		if (!wrapper) {
			const outer = this.contentEl.querySelector('.dash-content-outer') as HTMLElement;
			wrapper = outer.createDiv('dash-drilldown-wrapper');
		} else {
			wrapper.removeClass('hidden');
		}
		wrapper.empty();

		let drilldownYear: number | 'all-time' = this.year;

		// Get all unique years in dataset to allow navigations (if it's an activity chart)
		const availableYears = config.type === 'activity' ? Array.from(new Set(
			records.map(r => {
				const d = extractDate(r.fields[config.field]);
				return d ? d.getUTCFullYear() : null;
			}).filter((y): y is number => y !== null)
		)).sort((a, b) => a - b) : [];

		// Get all unique categories
		let catList: string[] = [];
		const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
		} else if (config.type === 'boolean') {
			const trueLabel = config.trueLabel || 'True (Yes)';
			const falseLabel = config.falseLabel || 'False (No)';
			catList = [trueLabel, falseLabel];
		} else {
			const categories = new Set<string>();
			records.forEach(r => {
				let val = r.fields[config.field];
				
				// Handle array or single value
				const vals = Array.isArray(val) ? val : [val];
				vals.forEach(v => {
					if (v === null || v === undefined) return;
					
					let label = String(v);
					// Apply custom boolean labels if it looks like a boolean
					const isTrue = v === true || label.toLowerCase() === 'true' || v === 1 || label.toLowerCase() === 'yes';
					const isFalse = v === false || label.toLowerCase() === 'false' || v === 0 || label.toLowerCase() === 'no';
					
					if (isTrue) label = config.trueLabel || 'True (Yes)';
					else if (isFalse) label = config.falseLabel || 'False (No)';
					
					categories.add(label);
				});
			});
			catList = Array.from(categories).sort();
		}

		if (catList.length === 0) return;

		let activeTab = initialFilter && catList.includes(initialFilter) ? initialFilter : 'All';
		if (!initialFilter && catList.length > 0) activeTab = 'All';

		// ── Drilldown config (per collection) ─────────────────────────────────
		if (!col.drilldownConfig) {
			col.drilldownConfig = { layout: 'cards', cardSize: 200, fields: [], imageFit: 'cover', imageAspectRatio: 1.0 };
		}
		const dc = col.drilldownConfig;
		// Migration for old 1-5 scale to direct px value
		if (dc.cardSize < 50) dc.cardSize = 200;

		// ── UI Shell ──────────────────────────────────────────────────────────
		const headerContainer = wrapper.createDiv('dash-drilldown-header-container');
		const titleRow = headerContainer.createDiv('dash-drilldown-title-row');
		titleRow.createDiv({ text: config.title, cls: 'dash-drilldown-title' });

		const headerRight = titleRow.createDiv('dash-drilldown-title-right');

		// Create container for year navigation first, so it sits on the left of config and close buttons
		let yearNavContainer: HTMLElement | null = null;
		if (config.type === 'activity' && activityResolution !== 'yearly') {
			yearNavContainer = headerRight.createDiv('dash-activity-year-nav');
		}

		// Configure button
		const configBtn = headerRight.createEl('button', { cls: 'dash-drilldown-config-btn', attr: { 'aria-label': 'Configure view' } });
		setIcon(configBtn, 'settings-2');

		const closeBtn = headerRight.createEl('button', { cls: 'dash-drilldown-close', attr: { 'aria-label': 'Close' } });
		setIcon(closeBtn, 'x');
		closeBtn.onclick = () => { wrapper.empty(); wrapper.addClass('hidden'); };

		const tabsRow = headerContainer.createDiv('dash-drilldown-tabs');

		// Create controls row (Search & Sort)
		const controlsRow = headerContainer.createDiv('dash-drilldown-controls');
		
		const searchInput = controlsRow.createEl('input', {
			cls: 'dash-drilldown-search',
			placeholder: 'Search by title…',
			attr: { spellcheck: 'false', autocomplete: 'off' },
		});

		const sortWrap = controlsRow.createDiv('dash-drilldown-sort-wrap');
		sortWrap.createSpan({ text: 'Sort by: ', cls: 'dash-drilldown-sort-label' });

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

		// Close when clicking outside
		const closeSortDrop = () => {
			sortDropList.addClass('hidden');
			sortDropBtn.removeClass('open');
		};
		activeDocument.addEventListener('click', closeSortDrop);

		closeBtn.onclick = () => {
			activeDocument.removeEventListener('click', closeSortDrop);
			wrapper.empty();
			wrapper.addClass('hidden');
		};

		searchInput.oninput = () => {
			searchQuery = searchInput.value.toLowerCase();
			renderContent(true);
		};

		// Main area: config panel (hidden by default) + content
		const mainArea = wrapper.createDiv('dash-drilldown-main');
		const configPanel = mainArea.createDiv('dash-drilldown-config-panel hidden');
		const contentArea = mainArea.createDiv('dash-drilldown-content');

		// Toggle config panel
		configBtn.onclick = () => {
			if (configPanel.hasClass('hidden')) {
				configPanel.removeClass('hidden');
				configBtn.addClass('active');
				this.buildConfigPanel(configPanel, col, () => renderContent(true));
			} else {
				configPanel.addClass('hidden');
				configBtn.removeClass('active');
			}
		};

		// Track scroll position to prevent jumping when config changes
		let savedScrollTop = 0;
		let savedOuterScrollTop = 0;
		const outerScroll = this.contentEl.closest('.workspace-leaf-content');

		const renderContent = (preserveScroll = false) => {
			// Save scroll positions before clearing
			if (preserveScroll) {
				savedScrollTop = contentArea.scrollTop;
				savedOuterScrollTop = outerScroll?.scrollTop ?? 0;
			}

			// Update tabs
			tabsRow.empty();
			const tabsToRender = catList.length > 1 ? ['All', ...catList] : catList;
			tabsToRender.forEach(cat => {
				const tab = tabsRow.createDiv({ cls: `dash-drilldown-tab ${cat === activeTab ? 'active' : ''}` });
				tab.innerText = cat;
				tab.onclick = () => { activeTab = cat; renderContent(false); };
			});

			contentArea.empty();

			let baseRecords = records;
			if (config.type === 'activity' && activityResolution !== 'yearly' && drilldownYear !== 'all-time') {
				baseRecords = records.filter(r => {
					const d = extractDate(r.fields[config.field]);
					return d ? d.getUTCFullYear() === drilldownYear : false;
				});
			}

			// Filter records
			let filtered = activeTab === 'All'
				? baseRecords
				: baseRecords.filter(r => {
					const val = r.fields[config.field];

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
				contentArea.createDiv({ text: 'No records found.', cls: 'dash-widget-empty' });
				return;
			}

			// Determine which fields to show — empty = show no metadata pills (just title)
			const fieldsToShow = dc.fields;

			// Render by layout
			if (dc.layout === 'cards') {
				this.renderDrilldownCards(contentArea, filtered, col, dc, fieldsToShow);
			} else {
				this.renderDrilldownTable(contentArea, filtered, col, dc, fieldsToShow);
			}

			// Restore scroll positions after re-render (for config panel changes)
			if (preserveScroll) {
				window.requestAnimationFrame(() => {
					contentArea.scrollTop = savedScrollTop;
					if (outerScroll) outerScroll.scrollTop = savedOuterScrollTop;
				});
			}
		};

		// Define renderYearNav after renderContent has been declared, so it can call renderContent safely
		let renderYearNav = () => {};
		if (config.type === 'activity' && activityResolution !== 'yearly' && yearNavContainer) {
			const container = yearNavContainer;
			renderYearNav = () => {
				container.empty();

				// Infinity button
				const allTimeBtn = container.createEl('button', {
					cls: `dash-activity-nav-btn ${drilldownYear === 'all-time' ? 'active' : ''}`,
					attr: { 'aria-label': 'All Time' }
				});
				setIcon(allTimeBtn, 'infinity');
				allTimeBtn.onclick = (e) => {
					e.stopPropagation();
					drilldownYear = 'all-time';
					renderYearNav();
					renderContent(true);
				};

				// Previous button
				const prevBtn = container.createEl('button', {
					cls: 'dash-activity-nav-btn',
					attr: { 'aria-label': 'Previous Year' }
				});
				setIcon(prevBtn, 'chevron-left');
				prevBtn.onclick = (e) => {
					e.stopPropagation();
					if (drilldownYear === 'all-time') {
						if (availableYears.length > 0) {
							drilldownYear = availableYears[availableYears.length - 1];
						}
					} else {
						const currentIdx = availableYears.indexOf(drilldownYear as number);
						if (currentIdx > 0) {
							drilldownYear = availableYears[currentIdx - 1];
						} else if (availableYears.length > 0) {
							drilldownYear = availableYears[availableYears.length - 1];
						}
					}
					renderYearNav();
					renderContent(true);
				};

				// Year Label
				container.createSpan({
					text: drilldownYear === 'all-time' ? 'All Time' : String(drilldownYear),
					cls: 'dash-activity-year-label'
				});

				// Next button
				const nextBtn = container.createEl('button', {
					cls: 'dash-activity-nav-btn',
					attr: { 'aria-label': 'Next Year' }
				});
				setIcon(nextBtn, 'chevron-right');
				nextBtn.onclick = (e) => {
					e.stopPropagation();
					if (drilldownYear === 'all-time') {
						if (availableYears.length > 0) {
							drilldownYear = availableYears[0];
						}
					} else {
						const currentIdx = availableYears.indexOf(drilldownYear as number);
						if (currentIdx < availableYears.length - 1 && currentIdx > -1) {
							drilldownYear = availableYears[currentIdx + 1];
						} else if (availableYears.length > 0) {
							drilldownYear = availableYears[0];
						}
					}
					renderYearNav();
					renderContent(true);
				};

				// Sync button (Sync with Global Year)
				const syncBtn = container.createEl('button', {
					cls: 'dash-activity-nav-btn',
					attr: { 'aria-label': 'Sync with Global Year' }
				});
				setIcon(syncBtn, 'refresh-cw');
				syncBtn.onclick = (e) => {
					e.stopPropagation();
					drilldownYear = this.year;
					renderYearNav();
					renderContent(true);
				};
			};
			renderYearNav();
		}

		renderContent(false);

		window.setTimeout(() => { wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
	}

	// ── Drilldown Render Modes ─────────────────────────────────────────────────

	private renderDrilldownCards(
		el: HTMLElement, records: RawRecord[], col: CollectionConfig,
		dc: import('../types').DrilldownConfig, fields: string[]
	) {
		const grid = el.createDiv('dash-drilldown-grid');
		grid.style.setProperty('--dd-card-min', `${dc.cardSize}px`);

		for (const rec of records) {
			const card = grid.createDiv('dash-drilldown-card');
			card.onclick = () => this.app.workspace.openLinkText(rec.filePath, '', true);

			// Image (only in cards layout)
			if (dc.imageField) {
				const rawImg = rec.fields[dc.imageField];
				const src = rawImg ? this.resolveImageSrc(String(rawImg)) : null;
				if (src) {
					const imgWrap = card.createDiv('dash-drilldown-img-wrap');
					imgWrap.style.setProperty('--dd-img-ratio', String(dc.imageAspectRatio));
					const img = imgWrap.createEl('img', { cls: 'dash-drilldown-img', attr: { src, loading: 'lazy' } });
					img.style.objectFit = dc.imageFit;
				}
			}

			card.createDiv({ text: rec.title, cls: 'dash-drilldown-card-title' });
			const meta = card.createDiv('dash-drilldown-card-meta');
			for (const key of fields) {
				const val = rec.fields[key];
				if (val === undefined || val === null) continue;
				const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
				if (!displayVal.trim()) continue;
				const pill = meta.createDiv('dash-drilldown-pill');
				pill.createSpan({ text: `${key}: `, cls: 'dash-drilldown-pill-label' });
				pill.createSpan({ text: displayVal, cls: 'dash-drilldown-pill-value' });
			}
		}
	}

	private renderDrilldownList(
		el: HTMLElement, records: RawRecord[], col: CollectionConfig,
		dc: import('../types').DrilldownConfig, fields: string[]
	) {
		const list = el.createDiv('dash-drilldown-list');
		for (const rec of records) {
			const row = list.createDiv('dash-drilldown-list-row');
			row.onclick = () => this.app.workspace.openLinkText(rec.filePath, '', true);

			const textBlock = row.createDiv('dash-drilldown-list-text');
			textBlock.createDiv({ text: rec.title, cls: 'dash-drilldown-list-title' });
			const meta = textBlock.createDiv('dash-drilldown-list-meta');
			const parts: string[] = [];
			for (const key of fields) {
				const val = rec.fields[key];
				if (val === undefined || val === null) continue;
				const displayVal = Array.isArray(val) ? val.join(', ') : String(val);
				if (displayVal.trim()) parts.push(`${key}: ${displayVal}`);
			}
			meta.setText(parts.join('  ·  '));
		}
	}

	private renderDrilldownTable(
		el: HTMLElement, records: RawRecord[], col: CollectionConfig,
		dc: import('../types').DrilldownConfig, fields: string[]
	) {
		const tableWrap = el.createDiv('dash-drilldown-table-wrap');
		const table = tableWrap.createEl('table', { cls: 'dash-drilldown-table' });

		// Header
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: 'Title' });
		fields.forEach(f => headRow.createEl('th', { text: f }));

		// Body
		const tbody = table.createEl('tbody');
		for (const rec of records) {
			const row = tbody.createEl('tr');
			row.onclick = () => this.app.workspace.openLinkText(rec.filePath, '', true);
			row.addClass('dash-drilldown-table-row');
			row.createEl('td', { text: rec.title, cls: 'dash-drilldown-table-title' });
			for (const key of fields) {
				const val = rec.fields[key];
				const displayVal = val === undefined || val === null ? '—'
					: Array.isArray(val) ? val.join(', ')
					: String(val);
				row.createEl('td', { text: displayVal });
			}
		}
	}

	// ── Configure View Panel ──────────────────────────────────────────────────

	private buildConfigPanel(panel: HTMLElement, col: CollectionConfig, onChange: () => void) {
		panel.empty();
		const dc = col.drilldownConfig!;

		const heading = panel.createDiv('dash-config-panel-heading');
		heading.createSpan({ text: 'Configure View' });

		// Layout
		panel.createDiv({ text: 'Layout', cls: 'dash-config-label' });
		const layoutGroup = panel.createDiv('dash-config-pill-group');
		(['cards', 'table'] as const).forEach(l => {
			const icons: Record<string, string> = { cards: 'layout-grid', table: 'table' };
			const labels: Record<string, string> = { cards: 'Cards', table: 'Table' };
			const btn = layoutGroup.createEl('button', {
				cls: `dash-config-pill ${dc.layout === l ? 'active' : ''}`,
			});
			const iconEl = btn.createSpan({ cls: 'dash-config-pill-icon' });
			setIcon(iconEl, icons[l]);
			btn.createSpan({ text: labels[l] });
			btn.onclick = async () => {
				dc.layout = l;
				layoutGroup.querySelectorAll('.dash-config-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				// Show/hide sections based on layout
				imgSection.style.display = l === 'cards' ? '' : 'none';
				const cssSec = panel.querySelector('.dash-card-size-section') as HTMLElement;
				if (cssSec) cssSec.style.display = l === 'cards' ? '' : 'none';
				await this.saveQuiet(); onChange();
			};
		});

		// Card Size (only for cards)
		const cardSizeSection = panel.createDiv('dash-config-section dash-card-size-section');
		cardSizeSection.style.display = dc.layout === 'cards' ? '' : 'none';
		cardSizeSection.createDiv({ text: `Card Size`, cls: 'dash-config-label' });
		new SliderComponent(cardSizeSection)
			.setLimits(50, 800, 10)
			.setValue(dc.cardSize)
			.setDynamicTooltip()
			.setInstant(true)
			.onChange(async (val) => {
				dc.cardSize = val;
				await this.saveQuiet(); onChange();
			});

		// Image section (cards only)
		const imgSection = panel.createDiv('dash-config-section');
		imgSection.style.display = dc.layout === 'cards' ? '' : 'none';

		imgSection.createDiv({ text: 'Image Property', cls: 'dash-config-label' });

		// Custom dropdown (native <select> has OS-styled white dropdown we can't override)
		const imgOptions = [{ value: '', label: '— None —' }, ...col.schema.map(f => ({ value: f.key, label: f.key }))];
		const imgDropWrap = imgSection.createDiv('dash-custom-dropdown');
		const imgDropBtn = imgDropWrap.createDiv('dash-custom-dropdown-btn');
		const imgDropLabel = imgDropBtn.createSpan({ text: dc.imageField || '— None —', cls: 'dash-custom-dropdown-label' });
		const imgDropArrow = imgDropBtn.createSpan({ cls: 'dash-custom-dropdown-arrow' });
		setIcon(imgDropArrow, 'chevron-down');
		const imgDropList = imgDropWrap.createDiv('dash-custom-dropdown-list hidden');

		imgOptions.forEach(opt => {
			const item = imgDropList.createDiv({ cls: `dash-custom-dropdown-item${dc.imageField === opt.value || (!dc.imageField && opt.value === '') ? ' active' : ''}` });
			item.setText(opt.label);
			item.onclick = async (e) => {
				e.stopPropagation();
				dc.imageField = opt.value || undefined;
				imgDropLabel.setText(opt.value || '— None —');
				imgDropList.querySelectorAll('.dash-custom-dropdown-item').forEach(i => i.removeClass('active'));
				item.addClass('active');
				imgDropList.addClass('hidden');
				imgDropBtn.removeClass('open');
				imageFitSection.style.display = dc.imageField ? '' : 'none';
				aspectSection.style.display = dc.imageField ? '' : 'none';
				await this.saveQuiet(); onChange();
			};
		});

		imgDropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !imgDropList.hasClass('hidden');
			imgDropList.toggleClass('hidden', isOpen);
			imgDropBtn.toggleClass('open', !isOpen);
		};

		// Close when clicking outside
		activeDocument.addEventListener('click', () => { imgDropList.addClass('hidden'); imgDropBtn.removeClass('open'); }, { once: false });

		// Image Fit
		const imageFitSection = imgSection.createDiv('dash-config-section');
		imageFitSection.style.display = dc.imageField ? '' : 'none';
		imageFitSection.createDiv({ text: 'Image Fit', cls: 'dash-config-label' });
		const fitGroup = imageFitSection.createDiv('dash-config-pill-group');
		(['cover', 'contain'] as const).forEach(fit => {
			const btn = fitGroup.createEl('button', {
				text: fit === 'cover' ? 'Cover' : 'Contain',
				cls: `dash-config-pill ${dc.imageFit === fit ? 'active' : ''}`,
			});
			btn.onclick = async () => {
				dc.imageFit = fit;
				fitGroup.querySelectorAll('.dash-config-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				await this.saveQuiet(); onChange();
			};
		});

		// Image Aspect Ratio
		const aspectSection = imgSection.createDiv('dash-config-section');
		aspectSection.style.display = dc.imageField ? '' : 'none';
		aspectSection.createDiv({ text: `Image Aspect Ratio`, cls: 'dash-config-label' });
		new SliderComponent(aspectSection)
			.setLimits(0.25, 2.50, 0.05)
			.setValue(dc.imageAspectRatio)
			.setDynamicTooltip()
			.setInstant(true)
			.onChange(async (val) => {
				dc.imageAspectRatio = val;
				await this.saveQuiet(); onChange();
			});

		// Fields
		panel.createDiv({ text: 'Fields to Show', cls: 'dash-config-label' });
		panel.createDiv({ text: 'None selected = only title shown', cls: 'dash-config-sublabel' });
		const fieldsWrap = panel.createDiv('dash-config-fields');
		col.schema.forEach(f => {
			const row = fieldsWrap.createDiv('dash-config-field-row');
			const cb = row.createEl('input', { type: 'checkbox', cls: 'dash-config-cb' });
			cb.checked = dc.fields.includes(f.key);
			row.createSpan({ text: `${f.key}`, cls: 'dash-config-field-label' });
			row.createSpan({ text: f.type, cls: 'dash-config-field-type' });
			cb.onchange = async () => {
				if (cb.checked) { if (!dc.fields.includes(f.key)) dc.fields.push(f.key); }
				else { dc.fields = dc.fields.filter(k => k !== f.key); }
				await this.saveQuiet(); onChange();
			};
		});
	}

	// ── Image Resolution ──────────────────────────────────────────────────────

	private resolveImageSrc(raw: string): string | null {
		const s = raw.trim();
		// HTTP/HTTPS URL
		if (/^https?:\/\//i.test(s)) return s;

		const wikiMatch = s.match(/^\[\[(.*?)(?:\]\]|\|)/);
		if (wikiMatch) {
			const innerPath = wikiMatch[1].trim();
			if (/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(innerPath)) {
				// Try exact path first, then search by basename
				let file = this.app.vault.getAbstractFileByPath(innerPath);
				if (!file) {
					const basename = innerPath.split('/').pop() ?? innerPath;
					file = this.app.vault.getFiles().find(f => f.name === basename || f.path.endsWith('/' + basename)) ?? null;
				}
				if (file instanceof TFile) {
					return this.app.vault.getResourcePath(file);
				}
			}
		}

		// Bare path ending in image extension
		if (/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(s)) {
			let file = this.app.vault.getAbstractFileByPath(s);
			if (!file) {
				const basename = s.split('/').pop() ?? s;
				file = this.app.vault.getFiles().find(f => f.name === basename || f.path.endsWith('/' + basename)) ?? null;
			}
			if (file instanceof TFile) return this.app.vault.getResourcePath(file);
		}

		return null;
	}

	// ── Drag Events ───────────────────────────────────────────────────────────

	private attachDragEvents(card: HTMLElement, widgetId: string, col: CollectionConfig): void {
		let dragSrcId: string | null = null;

		card.addEventListener('dragstart', (e) => {
			dragSrcId = widgetId;
			card.addClass('dash-dragging');
			e.dataTransfer?.setData('text/plain', widgetId);
		});
		card.addEventListener('dragend', () => {
			dragSrcId = null;
			card.removeClass('dash-dragging');
			activeDocument.querySelectorAll('.dash-drag-over').forEach(el => el.removeClass('dash-drag-over'));
		});
		card.addEventListener('dragover', (e) => {
			e.preventDefault();
			const srcId = e.dataTransfer?.getData('text/plain') ?? dragSrcId;
			if (srcId && srcId !== widgetId) card.addClass('dash-drag-over');
		});
		card.addEventListener('dragleave', () => card.removeClass('dash-drag-over'));
		card.addEventListener('drop', (e) => {
			e.preventDefault();
			card.removeClass('dash-drag-over');
			const srcId = e.dataTransfer?.getData('text/plain');
			if (!srcId || srcId === widgetId) return;

			let activeWidgets = this.getActiveWidgets(col);
			const widgets  = [...activeWidgets];
			const fromIdx  = widgets.findIndex(w => w.id === srcId);
			const toIdx    = widgets.findIndex(w => w.id === widgetId);
			if (fromIdx === -1 || toIdx === -1) return;

			const [item] = widgets.splice(fromIdx, 1);
			widgets.splice(toIdx, 0, item);
			this.setActiveWidgets(col, widgets);
			void this.saveQuiet().then(() => {
				// Move visually without re-render
				const grid = card.parentElement;
				if (grid) {
					const draggedEl = grid.querySelector(`[data-widget-id="${srcId}"]`) as HTMLElement;
					if (draggedEl) {
						if (fromIdx < toIdx) {
							card.after(draggedEl);
						} else {
							card.before(draggedEl);
						}
					}
				}
			});
		});
	}

	/** Moves a widget card up or down in the layout array (essential for mobile/tablet reordering) */
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
			let activeWidgets = this.getActiveWidgets(col);
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

// ─── Pin Edit Modal ────────────────────────────────────────────────────────────

class PinEditModal extends Modal {
	private cfg: { size: WidgetSize };
	private onSave: (updated: { size: WidgetSize }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize }, onSave: (updated: { size: WidgetSize }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size) };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modal');
		contentEl.createDiv({ text: 'Pinned Widget Display', cls: 'dash-modal-title' });
		contentEl.createDiv({ text: 'Use the drag handle on the right or bottom edge of the widget to resize it. This only affects how the widget appears in the Overview.', cls: 'dash-modal-section-label' });
		const footer = contentEl.createDiv('dash-modal-footer');
		footer.createEl('button', { text: 'Close', cls: 'dash-modal-cancel' }).onclick = () => this.close();
	}
}

// ─── Breakdown Edit Modal ──────────────────────────────────────────────────────

class BreakdownEditModal extends Modal {
	private cfg: { size: WidgetSize; chartType: ChartType };
	private onSave: (updated: { size: WidgetSize; chartType: ChartType }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize; chartType: ChartType }, onSave: (updated: { size: WidgetSize; chartType: ChartType }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size), chartType: cfg.chartType };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modal');
		contentEl.createDiv({ text: 'Media Breakdown Settings', cls: 'dash-modal-title' });

		// ── Chart type pills ──────────────────────────────────────────────────
		const ctWrap = contentEl.createDiv('dash-modal-section');
		ctWrap.createDiv({ text: 'Chart Type', cls: 'dash-modal-section-label' });
		const ctGroup = ctWrap.createDiv('dash-modal-pill-group');
		const types: [ChartType, string][] = [
			['doughnut', 'Doughnut'], ['pie', 'Pie'],
			['bar-vertical', 'Bar (V)'], ['bar-horizontal', 'Bar (H)'],
		];
		types.forEach(([val, label]) => {
			const btn = ctGroup.createEl('button', {
				text: label, cls: `dash-modal-pill ${this.cfg.chartType === val ? 'active' : ''}`,
			});
			btn.onclick = () => {
				ctGroup.querySelectorAll('.dash-modal-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				this.cfg.chartType = val;
			};
		});

		// ── Footer ────────────────────────────────────────────────────────────
		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', { text: 'Save Changes', cls: 'dash-modal-save mod-cta' });
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' }).onclick = () => this.close();
		saveBtn.onclick = () => { void this.onSave(this.cfg); this.close(); };
	}
}

class TotalItemsEditModal extends Modal {
	private cfg: { size: WidgetSize; icon?: string };
	private onSave: (updated: { size: WidgetSize; icon?: string }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize; icon?: string }, onSave: (updated: { size: WidgetSize; icon?: string }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size), icon: cfg.icon };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modal');
		contentEl.createDiv({ text: 'Total Items Settings', cls: 'dash-modal-title' });

		// ── Custom Icon ───────────────────────────────────────────────────────
		const iconWrap = contentEl.createDiv('dash-modal-section');
		iconWrap.createDiv({ text: 'Custom Icon', cls: 'dash-modal-section-label' });
		
		const iconGrid = iconWrap.createDiv('dash-icon-picker-grid');
		const defaultIcons = ['hash', 'library', 'book', 'film', 'gamepad-2', 'music', 'tv', 'archive', 'box'];
		let selectedIcon = this.cfg.icon ?? 'library';

		defaultIcons.forEach(ic => {
			const btn = iconGrid.createEl('button', { cls: `dash-icon-picker-btn ${selectedIcon === ic ? 'active' : ''}`, attr: { 'aria-label': ic } });
			setIcon(btn, ic);
			btn.onclick = () => {
				selectedIcon = ic;
				iconGrid.querySelectorAll('.dash-icon-picker-btn').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				customIconInput.value = '';
			};
		});

		const customIconInput = iconWrap.createEl('input', {
			cls: 'dash-icon-picker-custom-input',
			attr: { placeholder: 'e.g. lucide icon name', value: defaultIcons.includes(selectedIcon) ? '' : selectedIcon },
		});
		customIconInput.oninput = () => {
			const val = customIconInput.value.trim();
			if (val) {
				selectedIcon = val;
				iconGrid.querySelectorAll('.dash-icon-picker-btn').forEach(b => b.removeClass('active'));
			}
		};

		// ── Footer ────────────────────────────────────────────────────────────
		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', { text: 'Save Changes', cls: 'dash-modal-save mod-cta' });
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' }).onclick = () => this.close();
		saveBtn.onclick = () => {
			this.cfg.icon = selectedIcon;
			void this.onSave(this.cfg);
			this.close();
		};
	}
}
