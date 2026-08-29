import { Modal, App, TFile, Notice, setIcon } from 'obsidian';
import type { RawRecord, CollectionConfig } from '../types';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../utils/ColorUtils';
import { resolveImageSrc } from '../dashboard/drilldown/CardRenderer';

export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'rating';

interface PropertyFieldItem {
	key: string;
	type: PropertyType;
	value: unknown;
	isNew?: boolean;
}

export class NoteEditModal extends Modal {
	private properties: PropertyFieldItem[] = [];
	private pinnedKeys: Set<string> = new Set();

	constructor(
		app: App,
		private rec: RawRecord,
		private col: CollectionConfig,
		private onSaved?: () => void | Promise<void>,
		private onOpenNote?: () => void,
		private onBack?: () => void
	) {
		super(app);
		this.pinnedKeys = new Set(this.col.drilldownConfig?.fields || []);
		this.initProperties();
	}

	private initProperties(): void {
		const schemaMap = new Map((this.col.schema || []).map(s => [s.key.toLowerCase(), s.type]));
		const fields = { ...this.rec.fields };

		// ONLY load properties that actually exist on THIS specific note
		for (const [key, val] of Object.entries(fields)) {
			if (key.startsWith('_') || key === 'position') continue;
			const propType = this.inferPropertyType(key, val, schemaMap.get(key.toLowerCase()));
			this.properties.push({
				key,
				type: propType,
				value: this.normalizeValueForType(val, propType)
			});
		}
	}

	private inferPropertyType(key: string, val: unknown, schemaType?: string): PropertyType {
		const lower = key.toLowerCase();

		// Check rating (stars)
		if (/rating|score|puan|stars|priority|yıldız/i.test(lower)) {
			const num = typeof val === 'number' ? val : parseFloat(String(val));
			if (!isNaN(num) && num >= 0 && num <= 10) {
				return 'rating';
			}
		}

		// Check array / list
		if (Array.isArray(val) || schemaType === 'array' || /tags|genres|developers|publishers|aliases|platforms|gamemodes|authors|cast|categories|series/i.test(lower)) {
			return 'list';
		}

		// Check boolean / checkbox
		if (typeof val === 'boolean' || schemaType === 'boolean' || /^(is|has)_|played|completed|finished|favorite|owned|released|selected|locked/i.test(lower)) {
			if (typeof val === 'boolean' || String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'false') {
				return 'checkbox';
			}
		}

		// Check date
		if (schemaType === 'date' || /date|tarih|release|created|modified|deadline/i.test(lower)) {
			if (typeof val === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}/.test(val)) {
				return 'date';
			}
			if (typeof val === 'string' && val.length > 0 && !isNaN(Date.parse(val)) && val.length <= 25) {
				return 'date';
			}
		}

		// Check number
		if (typeof val === 'number' || schemaType === 'number') {
			return 'number';
		}

