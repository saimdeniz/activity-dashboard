import { Modal, App, setIcon, Notice } from 'obsidian';
import type { CollectionConfig } from '../types';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../utils/ColorUtils';

export class NoteDetailCustomizeModal extends Modal {
	private selectedHighlights: string[];
	private selectedStatusField: string;
	private statusOptionsText: string;
	private selectedLinksPosition: 'cover' | 'topbar';
	private selectedRatingScale: 'auto' | '5' | '10' | '100' | 'none';

	constructor(
		app: App,
		private col: CollectionConfig,
		private onSave: () => Promise<void> | void,
		private onRefresh?: () => void
	) {
		super(app);
		const cfg = col.noteDetailConfig || {};
		this.selectedHighlights = cfg.highlightFields ? [...cfg.highlightFields] : [];
		this.selectedStatusField = cfg.statusField ?? '';
		this.statusOptionsText = cfg.statusOptions ? cfg.statusOptions.join(', ') : '';
		this.selectedLinksPosition = cfg.linksPosition ?? 'cover';
		this.selectedRatingScale = (cfg.ratingScale as 'auto' | '5' | '10' | '100' | 'none') ?? 'auto';
	}

	onOpen(): void {
		this.containerEl.setCssStyles({ zIndex: '3600' });
		this.modalEl.addClass('dash-modal-dialog', 'dash-note-customize-dialog');

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-note-customize-modal');

		const baseColor = this.col.color || '#818cf8';
		const isDark = !document.body.classList.contains('theme-light');
		const colFg = getAdaptiveForeground(baseColor, isDark);
		const colRgb = hexToRgbString(colFg);
		const colContrast = getContrastTextColor(colFg);

		this.modalEl.setCssProps({
			'--collection-color': baseColor,
			'--col-fg': colFg,
			'--col-rgb': colRgb,
			'--col-contrast': colContrast,
		});

		// ── Header ────────────────────────────────────────────────
		const header = contentEl.createDiv('ndm-cust-header');
		const headerLeft = header.createDiv('ndm-cust-header-left');
		const iconEl = headerLeft.createSpan('ndm-cust-icon');
		setIcon(iconEl, this.col.icon || 'sliders-horizontal');
		headerLeft.createEl('h2', { text: `Customize "${this.col.name}" Detail View`, cls: 'ndm-cust-title' });

		const headerDesc = contentEl.createDiv('ndm-cust-desc');
		headerDesc.setText('Configure status buttons, highlights, and external link positions.');

		// ── Body ──────────────────────────────────────────────────
		const body = contentEl.createDiv('ndm-cust-body');

		// ── Section 1: Quick Status Buttons ───────────────────────
		const sec1 = body.createDiv('ndm-cust-section');
		const sec1Header = sec1.createDiv('ndm-cust-sec-title');
		setIcon(sec1Header.createSpan('ndm-cust-sec-icon'), 'toggle-left');
		sec1Header.createSpan({ text: 'Quick Status Buttons' });

		sec1.createDiv({
			text: 'Frontmatter property for toggle buttons (e.g. ownership, readStatus).',
			cls: 'ndm-cust-sec-desc'
		});

		const fieldRow = sec1.createDiv('ndm-cust-input-row');
		fieldRow.createSpan({ text: 'Property:', cls: 'ndm-cust-label' });

		// Custom dropdown for status property
		const dropWrap = fieldRow.createDiv('dash-custom-dropdown ndm-cust-dropdown');
		const dropBtn = dropWrap.createDiv('dash-custom-dropdown-btn');
		
		let initialLabel = '— Auto Detect —';
		if (this.selectedStatusField === '__none__') initialLabel = '— Disabled (None) —';
		else if (this.selectedStatusField) initialLabel = this.selectedStatusField;

		const dropLabel = dropBtn.createSpan({ text: initialLabel, cls: 'dash-custom-dropdown-label' });
		const dropArrow = dropBtn.createSpan({ cls: 'dash-custom-dropdown-arrow' });
		setIcon(dropArrow, 'chevron-down');
		const dropList = dropWrap.createDiv('dash-custom-dropdown-list hidden');

		const statusFieldOptions = [
			{ value: '', label: '— Auto Detect —' },
			{ value: '__none__', label: '— Disabled (None) —' },
			...this.col.schema.map(f => ({ value: f.key, label: f.key }))
		];

		const optionsRow = sec1.createDiv('ndm-cust-input-row');
		const optionsLabelRow = optionsRow.createDiv('ndm-cust-counter-row');
		optionsLabelRow.createSpan({ text: 'Buttons:', cls: 'ndm-cust-label' });
		
		const clearButtonsBtn = optionsLabelRow.createEl('button', { cls: 'ndm-cust-reset-btn', text: 'Clear' });

		const optionsInput = optionsRow.createEl('input', {
			cls: 'ndm-cust-text-input',
			value: this.statusOptionsText,
			attr: { placeholder: 'e.g. Owned, Wishlist, Delisted, Emulator, Subscription' }
		});
		optionsInput.oninput = () => {
			this.statusOptionsText = optionsInput.value;
		};

		clearButtonsBtn.onclick = () => {
			this.statusOptionsText = '';
			optionsInput.value = '';
		};

		if (this.selectedStatusField === '__none__') {
			optionsRow.hide();
		}

		const updateOptionsInput = (fieldKey: string) => {
			if (!fieldKey || fieldKey === '__none__') {
				this.statusOptionsText = '';
				optionsInput.value = '';
				if (fieldKey === '__none__') optionsRow.hide();
				else optionsRow.show();
				return;
			}

			optionsRow.show();
			const found = this.col.schema.find(s => s.key.toLowerCase() === fieldKey.toLowerCase());
			let newOptions: string[] = [];

			if (found && found.sampleValues && found.sampleValues.length > 0) {
				const rawList: string[] = [];
				found.sampleValues.forEach(sv => {
					if (typeof sv === 'string' && (sv.includes(',') || sv.includes('|'))) {
						rawList.push(...sv.split(/[,|]/).map(p => p.trim()).filter(Boolean));
					} else if (sv && String(sv).trim().length > 0) {
						rawList.push(String(sv).trim());
					}
				});
				newOptions = Array.from(new Set(rawList));
			} else {
				if (/read/i.test(fieldKey)) newOptions = ['Read', 'Reading', 'Want to Read', 'DNF'];
				else if (/play/i.test(fieldKey)) newOptions = ['Playing', 'Completed', 'Backlog', 'Abandoned'];
				else if (/owner/i.test(fieldKey)) newOptions = ['Owned', 'Wishlist', 'Delisted', 'Emulator', 'Subscription'];
				else if (/prior/i.test(fieldKey)) newOptions = ['High', 'Medium', 'Low'];
			}

			this.statusOptionsText = newOptions.join(', ');
			optionsInput.value = this.statusOptionsText;
		};

		statusFieldOptions.forEach(opt => {
			const item = dropList.createDiv({
				cls: `dash-custom-dropdown-item ${this.selectedStatusField === opt.value ? 'active' : ''}`
			});
			item.setText(opt.label);
			item.onclick = (e) => {
				e.stopPropagation();
				this.selectedStatusField = opt.value;
				dropLabel.setText(opt.label);
				dropList.querySelectorAll('.dash-custom-dropdown-item').forEach(i => i.removeClass('active'));
				item.addClass('active');
				dropList.addClass('hidden');
				dropBtn.removeClass('open');
				updateOptionsInput(opt.value);
			};
		});

		dropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !dropList.hasClass('hidden');
			dropList.toggleClass('hidden', isOpen);
			dropBtn.toggleClass('open', !isOpen);
		};

