import { Modal, App, setIcon } from 'obsidian';
import type { OverviewItem, WidgetSize, ChartType } from '../types';
import { migrateSize } from '../types';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../utils/ColorUtils';

function applyOverviewModalTheme(modalEl: HTMLElement) {
	const baseColor = '#f97316';
	const isDark = !(typeof activeDocument !== 'undefined' && activeDocument.body ? activeDocument.body : document.body).classList.contains('theme-light');
	const colFg = getAdaptiveForeground(baseColor, isDark);
	const colRgb = hexToRgbString(colFg);
	const colContrast = getContrastTextColor(colFg);

	modalEl.style.setProperty('--collection-color', baseColor);
	modalEl.style.setProperty('--col-fg', colFg);
	modalEl.style.setProperty('--col-rgb', colRgb);
	modalEl.style.setProperty('--col-contrast', colContrast);
	return { colFg };
}

export class AddOverviewWidgetModal extends Modal {
	private onSave: (type: 'breakdown' | 'total-items') => void | Promise<void>;
	private existingLayout: OverviewItem[];

	constructor(app: App, existingLayout: OverviewItem[], onSave: (type: 'breakdown' | 'total-items') => void | Promise<void>) {
		super(app);
		this.existingLayout = existingLayout || [];
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass('dash-modal-dialog');
		const { colFg } = applyOverviewModalTheme(this.modalEl);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const header = contentEl.createDiv('dash-modal-header-wrap');
		const titleRow = header.createDiv('dash-modal-title-row');
		const dot = titleRow.createDiv('dash-modal-color-dot');
		dot.style.background = colFg;
		titleRow.createDiv({ text: 'Add Global Overview Widget', cls: 'dash-modal-title' });
		header.createDiv({ text: 'Choose a global aggregation widget to add to your overview dashboard.', cls: 'dash-modal-subtitle' });

		const existingTypes = new Set(this.existingLayout.map(i => i.type));
		const typeEntries: ['total-items' | 'breakdown', string, string, string][] = [];
		if (!existingTypes.has('total-items')) {
			typeEntries.push(['total-items', 'Total Items Counter', 'Total items count across all collections with custom icon.', 'hash']);
		}
		if (!existingTypes.has('breakdown')) {
			typeEntries.push(['breakdown', 'Media Breakdown Chart', 'Visual distribution chart of items across all media collections.', 'pie-chart']);
		}

		if (typeEntries.length === 0) {
			contentEl.createDiv({ text: 'All global overview widgets are already added.', cls: 'dash-modal-section-label' });
			const footer = contentEl.createDiv('dash-modal-footer');
			footer.createEl('button', { text: 'Close', cls: 'dash-modal-cancel' }).onclick = () => this.close();
			return;
		}

		let widgetType: 'breakdown' | 'total-items' = typeEntries[0][0];
		const sec = contentEl.createDiv('dash-modal-section');
		sec.createDiv({ text: 'Select Widget Type', cls: 'dash-modal-section-label' });
		
		const grid = sec.createDiv('dash-modal-type-grid');
		typeEntries.forEach(([val, label, desc, iconName]) => {
			const card = grid.createDiv(`dash-modal-type-card ${widgetType === val ? 'active' : ''}`);
			const iconWrap = card.createDiv('dash-modal-type-icon');
			setIcon(iconWrap, iconName);
			const info = card.createDiv('dash-modal-type-info');
			info.createDiv({ text: label, cls: 'dash-modal-type-label' });
			info.createDiv({ text: desc, cls: 'dash-modal-type-desc' });

			card.onclick = () => {
				grid.querySelectorAll('.dash-modal-type-card').forEach(c => c.removeClass('active'));
				card.addClass('active');
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

	onClose(): void {
		this.contentEl.empty();
	}
}

export class BreakdownEditModal extends Modal {
	private cfg: { size: WidgetSize; chartType: ChartType };
	private onSave: (updated: { size: WidgetSize; chartType: ChartType }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize; chartType: ChartType }, onSave: (updated: { size: WidgetSize; chartType: ChartType }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size), chartType: cfg.chartType };
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass('dash-modal-dialog');
		const { colFg } = applyOverviewModalTheme(this.modalEl);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const header = contentEl.createDiv('dash-modal-header-wrap');
		const titleRow = header.createDiv('dash-modal-title-row');
		const dot = titleRow.createDiv('dash-modal-color-dot');
		dot.style.background = colFg;
		titleRow.createDiv({ text: 'Media Breakdown Settings', cls: 'dash-modal-title' });
		header.createDiv({ text: 'Configure chart representation for total items breakdown.', cls: 'dash-modal-subtitle' });

		const ctWrap = contentEl.createDiv('dash-modal-section');
		ctWrap.createDiv({ text: 'Chart Type', cls: 'dash-modal-section-label' });
		const ctGroup = ctWrap.createDiv('dash-modal-pill-group');
		const types: [ChartType, string][] = [
			['doughnut', 'Doughnut'], ['pie', 'Pie'],
			['bar-vertical', 'Bar (Vertical)'], ['bar-horizontal', 'Bar (Horizontal)'],
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

		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', { text: 'Save Changes', cls: 'dash-modal-save mod-cta' });
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' }).onclick = () => this.close();
		saveBtn.onclick = () => {
			void this.onSave(this.cfg);
			this.close();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class TotalItemsEditModal extends Modal {
	private cfg: { size: WidgetSize; icon?: string };
	private onSave: (updated: { size: WidgetSize; icon?: string }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize; icon?: string }, onSave: (updated: { size: WidgetSize; icon?: string }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size), icon: cfg.icon };
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass('dash-modal-dialog');
		const { colFg } = applyOverviewModalTheme(this.modalEl);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const header = contentEl.createDiv('dash-modal-header-wrap');
		const titleRow = header.createDiv('dash-modal-title-row');
		const dot = titleRow.createDiv('dash-modal-color-dot');
		dot.style.background = colFg;
		titleRow.createDiv({ text: 'Total Items Settings', cls: 'dash-modal-title' });
		header.createDiv({ text: 'Select an icon to display on the global Total Items card.', cls: 'dash-modal-subtitle' });

		const iconWrap = contentEl.createDiv('dash-icon-picker-wrap');
		iconWrap.createDiv({ text: 'Choose Display Icon', cls: 'dash-modal-section-label' });
		
		const iconBox = iconWrap.createDiv('dash-icon-picker-box');
		const iconGrid = iconBox.createDiv('dash-icon-picker-grid');
		const defaultIcons = ['hash', 'library', 'book', 'film', 'gamepad-2', 'music', 'tv', 'archive', 'box', 'layers', 'database', 'sparkles'];
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

		const customRow = iconWrap.createDiv('dash-icon-picker-custom-row');
		customRow.createSpan({ text: 'Custom Icon:', cls: 'dash-icon-picker-custom-label' });
		const customIconInput = customRow.createEl('input', {
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

		const footer = contentEl.createDiv('dash-modal-footer');
		const saveBtn = footer.createEl('button', { text: 'Save Changes', cls: 'dash-modal-save mod-cta' });
		footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' }).onclick = () => this.close();
		saveBtn.onclick = () => {
			this.cfg.icon = selectedIcon;
			void this.onSave(this.cfg);
			this.close();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PinEditModal extends Modal {
	private cfg: { size: WidgetSize };
	private onSave: (updated: { size: WidgetSize }) => void | Promise<void>;

	constructor(app: App, cfg: { size: WidgetSize }, onSave: (updated: { size: WidgetSize }) => void | Promise<void>) {
		super(app);
		this.cfg = { size: migrateSize(cfg.size) };
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass('dash-modal-dialog');
		const { colFg } = applyOverviewModalTheme(this.modalEl);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const header = contentEl.createDiv('dash-modal-header-wrap');
		const titleRow = header.createDiv('dash-modal-title-row');
		const dot = titleRow.createDiv('dash-modal-color-dot');
		dot.style.background = colFg;
		titleRow.createDiv({ text: 'Pinned Widget Display', cls: 'dash-modal-title' });
		header.createDiv({ text: 'Resize pinned widget directly on the dashboard.', cls: 'dash-modal-subtitle' });

		contentEl.createDiv({ text: 'Use the drag handle on the right or bottom edge of the widget card to resize it. This only affects its appearance in the Overview.', cls: 'dash-modal-section-desc' });
		const footer = contentEl.createDiv('dash-modal-footer');
		footer.createEl('button', { text: 'Close', cls: 'dash-modal-cancel' }).onclick = () => this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
