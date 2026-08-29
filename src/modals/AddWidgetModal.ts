import { Modal, App, Notice, setIcon } from 'obsidian';
import type { CollectionConfig, WidgetConfig, WidgetType, ChartType, AggregationType, WidgetSize } from '../types';
import { migrateSize } from '../types';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../utils/ColorUtils';

export class AddWidgetModal extends Modal {
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

	onOpen(): void {
		this.modalEl.addClass('dash-modal-dialog');
		const isDark = activeDocument?.body?.classList.contains('theme-light') ? false : true;
		const colFg = getAdaptiveForeground(this.collection.color || '#818cf8', isDark);
		const colRgb = hexToRgbString(colFg);
		const contrastText = getContrastTextColor(colFg);

		this.modalEl.style.setProperty('--collection-color', this.collection.color || '#818cf8');
		this.modalEl.style.setProperty('--col-fg', colFg);
		this.modalEl.style.setProperty('--col-rgb', colRgb);
		this.modalEl.style.setProperty('--col-contrast', contrastText);

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const e = this.editing;

		// Modal Header
		const headerWrap = contentEl.createDiv('dash-modal-header-wrap');
		const titleRow = headerWrap.createDiv({ cls: 'dash-modal-title-row' });
		const dot = titleRow.createDiv({ cls: 'dash-modal-color-dot' });
		dot.style.setProperty('background-color', colFg);
		dot.style.setProperty('box-shadow', `0 0 10px ${colFg}`);
		titleRow.createDiv({ text: e ? 'Edit Widget' : 'Add Widget', cls: 'dash-modal-title' });
		
		headerWrap.createDiv({
			text: `Configure data visualization for ${this.collection.name}`,
			cls: 'dash-modal-subtitle'
		});

		// ── Widget Type Visual Selector ──────────────────────────
		this.buildSectionLabel(contentEl, 'Widget Type', 'Choose how you want your data to be displayed');
		const typeGrid = contentEl.createDiv('dash-modal-type-grid');
		let widgetType: WidgetType = e?.type ?? 'distribution';

		const typeEntries: [WidgetType, string, string, string][] = [
			['distribution', 'Distribution', 'pie-chart', 'Categorical breakdowns (Pie, Donut, Bar)'],
			['number-card', 'Number Card', 'hash', 'Single KPI summary (Count, Sum, Avg, Formula)'],
			['ranking', 'Ranking', 'trophy', 'Top records sorted by numeric property'],
			['activity', 'Activity', 'calendar', 'Monthly, weekly, or yearly time-series'],
			['heatmap', 'Heatmap', 'grid', 'GitHub-style 52-week activity calendar matrix'],
			['boolean', 'Boolean', 'check-circle', 'Binary true/false status distribution'],
		];

		typeEntries.forEach(([val, label, iconName, desc]) => {
			const card = typeGrid.createDiv({
				cls: `dash-modal-type-card ${widgetType === val ? 'active' : ''}`
			});
			const iconEl = card.createDiv('dash-modal-type-icon');
			setIcon(iconEl, iconName);
			const info = card.createDiv('dash-modal-type-info');
			info.createDiv({ text: label, cls: 'dash-modal-type-label' });
			info.createDiv({ text: desc, cls: 'dash-modal-type-desc' });

			card.onclick = () => {
				typeGrid.querySelectorAll('.dash-modal-type-card').forEach(c => c.removeClass('active'));
				card.addClass('active');
				widgetType = val;
				refreshConditional();
			};
		});

		// ── Field Picker ──────────────────────────────────────────
		this.buildSectionLabel(contentEl, 'Target Property Field', 'Frontmatter property to aggregate');
		let field = e?.field ?? '';
		const fieldPickerWrap = contentEl.createDiv('dash-field-picker');
		
		const fieldHeader = fieldPickerWrap.createDiv('dash-field-header');
		const fieldSelectedText = fieldHeader.createSpan({ text: field || 'Select a field…', cls: 'dash-field-selected-text' });
		const chevron = fieldHeader.createSpan({ cls: 'dash-field-chevron' });
		setIcon(chevron, 'chevron-down');

		const fieldDropdown = fieldPickerWrap.createDiv('dash-field-dropdown dash-hidden');
		const fieldSearch = fieldDropdown.createEl('input', {
			cls: 'dash-field-search',
			placeholder: 'Search fields in collection…',
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
				if (widgetType === 'activity' || widgetType === 'heatmap') return s.type === 'date';
				if (widgetType === 'boolean') return s.type === 'boolean';
				return s.type === 'text' || s.type === 'array' || s.type === 'boolean';
			});
			const q = fieldSearch.value.toLowerCase();
			const shown = q ? compatible.filter(s => s.key.toLowerCase().includes(q)) : compatible;
			if (!shown.length) {
				fieldListEl.createDiv({ text: 'No compatible fields found for this widget type', cls: 'dash-field-empty' });
				return;
			}
			if (!shown.find(s => s.key === field)) {
				field = shown[0].key;
				fieldSelectedText.setText(field);
			} else {
				fieldSelectedText.setText(field);
			}
			shown.forEach(s => {
				const item = fieldListEl.createDiv({ cls: `dash-field-item${field === s.key ? ' active' : ''}` });
				item.createSpan({ text: s.key, cls: 'dash-field-key' });
				item.createSpan({ text: `${Math.round(s.coverage * 100)}% coverage`, cls: 'dash-field-pct' });
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

		const closeOutside = (ev: MouseEvent) => {
			if (!fieldPickerWrap.contains(ev.target as Node)) {
				toggleDropdown(false);
			}
		};
		activeDocument.addEventListener('click', closeOutside);
		const origClose = this.close.bind(this);
		this.close = () => {
			activeDocument.removeEventListener('click', closeOutside);
			origClose();
		};

		// ── Chart Type Segmented Pills ───────────────────────────
		const chartWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(chartWrap, 'Chart Display Type');
		let chartType: ChartType = e?.chartType ?? (widgetType === 'ranking' ? 'list' : 'doughnut');
		const chartGroup = chartWrap.createDiv('dash-modal-pill-group');
		const chartEntries: [ChartType, string][] = [
			['doughnut', 'Donut'],
			['pie', 'Pie'],
			['bar-horizontal', 'Bar H'],
			['bar-vertical', 'Bar V'],
			['line', 'Line'],
			['radar', 'Radar'],
			['list', 'List'],
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

		// ── Aggregation Pills ────────────────────────────────────
		const aggWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(aggWrap, 'Aggregation Method');
		let aggregation: AggregationType = e?.aggregation ?? 'count';
		const aggGroup = aggWrap.createDiv('dash-modal-pill-group');
		const aggEntries: [AggregationType, string][] = [
			['count', 'Count'],
			['sum', 'Sum'],
			['average', 'Average'],
			['min', 'Min'],
			['max', 'Max'],
			['formula', 'Formula'],
		];
		
		const formulaWrap = contentEl.createDiv('dash-modal-inputs-row');
		formulaWrap.style.setProperty('display', aggregation === 'formula' ? 'flex' : 'none');
		const fMathWrap = formulaWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fMathWrap.createDiv({ text: 'Math Expression (e.g. episode * duration / 60)', cls: 'dash-modal-input-label' });
		const mathExpressionInput = fMathWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. episode * duration',
			value: e?.mathExpression ?? '',
		});

		const helperContainer = fMathWrap.createDiv('dash-formula-helper');
		helperContainer.createSpan({ text: 'Insert variable: ', cls: 'dash-formula-helper-label' });
		const numericFields = this.collection.schema.filter(s => s.type === 'number');
		if (numericFields.length === 0) {
			helperContainer.createSpan({ text: 'No numeric fields discovered in schema.', cls: 'dash-formula-helper-empty' });
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
				formulaWrap.style.setProperty('display', aggregation === 'formula' ? 'flex' : 'none');
			};
		});