		activeDocument.addEventListener('click', () => {
			dropList.addClass('hidden');
			dropBtn.removeClass('open');
		}, { once: true });

		// ── Section 2: Key Highlights (Max 8) ─────────────────────
		const sec2 = body.createDiv('ndm-cust-section');
		const sec2Header = sec2.createDiv('ndm-cust-sec-title');
		setIcon(sec2Header.createSpan('ndm-cust-sec-icon'), 'bookmark');
		sec2Header.createSpan({ text: 'Highlights Grid Properties' });

		const counterWrap = sec2.createDiv('ndm-cust-counter-row');
		const counterText = counterWrap.createSpan({
			text: `${this.selectedHighlights.length} / 8 properties selected`,
			cls: `ndm-cust-counter ${this.selectedHighlights.length === 8 ? 'max' : ''}`
		});

		const resetBtn = counterWrap.createEl('button', { cls: 'ndm-cust-reset-btn', text: 'Reset to Auto' });
		resetBtn.onclick = () => {
			this.selectedHighlights = [];
			updateChips();
		};

		const chipsGrid = sec2.createDiv('ndm-cust-chips-grid');

		const updateChips = () => {
			chipsGrid.empty();
			counterText.setText(`${this.selectedHighlights.length} / 8 properties selected`);
			counterText.toggleClass('max', this.selectedHighlights.length === 8);

			this.col.schema.forEach(f => {
				const isSelected = this.selectedHighlights.includes(f.key);
				const isMax = this.selectedHighlights.length >= 8 && !isSelected;

				const chip = chipsGrid.createDiv({
					cls: `ndm-cust-chip ${isSelected ? 'selected' : ''} ${isMax ? 'disabled' : ''}`,
					attr: { title: `${f.key} (${f.type})` }
				});

				const checkIcon = chip.createSpan('ndm-cust-chip-check');
				setIcon(checkIcon, isSelected ? 'check-square' : 'square');
				chip.createSpan({ text: f.key, cls: 'ndm-cust-chip-name' });

				chip.onclick = () => {
					if (isSelected) {
						this.selectedHighlights = this.selectedHighlights.filter(k => k !== f.key);
						updateChips();
					} else {
						if (this.selectedHighlights.length >= 8) {
							new Notice('You can select a maximum of 8 highlight properties.');
							return;
						}
						this.selectedHighlights.push(f.key);
						updateChips();
					}
				};
			});

			if (this.col.schema.length === 0) {
				chipsGrid.createDiv({
					text: 'No schema fields found yet. Scan schema in collection settings first.',
					cls: 'ndm-cust-empty-notice'
				});
			}
		};