		return 'text';
	}

	private normalizeValueForType(val: unknown, type: PropertyType): unknown {
		if (type === 'list') {
			if (Array.isArray(val)) return [...val];
			if (typeof val === 'string' && val.trim()) {
				if (val.includes(',') || val.includes('|')) {
					return val.split(/[,|]/).map(s => s.trim()).filter(Boolean);
				}
				return [val.trim()];
			}
			return [];
		}
		if (type === 'checkbox') {
			return val === true || String(val).toLowerCase() === 'true' || val === 1 || String(val).toLowerCase() === 'yes';
		}
		if (type === 'number' || type === 'rating') {
			if (typeof val === 'number') return val;
			const n = parseFloat(String(val));
			return isNaN(n) ? '' : n;
		}
		return val !== undefined && val !== null ? String(val) : '';
	}

	onOpen(): void {
		this.containerEl.setCssStyles({ zIndex: '3500' });
		this.modalEl.addClass('dash-modal-dialog', 'dash-note-edit-dialog');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-modern-modal');

		const baseColor = this.col.color || '#818cf8';
		const isDark = !(typeof activeDocument !== 'undefined' && activeDocument.body ? activeDocument.body : document.body).classList.contains('theme-light');
		const colFg = getAdaptiveForeground(baseColor, isDark);
		const colRgb = hexToRgbString(colFg);
		const colContrast = getContrastTextColor(colFg);

		this.modalEl.setCssProps({
			'--collection-color': baseColor,
			'--col-fg': colFg,
			'--col-rgb': colRgb,
			'--col-contrast': colContrast,
		});

		// ── Header ──────────────────────────────────────────────
		const headerWrap = contentEl.createDiv('dash-note-edit-header');
		
		let imageSrc: string | null = null;
		const imgKey = this.col.drilldownConfig?.imageField 
			|| ['cover', 'image', 'poster', 'thumbnail', 'banner'].find(k => this.rec.fields[k]);
		
		if (imgKey && this.rec.fields[imgKey]) {
			imageSrc = resolveImageSrc(this.app, String(this.rec.fields[imgKey]));
		}

		if (imageSrc) {
			const coverWrap = headerWrap.createDiv('dash-note-edit-cover-wrap');
			coverWrap.createEl('img', { cls: 'dash-note-edit-cover-img', attr: { src: imageSrc, loading: 'lazy' } });
		} else {
			const iconPlaceholder = headerWrap.createDiv('dash-note-edit-cover-placeholder');
			setIcon(iconPlaceholder, this.col.icon || 'file-text');
		}

		const headerText = headerWrap.createDiv('dash-note-edit-header-text');
		const badgeRow = headerText.createDiv('dash-note-edit-badge-row');
		const badge = badgeRow.createDiv('dash-note-edit-badge');
		setIcon(badge.createSpan('dash-note-edit-badge-icon'), 'edit-3');
		badge.createSpan({ text: 'FRONTMATTER EDITOR' });

		const titleRow = headerText.createDiv('dash-note-edit-title-row');
		const titleEl = titleRow.createDiv({ text: `Edit Note: ${this.rec.title}`, cls: 'dash-note-edit-title' });
		titleEl.setAttribute('title', this.rec.title);

		headerText.createDiv({
			text: 'Update frontmatter properties. Pinned properties appear prominently at the top.',
			cls: 'dash-note-edit-subtitle'
		});

		// Quick Open Note Action Button
		const openBtn = titleRow.createEl('button', {
			cls: 'dash-note-open-btn',
			attr: { 'aria-label': 'Open Note in Obsidian Tab', title: 'Open Note' }
		});
		setIcon(openBtn.createSpan('dash-note-open-btn-icon'), 'external-link');
		openBtn.createSpan({ text: 'Open Note', cls: 'dash-note-open-btn-text' });
		openBtn.onclick = () => {
			this.close();
			if (this.onOpenNote) {
				this.onOpenNote();
			} else {
				void this.app.workspace.openLinkText(this.rec.filePath, '', true);
			}
		};

		// ── Form Body ───────────────────────────────────────────
		const body = contentEl.createDiv('dash-note-edit-body');
		this.renderPropertiesList(body);

		// ── Footer ──────────────────────────────────────────────
		const footer = contentEl.createDiv('dash-modal-footer');
		const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'dash-modal-cancel' });
		cancelBtn.onclick = () => {
			this.close();
			if (this.onBack) this.onBack();
		};

		const saveBtn = footer.createEl('button', { text: 'Save Changes', cls: 'dash-modal-save mod-cta' });
		saveBtn.onclick = async () => {
			await this.saveChanges();
		};
	}

	private renderPropertiesList(body: HTMLElement): void {
		body.empty();

		const pinnedProps = this.properties.filter(p => this.pinnedKeys.has(p.key));
		const generalProps = this.properties.filter(p => !this.pinnedKeys.has(p.key));

		if (pinnedProps.length > 0) {
			const pinnedSec = body.createDiv('dash-note-section dash-note-section-pinned');
			const secHeader = pinnedSec.createDiv('dash-note-sec-header');
			setIcon(secHeader.createSpan('dash-note-sec-icon'), 'pin');
			secHeader.createSpan({ text: 'PINNED PROPERTIES', cls: 'dash-note-sec-title' });

			pinnedProps.forEach((prop, idx) => this.renderPropertyRow(pinnedSec, prop, idx, body, true));
		}

		const generalSec = body.createDiv('dash-note-section');
		const secHeader = generalSec.createDiv('dash-note-sec-header');
		setIcon(secHeader.createSpan('dash-note-sec-icon'), this.col.icon || 'layers');
		secHeader.createSpan({ text: 'GAMEPLAY & METADATA', cls: 'dash-note-sec-title' });

		generalProps.forEach((prop, idx) => this.renderPropertyRow(generalSec, prop, idx, body, false));

		// Add Property Button
		const addRow = generalSec.createDiv('dash-note-add-prop-row');
		const addBtn = addRow.createEl('button', {
			cls: 'dash-note-add-prop-btn',
			attr: { title: 'Add a new frontmatter property' }
		});
		setIcon(addBtn.createSpan('dash-note-add-prop-icon'), 'plus');
		addBtn.createSpan({ text: 'Add property' });
		addBtn.onclick = () => {
			const newProp: PropertyFieldItem = {
				key: `property_${this.properties.length + 1}`,
				type: 'text',
				value: '',
				isNew: true
			};
			this.properties.push(newProp);
			this.renderPropertiesList(body);
		};
	}

	private getPropertyTypeIcon(type: PropertyType): string {
		switch (type) {
			case 'text': return 'align-left';
			case 'list': return 'list';
			case 'number': return 'hash';
			case 'checkbox': return 'check-square';
			case 'date': return 'calendar';
			case 'rating': return 'star';
			default: return 'align-left';
		}
	}

	private renderPropertyRow(
		container: HTMLElement,
		prop: PropertyFieldItem,
		_index: number,
		body: HTMLElement,
		isPinned: boolean
	): void {
		const row = container.createDiv(`dash-note-prop-row ${isPinned ? 'is-pinned-row' : ''}`);

		// ── Left: Type Selector + Key Label ──────────────────────
		const labelCol = row.createDiv('dash-note-prop-label-col');

		// Type Icon dropdown trigger
		const typeBtn = labelCol.createEl('button', {
			cls: 'dash-note-type-btn',
			attr: { title: `Type: ${prop.type}. Click to change.` }
		});
		setIcon(typeBtn, this.getPropertyTypeIcon(prop.type));
		
		typeBtn.onclick = (e) => {
			e.stopPropagation();
			this.showTypePickerMenu(typeBtn, prop, body);
		};

		if (prop.isNew) {
			const keyInput = labelCol.createEl('input', {
				type: 'text',
				cls: 'dash-note-prop-key-input',
				attr: { value: prop.key, placeholder: 'Property name' }
			});
			keyInput.oninput = () => {
				prop.key = keyInput.value.trim();
			};
		} else {
			const keySpan = labelCol.createSpan({ text: prop.key, cls: 'dash-note-prop-label' });
			keySpan.setAttribute('title', prop.key);
		}

		// ── Middle: Dynamic Field Control ────────────────────────
		const valCol = row.createDiv('dash-note-prop-val-col');
		this.renderFieldControl(valCol, prop);

		// ── Right Actions: Pin Toggle + Delete ───────────────────
		const rightActions = row.createDiv('dash-note-row-actions');

		// Pin Button
		const pinBtn = rightActions.createEl('button', {
			cls: `dash-note-pin-btn ${isPinned ? 'pinned' : ''}`,
			attr: { title: isPinned ? 'Unpin property' : 'Pin property to top' }
		});
		setIcon(pinBtn, isPinned ? 'pin-off' : 'pin');
		pinBtn.onclick = (e) => {
			e.stopPropagation();
			if (isPinned) {
				this.pinnedKeys.delete(prop.key);
			} else {
				this.pinnedKeys.add(prop.key);
			}
			if (this.col.drilldownConfig) {
				this.col.drilldownConfig.fields = Array.from(this.pinnedKeys);
			}
			this.renderPropertiesList(body);
		};

		// Delete Button
		const deleteBtn = rightActions.createEl('button', {
			cls: 'dash-note-prop-del-btn',
			attr: { title: 'Delete property' }
		});
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.onclick = (e) => {
			e.stopPropagation();
			const idx = this.properties.indexOf(prop);
			if (idx !== -1) {
				this.properties.splice(idx, 1);
				this.pinnedKeys.delete(prop.key);
				this.renderPropertiesList(body);
			}
		};
	}

	private showTypePickerMenu(anchorEl: HTMLElement, prop: PropertyFieldItem, body: HTMLElement): void {
		const menu = activeDocument.body.createDiv('dash-custom-dropdown-list dash-note-type-menu');
		const rect = anchorEl.getBoundingClientRect();
		menu.setCssStyles({
			top: `${rect.bottom + 4}px`,
			left: `${rect.left}px`,
			zIndex: '4000',
		});

		const types: [PropertyType, string, string][] = [
			['text', 'Text', 'align-left'],
			['list', 'List (Tags / Array)', 'list'],
			['number', 'Number', 'hash'],
			['checkbox', 'Checkbox (Boolean)', 'check-square'],
			['date', 'Date', 'calendar'],
			['rating', 'Rating (Stars)', 'star'],
		];

		types.forEach(([t, label, iconName]) => {
			const item = menu.createDiv(`dash-custom-dropdown-item ${prop.type === t ? 'active' : ''}`);
			const ic = item.createSpan('dash-note-type-menu-icon');
			setIcon(ic, iconName);
			item.createSpan({ text: label });

			item.onclick = () => {
				prop.type = t;
				prop.value = this.normalizeValueForType(prop.value, t);
				menu.remove();
				this.renderPropertiesList(body);
			};
		});

		const closeMenu = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				menu.remove();
				activeDocument.removeEventListener('click', closeMenu);
			}
		};
		window.setTimeout(() => activeDocument.addEventListener('click', closeMenu), 0);
	}

	private renderFieldControl(container: HTMLElement, prop: PropertyFieldItem): void {
		container.empty();

		switch (prop.type) {
			case 'list':
				this.renderListPillControl(container, prop);
				break;
			case 'checkbox':
				this.renderCheckboxControl(container, prop);
				break;
			case 'date':
				this.renderDateControl(container, prop);
				break;
			case 'rating':
				this.renderRatingControl(container, prop);
				break;
			case 'number':
				this.renderNumberControl(container, prop);
				break;
			case 'text':
			default:
				this.renderTextControl(container, prop);
				break;
		}
	}

	private renderListPillControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const items: string[] = Array.isArray(prop.value) ? prop.value.map(String) : [];
		const wrap = container.createDiv('dash-note-list-wrap');
		const pillsWrap = wrap.createDiv('dash-note-pills-wrap');

		const updateValue = () => {
			prop.value = [...items];
		};

		const renderPills = () => {
			pillsWrap.empty();
			items.forEach((itemText, idx) => {
				const pill = pillsWrap.createDiv('dash-note-item-pill');
				pill.createSpan({ text: itemText, cls: 'dash-note-item-pill-text' });
				const removeBtn = pill.createSpan({ text: '×', cls: 'dash-note-item-pill-remove' });
				removeBtn.onclick = (e) => {
					e.stopPropagation();
					items.splice(idx, 1);
					updateValue();
					renderPills();
				};
			});

			const addInput = pillsWrap.createEl('input', {
				cls: 'dash-note-pill-input',
				attr: { placeholder: '+ Add item…' },
			});

			const commitItem = () => {
				const val = addInput.value.trim();
				if (val) {
					if (val.includes(',') || val.includes('|')) {
						const parts = val.split(/[,|]/).map(s => s.trim()).filter(Boolean);
						items.push(...parts);
					} else {
						items.push(val);
					}
					updateValue();
					renderPills();
				}
			};

			addInput.onkeydown = (e) => {
				if (e.key === 'Enter' || e.key === ',') {
					e.preventDefault();
					commitItem();
				}
			};

			addInput.onblur = () => {
				commitItem();
			};
		};

		renderPills();
	}

	private renderCheckboxControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const boolVal = prop.value === true;
		const toggle = container.createEl('button', {
			cls: `dash-note-toggle-btn ${boolVal ? 'active' : ''}`,
			attr: { title: 'Toggle boolean status' }
		});
		toggle.createSpan('dash-note-toggle-dot');
		toggle.createSpan({ text: boolVal ? 'True' : 'False', cls: 'dash-note-toggle-text' });

		toggle.onclick = () => {
			const next = !boolVal;
			prop.value = next;
			toggle.toggleClass('active', next);
			toggle.querySelector('.dash-note-toggle-text')!.textContent = next ? 'True' : 'False';
		};
	}

	private renderDateControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const dateStr = typeof prop.value === 'string' ? prop.value.slice(0, 10) : '';
		const wrap = container.createDiv('dash-note-date-wrap');
		const input = wrap.createEl('input', {
			type: 'date',
			cls: 'dash-modal-input-styled dash-note-date-input',
			attr: { value: dateStr }
		});
		input.oninput = () => {
			prop.value = input.value;
		};

		const clearBtn = wrap.createEl('button', {
			cls: 'dash-note-date-clear-btn',
			attr: { title: 'Clear date' }
		});
		setIcon(clearBtn, 'x');
		clearBtn.onclick = () => {
			input.value = '';
			prop.value = '';
		};
	}

	private renderRatingControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const wrap = container.createDiv('dash-note-rating-wrap');
		const rawNum = typeof prop.value === 'number' ? prop.value : parseFloat(String(prop.value)) || 0;
		const maxStars = rawNum > 5 && rawNum <= 10 ? 10 : 5;

		const starBar = wrap.createDiv('dash-note-star-bar');
		for (let i = 1; i <= maxStars; i++) {
			const star = starBar.createSpan({
				cls: `dash-note-star-btn ${i <= Math.round(rawNum) ? 'active' : ''}`,
				text: '★',
				attr: { 'aria-label': `${i} / ${maxStars}` }
			});
			star.onclick = () => {
				const nextVal = rawNum === i ? 0 : i;
				prop.value = nextVal;
				starBar.querySelectorAll('.dash-note-star-btn').forEach((s, idx) => {
					if (idx < nextVal) s.addClass('active');
					else s.removeClass('active');
				});
				input.value = String(nextVal);
			};
		}

		const input = wrap.createEl('input', {
			type: 'number',
			cls: 'dash-note-rating-num-input',
			attr: { value: prop.value !== undefined && prop.value !== null ? String(prop.value) : '', step: '0.1' }
		});
		input.oninput = () => {
			const parsed = parseFloat(input.value);
			prop.value = isNaN(parsed) ? input.value : parsed;
			starBar.querySelectorAll('.dash-note-star-btn').forEach((s, idx) => {
				if (idx < Math.round(parsed || 0)) s.addClass('active');
				else s.removeClass('active');
			});
		};
	}

	private renderNumberControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const input = container.createEl('input', {
			type: 'number',
			cls: 'dash-modal-input-styled',
			attr: { value: prop.value !== undefined && prop.value !== null ? String(prop.value) : '', step: 'any' }
		});
		input.oninput = () => {
			const n = parseFloat(input.value);
			prop.value = isNaN(n) ? input.value : n;
		};
	}

	private renderTextControl(container: HTMLElement, prop: PropertyFieldItem): void {
		const input = container.createEl('input', {
			type: 'text',
			cls: 'dash-modal-input-styled',
			attr: { value: prop.value !== undefined && prop.value !== null ? String(prop.value) : '' }
		});
		input.oninput = () => {
			prop.value = input.value;
		};
	}

	private async saveChanges(): Promise<void> {
		const tfile = this.app.vault.getAbstractFileByPath(this.rec.filePath);
		if (!(tfile instanceof TFile)) {
			new Notice(`Could not locate file: ${this.rec.filePath}`);
			return;
		}

		try {
			await this.app.fileManager.processFrontMatter(tfile, (fm: Record<string, unknown>) => {
				const currentKeysInModal = new Set(this.properties.map(p => p.key));

				// Remove properties that were deleted in the modal
				for (const existingKey of Object.keys(fm)) {
					if (!existingKey.startsWith('_') && existingKey !== 'position' && !currentKeysInModal.has(existingKey)) {
						delete fm[existingKey];
					}
				}

				// Apply updated properties
				for (const prop of this.properties) {
					if (!prop.key.trim()) continue;
					const v = prop.value;
					if (v === undefined || v === null || v === '') {
						delete fm[prop.key];
					} else {
						fm[prop.key] = v;
					}
				}
			});

			// Update in-memory record fields
			const newFields: Record<string, unknown> = {};
			for (const p of this.properties) {
				if (p.key.trim()) newFields[p.key] = p.value;
			}
			this.rec.fields = newFields;

			new Notice(`Updated "${this.rec.title}"`);
			if (this.onSaved) {
				await this.onSaved();
			}
			this.close();
			if (this.onBack) {
				this.onBack();
			}
		} catch (err) {
			console.error('Failed to update frontmatter:', err);
			new Notice('Failed to update note frontmatter. See console for details.');
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
