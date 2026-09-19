import { Modal, App, setIcon, Notice } from 'obsidian';
import type { CollectionConfig, CustomLinkConfig } from '../types';
import { applyCollectionTheme } from '../utils/ColorUtils';

export class NoteDetailCustomizeModal extends Modal {
	private selectedHighlights: string[];
	private selectedStatusField: string;
	private statusOptionsText: string;
	private selectedCreatorField: string;
	private selectedDateField: string;
	private selectedRatingField: string;
	private selectedRatingScale: 'auto' | '5' | '10' | '100' | 'none';
	private selectedDurationFields: string[];
	private durationFieldsText: string;
	private selectedLinksPosition: 'cover' | 'topbar';
	private customLinks: CustomLinkConfig[];

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
		this.selectedCreatorField = cfg.creatorField ?? '';
		this.selectedDateField = cfg.dateBadgeField ?? '';
		this.selectedRatingField = cfg.ratingField ?? '';
		this.selectedRatingScale = (cfg.ratingScale as 'auto' | '5' | '10' | '100' | 'none') ?? 'auto';
		this.selectedDurationFields = cfg.durationFields ? [...cfg.durationFields] : [];
		this.durationFieldsText = this.selectedDurationFields.join(', ');
		this.selectedLinksPosition = cfg.linksPosition ?? 'cover';
		this.customLinks = cfg.customLinks ? cfg.customLinks.map(l => ({ ...l })) : [];
	}

	onOpen(): void {
		this.containerEl.setCssStyles({ zIndex: '3600' });
		this.modalEl.addClass('dash-modal-dialog', 'dash-note-customize-dialog');

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-note-customize-modal');

		applyCollectionTheme(this.modalEl, this.col.color || '#818cf8');

		// ── Header ────────────────────────────────────────────────
		const header = contentEl.createDiv('ndm-cust-header');
		const headerLeft = header.createDiv('ndm-cust-header-left');
		const iconEl = headerLeft.createSpan('ndm-cust-icon');
		setIcon(iconEl, this.col.icon || 'sliders-horizontal');
		headerLeft.createEl('h2', { text: `Customize "${this.col.name}" Detail View`, cls: 'ndm-cust-title' });

		const headerDesc = contentEl.createDiv('ndm-cust-desc');
		headerDesc.setText('Configure quick status buttons, subtitle badges, highlight properties, duration units, and external links.');

		// ── Body ──────────────────────────────────────────────────
		const body = contentEl.createDiv('ndm-cust-body');

		const schemaFieldOptions = [
			{ value: '', label: '— Disabled (None) —' },
			...this.col.schema.map(f => ({ value: f.key, label: f.key }))
		];

		// ── Section 1: Quick Status Buttons ───────────────────────
		const sec1 = body.createDiv('ndm-cust-section');
		const sec1Header = sec1.createDiv('ndm-cust-sec-title');
		setIcon(sec1Header.createSpan('ndm-cust-sec-icon'), 'toggle-left');
		sec1Header.createSpan({ text: 'Quick Status Buttons' });

		sec1.createDiv({
			text: 'Frontmatter property for interactive toggle buttons (e.g. status, ownership, state).',
			cls: 'ndm-cust-sec-desc'
		});

		const optionsRow = sec1.createDiv('ndm-cust-input-row');
		const optionsLabelRow = optionsRow.createDiv('ndm-cust-counter-row');
		optionsLabelRow.createSpan({ text: 'Buttons (comma-separated):', cls: 'ndm-cust-label' });
		const clearButtonsBtn = optionsLabelRow.createEl('button', { cls: 'ndm-cust-reset-btn', text: 'Clear' });

		const optionsInput = optionsRow.createEl('input', {
			cls: 'ndm-cust-text-input',
			placeholder: 'e.g. Owned, Wishlist, Played, Backlog',
			value: this.statusOptionsText,
		});

		clearButtonsBtn.onclick = () => {
			this.statusOptionsText = '';
			optionsInput.value = '';
		};

		optionsInput.oninput = () => {
			this.statusOptionsText = optionsInput.value;
		};

		if (!this.selectedStatusField || this.selectedStatusField === '__none__') {
			optionsRow.addClass('hidden');
		}

		this.createDropdownRow(
			sec1,
			'Property:',
			this.selectedStatusField === '__none__' ? '' : this.selectedStatusField,
			schemaFieldOptions,
			(val) => {
				this.selectedStatusField = val;
				if (!val) {
					optionsRow.addClass('hidden');
					this.statusOptionsText = '';
					optionsInput.value = '';
				} else {
					optionsRow.removeClass('hidden');
					const sf = this.col.schema.find(f => f.key === val);
					if (sf?.sampleValues && sf.sampleValues.length > 0 && !this.statusOptionsText) {
						const allSamples = sf.sampleValues.flatMap(s => 
							s.includes(',') || s.includes('|') ? s.split(/[,|]/).map(p => p.trim()) : [s.trim()]
						).filter(Boolean);
						const unique = Array.from(new Set(allSamples));
						this.statusOptionsText = unique.join(', ');
						optionsInput.value = this.statusOptionsText;
					}
				}
			},
			optionsRow
		);

		// ── Section 2: Subtitle Badges (Header Info) ──────────────
		const sec2 = body.createDiv('ndm-cust-section');
		const sec2Header = sec2.createDiv('ndm-cust-sec-title');
		setIcon(sec2Header.createSpan('ndm-cust-sec-icon'), 'info');
		sec2Header.createSpan({ text: 'Subtitle Badges (Header Metadata)' });

		sec2.createDiv({
			text: 'Frontmatter properties to display as compact badges beneath the note title.',
			cls: 'ndm-cust-sec-desc'
		});

		// Subtitle 1: Creator / Author / Artist
		this.createDropdownRow(
			sec2,
			'Creator / Author (User icon):',
			this.selectedCreatorField === '__none__' ? '' : this.selectedCreatorField,
			schemaFieldOptions,
			(val) => { this.selectedCreatorField = val; }
		);

		// Subtitle 2: Date / Year / Released
		this.createDropdownRow(
			sec2,
			'Date / Year (Calendar icon):',
			this.selectedDateField === '__none__' ? '' : this.selectedDateField,
			schemaFieldOptions,
			(val) => { this.selectedDateField = val; }
		);

		// Subtitle 3: Rating property & scale
		this.createDropdownRow(
			sec2,
			'Rating Property (Star icon):',
			this.selectedRatingField === '__none__' ? '' : this.selectedRatingField,
			schemaFieldOptions,
			(val) => { this.selectedRatingField = val; }
		);

		const ratingScaleOptions = [
			{ value: 'auto', label: 'Auto Detect (Default)' },
			{ value: '5', label: '5-Star Scale (/ 5)' },
			{ value: '10', label: '10-Point Scale (/ 10)' },
			{ value: '100', label: '100-Point Scale (/ 100)' },
			{ value: 'none', label: 'Disabled (Hide Badge)' },
		];

		this.createDropdownRow(
			sec2,
			'Rating Scale:',
			this.selectedRatingScale,
			ratingScaleOptions,
			(val) => { this.selectedRatingScale = val as 'auto' | '5' | '10' | '100' | 'none'; }
		);

		// ── Section 3: Highlights Grid ────────────────────────────
		const sec3 = body.createDiv('ndm-cust-section');
		const sec3Header = sec3.createDiv('ndm-cust-sec-title');
		setIcon(sec3Header.createSpan('ndm-cust-sec-icon'), 'layout-grid');
		sec3Header.createSpan({ text: 'Highlights Card Grid' });

		sec3.createDiv({
			text: 'Select up to 8 key properties to display prominently in the top highlights card.',
			cls: 'ndm-cust-sec-desc'
		});

		const counterRow = sec3.createDiv('ndm-cust-counter-row');
		const counterText = counterRow.createSpan('ndm-cust-counter');
		
		const autoDetectBtn = counterRow.createEl('button', {
			cls: 'ndm-cust-reset-btn',
			text: 'Clear Highlights'
		});

		autoDetectBtn.onclick = () => {
			this.selectedHighlights = [];
			updateChips();
		};

		const chipsGrid = sec3.createDiv('ndm-cust-chips-grid');

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

		// ── Section 4: Duration Formatting (Minutes to Hours) ─────
		const sec4 = body.createDiv('ndm-cust-section');
		const sec4Header = sec4.createDiv('ndm-cust-sec-title');
		setIcon(sec4Header.createSpan('ndm-cust-sec-icon'), 'clock');
		sec4Header.createSpan({ text: 'Duration Formatting (Minutes to Hours)' });

		sec4.createDiv({
			text: 'Select properties containing minutes to format into hours. Click chips to toggle. Unselected fields will display as raw numbers.',
			cls: 'ndm-cust-sec-desc'
		});

		const durChipsGrid = sec4.createDiv('ndm-cust-chips-grid');

		const durInputRow = sec4.createDiv('ndm-cust-input-row');
		const durLabelRow = durInputRow.createDiv('ndm-cust-counter-row');
		durLabelRow.createSpan({ text: 'Selected Properties (comma-separated):', cls: 'ndm-cust-label' });

		const clearDurBtn = durLabelRow.createEl('button', { cls: 'ndm-cust-reset-btn', text: 'Clear All' });

		const durInput = durInputRow.createEl('input', {
			cls: 'ndm-cust-text-input',
			placeholder: 'e.g. playTime, hltbMain, runtime',
			value: this.durationFieldsText,
		});

		const updateDurChips = () => {
			durChipsGrid.empty();
			// Candidate fields: numeric fields, or all fields if no numeric types defined
			const candidates = this.col.schema.filter(f => f.type === 'number' || this.selectedDurationFields.includes(f.key));
			const list = candidates.length > 0 ? candidates : this.col.schema;

			list.forEach(f => {
				const isSelected = this.selectedDurationFields.some(k => k.toLowerCase() === f.key.toLowerCase());
				const chip = durChipsGrid.createDiv({
					cls: `ndm-cust-chip ${isSelected ? 'selected' : ''}`,
					attr: { title: `${f.key} (${f.type})` }
				});

				const checkIcon = chip.createSpan('ndm-cust-chip-check');
				setIcon(checkIcon, isSelected ? 'check-square' : 'square');
				chip.createSpan({ text: f.key, cls: 'ndm-cust-chip-name' });

				chip.onclick = () => {
					if (isSelected) {
						this.selectedDurationFields = this.selectedDurationFields.filter(k => k.toLowerCase() !== f.key.toLowerCase());
					} else {
						this.selectedDurationFields.push(f.key);
					}
					this.durationFieldsText = this.selectedDurationFields.join(', ');
					durInput.value = this.durationFieldsText;
					updateDurChips();
				};
			});

			if (list.length === 0) {
				durChipsGrid.createDiv({
					text: 'No numeric fields discovered. Enter property names manually below.',
					cls: 'ndm-cust-empty-notice'
				});
			}
		};

		clearDurBtn.onclick = () => {
			this.selectedDurationFields = [];
			this.durationFieldsText = '';
			durInput.value = '';
			updateDurChips();
		};

		durInput.oninput = () => {
			this.durationFieldsText = durInput.value;
			this.selectedDurationFields = durInput.value
				.split(',')
				.map(s => s.trim())
				.filter(Boolean);
			updateDurChips();
		};

		updateDurChips();

		// ── Section 5: External Web Links & Custom Titles ─────────
		const sec5 = body.createDiv('ndm-cust-section');
		const sec5Header = sec5.createDiv('ndm-cust-sec-title');
		setIcon(sec5Header.createSpan('ndm-cust-sec-icon'), 'link');
		sec5Header.createSpan({ text: 'External Links & Custom Titles' });

		sec5.createDiv({
			text: 'Customize link positions and rename generic URL properties with friendly titles and icons.',
			cls: 'ndm-cust-sec-desc'
		});

		const linkOptions: { value: string; label: string }[] = [
			{ value: 'cover', label: 'Under Cover Image (Default)' },
			{ value: 'topbar', label: 'Topbar Dropdown Menu (Links ▾)' },
		];

		this.createDropdownRow(
			sec5,
			'Position:',
			this.selectedLinksPosition,
			linkOptions,
			(val) => { this.selectedLinksPosition = val as 'cover' | 'topbar'; }
		);

		// Custom Links Builder
		const customLinksWrap = sec5.createDiv('ndm-cust-links-builder');
		const customLinksHeader = customLinksWrap.createDiv('ndm-cust-links-header');
		customLinksHeader.createSpan({ text: 'Custom Link Titles & Icons:', cls: 'ndm-cust-label' });
		
		const addLinkBtn = customLinksHeader.createEl('button', {
			cls: 'ndm-cust-add-link-btn',
			text: '+ Add Custom Link'
		});

		const linksListContainer = customLinksWrap.createDiv('ndm-cust-links-list');

		const renderCustomLinksList = () => {
			linksListContainer.empty();
			if (this.customLinks.length === 0) {
				const emptyHint = linksListContainer.createDiv('ndm-cust-empty-links-hint');
				emptyHint.setText('No custom link mappings yet. URLs will use automatic platform detection.');
				return;
			}

			this.customLinks.forEach((cl, index) => {
				const row = linksListContainer.createDiv('ndm-cust-link-row');

				// 1. Property Name input
				const keyWrap = row.createDiv('ndm-cust-link-field-wrap');
				const keyInput = keyWrap.createEl('input', {
					cls: 'ndm-cust-link-input',
					placeholder: 'Property (e.g. datasource)',
					value: cl.fieldKey || ''
				});
				keyInput.oninput = () => {
					cl.fieldKey = keyInput.value.trim();
				};

				// 2. Display Title input
				const labelWrap = row.createDiv('ndm-cust-link-field-wrap');
				const labelInput = labelWrap.createEl('input', {
					cls: 'ndm-cust-link-input',
					placeholder: 'Display Title (e.g. League of Comic Geeks)',
					value: cl.label || ''
				});
				labelInput.oninput = () => {
					cl.label = labelInput.value;
				};

				// 3. Icon input
				const iconWrap = row.createDiv('ndm-cust-link-icon-wrap');
				const iconInput = iconWrap.createEl('input', {
					cls: 'ndm-cust-link-input ndm-cust-link-icon-input',
					placeholder: 'Icon (e.g. book-open)',
					value: cl.icon || 'external-link'
				});
				iconInput.oninput = () => {
					cl.icon = iconInput.value.trim() || 'external-link';
				};

				// 4. Delete button
				const delBtn = row.createEl('button', {
					cls: 'ndm-cust-link-del-btn',
					attr: { title: 'Remove Mapping', 'aria-label': 'Remove' }
				});
				setIcon(delBtn, 'trash-2');
				delBtn.onclick = () => {
					this.customLinks.splice(index, 1);
					renderCustomLinksList();
				};
			});
		};

		addLinkBtn.onclick = () => {
			this.customLinks.push({ fieldKey: '', label: '', icon: 'external-link' });
			renderCustomLinksList();
		};

		renderCustomLinksList();

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
			cfg.creatorField = this.selectedCreatorField || undefined;
			cfg.dateBadgeField = this.selectedDateField || undefined;
			cfg.ratingField = this.selectedRatingField || undefined;
			cfg.ratingScale = this.selectedRatingScale;
			cfg.highlightFields = this.selectedHighlights.length > 0 ? this.selectedHighlights : undefined;
			cfg.durationFields = this.selectedDurationFields.length > 0 ? this.selectedDurationFields : undefined;
			cfg.linksPosition = this.selectedLinksPosition;
			cfg.customLinks = this.customLinks
				.filter(cl => cl.fieldKey && cl.fieldKey.trim() && cl.label && cl.label.trim())
				.map(cl => ({
					fieldKey: cl.fieldKey.trim(),
					label: cl.label.trim(),
					icon: cl.icon ? cl.icon.trim() : 'external-link'
				}));

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

	private createDropdownRow(
		parent: HTMLElement,
		label: string,
		currentValue: string,
		options: { value: string; label: string }[],
		onChange: (value: string) => void,
		insertBeforeTarget?: HTMLElement
	): { row: HTMLElement; updateLabel: (text: string) => void } {
		const row = parent.createDiv('ndm-cust-input-row');
		if (insertBeforeTarget && insertBeforeTarget.parentElement === parent) {
			parent.insertBefore(row, insertBeforeTarget);
		}
		row.createSpan({ text: label, cls: 'ndm-cust-label' });

		const dropWrap = row.createDiv('dash-custom-dropdown ndm-cust-dropdown');
		const dropBtn = dropWrap.createDiv('dash-custom-dropdown-btn');

		const currentOpt = options.find(o => o.value === currentValue);
		const initialText = currentOpt ? currentOpt.label : (currentValue || '— Disabled (None) —');
		const dropLabel = dropBtn.createSpan({ text: initialText, cls: 'dash-custom-dropdown-label' });
		const dropArrow = dropBtn.createSpan('dash-custom-dropdown-arrow');
		setIcon(dropArrow, 'chevron-down');
		const dropList = dropWrap.createDiv('dash-custom-dropdown-list hidden');

		options.forEach(opt => {
			const item = dropList.createDiv(`dash-custom-dropdown-item ${currentValue === opt.value ? 'active' : ''}`);
			item.setText(opt.label);
			item.onclick = (e) => {
				e.stopPropagation();
				dropLabel.setText(opt.label);
				dropList.addClass('hidden');
				dropBtn.removeClass('open');
				dropList.querySelectorAll('.dash-custom-dropdown-item').forEach(el => el.removeClass('active'));
				item.addClass('active');
				onChange(opt.value);
			};
		});

		dropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !dropList.hasClass('hidden');
			if (isOpen) {
				dropList.addClass('hidden');
				dropBtn.removeClass('open');
			} else {
				this.containerEl.querySelectorAll('.dash-custom-dropdown-list').forEach(l => l.addClass('hidden'));
				this.containerEl.querySelectorAll('.dash-custom-dropdown-btn').forEach(b => b.removeClass('open'));
				dropList.removeClass('hidden');
				dropBtn.addClass('open');
			}
		};

		return {
			row,
			updateLabel: (txt: string) => dropLabel.setText(txt)
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