		updateChips();

		// ── Section 3: External Web Links Position ────────────────
		const sec3 = body.createDiv('ndm-cust-section');
		const sec3Header = sec3.createDiv('ndm-cust-sec-title');
		setIcon(sec3Header.createSpan('ndm-cust-sec-icon'), 'link');
		sec3Header.createSpan({ text: 'External Links' });

		sec3.createDiv({
			text: 'Display position for external database/store links.',
			cls: 'ndm-cust-sec-desc'
		});

		const linkRow = sec3.createDiv('ndm-cust-input-row');
		linkRow.createSpan({ text: 'Position:', cls: 'ndm-cust-label' });

		const linkDropWrap = linkRow.createDiv('dash-custom-dropdown ndm-cust-dropdown');
		const linkDropBtn = linkDropWrap.createDiv('dash-custom-dropdown-btn');
		const linkDropLabel = linkDropBtn.createSpan({
			text: this.selectedLinksPosition === 'topbar' ? 'Topbar Dropdown Menu (Links ▾)' : 'Under Cover Image (Default)'
		});
		const linkDropArrow = linkDropBtn.createSpan('dash-custom-dropdown-arrow');
		setIcon(linkDropArrow, 'chevron-down');

		const linkDropList = linkDropWrap.createDiv('dash-custom-dropdown-list hidden');

		const linkOptions: [('cover' | 'topbar'), string][] = [
			['cover', 'Under Cover Image (Default)'],
			['topbar', 'Topbar Dropdown Menu (Links ▾)'],
		];

		linkOptions.forEach(([val, label]) => {
			const item = linkDropList.createDiv(`dash-custom-dropdown-item ${this.selectedLinksPosition === val ? 'active' : ''}`);
			item.setText(label);
			item.onclick = (e) => {
				e.stopPropagation();
				this.selectedLinksPosition = val;
				linkDropLabel.setText(label);
				linkDropList.addClass('hidden');
				linkDropBtn.removeClass('open');
				linkDropList.querySelectorAll('.dash-custom-dropdown-item').forEach(el => el.removeClass('active'));
				item.addClass('active');
			};
		});

		linkDropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !linkDropList.hasClass('hidden');
			if (isOpen) {
				linkDropList.addClass('hidden');
				linkDropBtn.removeClass('open');
			} else {
				linkDropList.removeClass('hidden');
				linkDropBtn.addClass('open');
			}
		};

		// ── Section 4: Rating Scale ───────────────────────────────
		const sec4 = body.createDiv('ndm-cust-section');
		const sec4Header = sec4.createDiv('ndm-cust-sec-title');
		setIcon(sec4Header.createSpan('ndm-cust-sec-icon'), 'star');
		sec4Header.createSpan({ text: 'Rating System' });

		sec4.createDiv({
			text: 'Rating scale format for the header star badge.',
			cls: 'ndm-cust-sec-desc'
		});

		const ratingRow = sec4.createDiv('ndm-cust-input-row');
		ratingRow.createSpan({ text: 'Scale:', cls: 'ndm-cust-label' });

		const ratingDropWrap = ratingRow.createDiv('dash-custom-dropdown ndm-cust-dropdown');
		const ratingDropBtn = ratingDropWrap.createDiv('dash-custom-dropdown-btn');
		
		const ratingLabels: Record<string, string> = {
			'auto': 'Auto Detect (Default)',
			'5': '5-Star Scale (/ 5)',
			'10': '10-Point Scale (/ 10)',
			'100': '100-Point Scale (/ 100)',
			'none': 'Disabled (Hide Badge)',
		};

		const ratingDropLabel = ratingDropBtn.createSpan({
			text: ratingLabels[this.selectedRatingScale] || 'Auto Detect (Default)'
		});
		const ratingDropArrow = ratingDropBtn.createSpan('dash-custom-dropdown-arrow');
		setIcon(ratingDropArrow, 'chevron-down');

		const ratingDropList = ratingDropWrap.createDiv('dash-custom-dropdown-list hidden');

		const ratingOptions: [('auto' | '5' | '10' | '100' | 'none'), string][] = [
			['auto', 'Auto Detect (Default)'],
			['5', '5-Star Scale (/ 5)'],
			['10', '10-Point Scale (/ 10)'],
			['100', '100-Point Scale (/ 100)'],
			['none', 'Disabled (Hide Badge)'],
		];

		ratingOptions.forEach(([val, label]) => {
			const item = ratingDropList.createDiv(`dash-custom-dropdown-item ${this.selectedRatingScale === val ? 'active' : ''}`);
			item.setText(label);
			item.onclick = (e) => {
				e.stopPropagation();
				this.selectedRatingScale = val;
				ratingDropLabel.setText(label);
				ratingDropList.addClass('hidden');
				ratingDropBtn.removeClass('open');
				ratingDropList.querySelectorAll('.dash-custom-dropdown-item').forEach(el => el.removeClass('active'));
				item.addClass('active');
			};
		});

		ratingDropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !ratingDropList.hasClass('hidden');
			if (isOpen) {
				ratingDropList.addClass('hidden');
				ratingDropBtn.removeClass('open');
			} else {
				ratingDropList.removeClass('hidden');
				ratingDropBtn.addClass('open');
			}
		};

		// ── Footer ────────────────────────────────────────────────
		const footer = contentEl.createDiv('ndm-cust-footer');

		const cancelBtn = footer.createEl('button', { cls: 'ndm-cust-btn ndm-cust-btn-cancel', text: 'Cancel' });
		cancelBtn.onclick = () => this.close();

		const saveBtn = footer.createEl('button', { cls: 'ndm-cust-btn ndm-cust-btn-save', text: 'Save Changes' });
		saveBtn.onclick = async () => {
			if (!this.col.noteDetailConfig) {
				this.col.noteDetailConfig = {};
			}

			const cfg = this.col.noteDetailConfig;
			cfg.statusField = this.selectedStatusField || undefined;
			
			const parsedOptions = this.statusOptionsText
				.split(',')
				.map(s => s.trim())
				.filter(Boolean);

			cfg.statusOptions = parsedOptions.length > 0 ? parsedOptions : undefined;
			cfg.highlightFields = this.selectedHighlights.length > 0 ? this.selectedHighlights : undefined;
			cfg.linksPosition = this.selectedLinksPosition;
			cfg.ratingScale = this.selectedRatingScale;

			try {
				await this.onSave();
				new Notice(`Note detail view customized for "${this.col.name}"!`);
				this.close();
				if (this.onRefresh) this.onRefresh();
			} catch (err) {
				new Notice(`Failed to save settings: ${String(err)}`);
			}
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