		// ── Heatmap Intensity Field (Heatmap only) ────────────────
		const heatmapWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(heatmapWrap, 'Heatmap Value Weight (Optional)', 'Leave blank to count 1 per note');
		const heatRow = heatmapWrap.createDiv('dash-modal-inputs-row');
		const heatFieldWrap = heatRow.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		heatFieldWrap.createDiv({ text: 'Numeric Field for Cell Intensity', cls: 'dash-modal-input-label' });
		const heatIntensityInput = heatFieldWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. pages, minutes, duration',
			value: e?.heatmapIntensityField ?? '',
		});

		// ── Pre-filter ────────────────────────────────────────────
		const preFilterWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(preFilterWrap, 'Pre-filter (Optional)', 'Filter notes before calculating widget stats');
		const filterWrap = preFilterWrap.createDiv('dash-modal-inputs-row');
		
		const fFieldWrap = filterWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fFieldWrap.createDiv({ text: 'Filter Property', cls: 'dash-modal-input-label' });
		const filterFieldInput = fFieldWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g., status',
			value: e?.filterField ?? '',
		});

		const fValWrap = filterWrap.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		fValWrap.createDiv({ text: 'Required Value', cls: 'dash-modal-input-label' });
		const filterValueInput = fValWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g., completed / true',
			value: e?.filterValue ?? '',
		});

		// ── Boolean Labels ────────────────────────────────────────
		const booleanLabelsWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(booleanLabelsWrap, 'Custom Boolean Display Labels');
		const bLabelsRow = booleanLabelsWrap.createDiv('dash-modal-inputs-row');

		const trueLabelWrap = bLabelsRow.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		trueLabelWrap.createDiv({ text: 'True Label', cls: 'dash-modal-input-label' });
		const trueLabelInput = trueLabelWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. Watched / Finished',
			value: e?.trueLabel ?? '',
		});

		const falseLabelWrap = bLabelsRow.createDiv('dash-modal-input-group dash-modal-input-group--wide');
		falseLabelWrap.createDiv({ text: 'False Label', cls: 'dash-modal-input-label' });
		const falseLabelInput = falseLabelWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'e.g. Unwatched / Pending',
			value: e?.falseLabel ?? '',
		});

		// ── Legend Position ───────────────────────────────────────
		const legendWrap = contentEl.createDiv('dash-modal-section');
		this.buildSectionLabel(legendWrap, 'Chart Legend Position');
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

		// ── Title & Limit Grid ────────────────────────────────────
		const inputsWrap = contentEl.createDiv('dash-modal-inputs-grid');

		const lWrap = inputsWrap.createDiv('dash-modal-input-group');
		lWrap.createDiv({ text: 'Top N Limit', cls: 'dash-modal-input-label' });
		let topN = e?.topN ?? 12;
		const topNInput = lWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			type: 'text',
			value: String(topN),
		});
		topNInput.onchange = () => { topN = parseInt(topNInput.value) || 12; };

		const tWrap = inputsWrap.createDiv('dash-modal-input-group');
		tWrap.createDiv({ text: 'Custom Title (Optional)', cls: 'dash-modal-input-label' });
		const titleInput = tWrap.createEl('input', {
			cls: 'dash-modal-input-styled',
			placeholder: 'Auto-filled from field name',
			value: e?.title ?? '',
		});

		// ── Icon Picker (Number Card only) ────────────────────────
		const ICON_OPTIONS = [
			'hash', 'clock', 'star', 'film', 'tv', 'book', 'book-open',
			'gamepad-2', 'trophy', 'library', 'layers', 'trending-up',
			'activity', 'calendar', 'heart', 'zap', 'target', 'award',
			'headphones', 'music', 'camera', 'image', 'package', 'box',
		];
		let selectedIcon: string = e?.icon ?? 'hash';

		const iconPickerWrap = contentEl.createDiv('dash-modal-section dash-icon-picker-wrap');
		this.buildSectionLabel(iconPickerWrap, 'Card Icon');

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

		const customRow = iconPickerWrap.createDiv('dash-icon-picker-custom-row');
		customRow.createSpan({ text: 'Custom Lucide Icon:', cls: 'dash-icon-picker-custom-label' });
		const customIconInput = customRow.createEl('input', {
			cls: 'dash-icon-picker-custom-input',
			attr: { placeholder: 'e.g. flame, cpu, compass…', value: selectedIcon },
		});
		customIconInput.oninput = () => {
			const val = customIconInput.value.trim();
			if (val) {
				selectedIcon = val;
				iconGrid.querySelectorAll('.dash-icon-picker-btn').forEach(b => {
					b.toggleClass('active', (b as HTMLElement).getAttribute('aria-label') === val);
				});
			}
		};

		// ── Visibility Logic ──────────────────────────────────────
		const refreshConditional = () => {
			renderFieldList();
			const isChartType = widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking';
			chartWrap.style.setProperty('display', isChartType ? '' : 'none');
			aggWrap.style.setProperty('display', (widgetType === 'number-card' || widgetType === 'ranking') ? '' : 'none');
			heatmapWrap.style.setProperty('display', widgetType === 'heatmap' ? '' : 'none');
			legendWrap.style.setProperty('display', isChartType ? '' : 'none');
			preFilterWrap.style.setProperty('display', (widgetType === 'activity' || widgetType === 'heatmap') ? 'none' : '');
			booleanLabelsWrap.style.setProperty('display', widgetType === 'boolean' ? '' : 'none');
			const showTopN = widgetType === 'distribution' || widgetType === 'ranking';
			lWrap.style.setProperty('display', showTopN ? '' : 'none');
			tWrap.toggleClass('dash-modal-inputs-grid-wide', !showTopN);
			iconPickerWrap.style.setProperty('display', widgetType === 'number-card' ? '' : 'none');
		};

		refreshConditional();

		// ── Footer ────────────────────────────────────────────────
		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', {
			text: e ? 'Save Changes' : 'Add Widget',
			cls: 'dash-modal-save mod-cta',
		});
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' })
			.onclick = () => this.close();

		saveBtn.onclick = () => {
			const f = field;
			if (!f) {
				new Notice('Please select a target property field.');
				return;
			}

			const cfg: WidgetConfig = {
				id: e?.id ?? uid(),
				type: widgetType,
				title: titleInput.value.trim() || f,
				field: f,
				filterField: filterFieldInput.value.trim() || undefined,
				filterValue: filterValueInput.value.trim() || undefined,
				aggregation: (widgetType === 'number-card' || widgetType === 'ranking') ? aggregation : undefined,
				mathExpression: ((widgetType === 'number-card' || widgetType === 'ranking') && aggregation === 'formula') ? mathExpressionInput.value.trim() : undefined,
				chartType: (widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking') ? chartType : undefined,
				legendPosition: (widgetType === 'distribution' || widgetType === 'boolean' || widgetType === 'activity' || widgetType === 'ranking') ? legendPosition : undefined,
				heatmapIntensityField: widgetType === 'heatmap' ? heatIntensityInput.value.trim() || undefined : undefined,
				size: e ? migrateSize(e.size) : { height: widgetType === 'heatmap' ? 'small' : 'small', span: widgetType === 'heatmap' ? 12 : 6 },
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

	onClose(): void {
		this.contentEl.empty();
	}

	private buildSectionLabel(parent: HTMLElement, text: string, subtitle?: string): void {
		const wrap = parent.createDiv('dash-modal-section-label-wrap');
		wrap.createDiv({ text, cls: 'dash-modal-section-label' });
		if (subtitle) {
			wrap.createDiv({ text: subtitle, cls: 'dash-modal-section-desc' });
		}
	}
}

function uid(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
