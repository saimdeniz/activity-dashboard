import { App, PluginSettingTab, Setting, Notice, setIcon } from 'obsidian';
import type { CollectionConfig, DashboardSettings } from '../types';
import { COLLECTION_COLORS } from '../types';
import { SchemaScanner } from '../core/SchemaScanner';
import { FolderSuggest } from '../utils/FolderSuggest';
import { NoteDetailCustomizeModal } from '../modals/NoteDetailCustomizeModal';
import type LibraryDashPlugin from '../main';

export const DEFAULT_SETTINGS: DashboardSettings = {
	schemaVersion: 3,
	collections: [],
	activeYear: new Date().getFullYear(),
	activeMode: 'library',
	overviewPins: [],
	overviewMediaBreakdown: { size: { height: 'small', span: 6 }, chartType: 'doughnut' },
	overviewColor: '#818cf8',
	colorPaletteTheme: 'classic',
};

// Curated icon set for the visual picker
const ICON_PRESETS = [
	'folder', 'book', 'book-open', 'library', 'film', 'tv', 'gamepad-2',
	'music', 'headphones', 'star', 'heart', 'bookmark', 'tag', 'layers',
	'package', 'box', 'shopping-bag', 'coffee', 'camera', 'palette',
	'code', 'globe', 'briefcase', 'award', 'trophy', 'zap', 'flame',
	'leaf', 'sun', 'moon', 'clock', 'calendar', 'map', 'compass',
];

export class DashboardSettingTab extends PluginSettingTab {
	private expandedId: string | null = null;
	private closeDropdowns: (() => void)[] = [];

	constructor(app: App, private plugin: LibraryDashPlugin) {
		super(app, plugin);
	}

	display(): void {
		this.closeDropdowns.forEach(fn => fn());
		this.closeDropdowns = [];

		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('dash-settings');

		new Setting(containerEl).setName('Dashboard — Overview').setHeading();
		new Setting(containerEl)
			.setName('Overview Accent Color')
			.setDesc('Accent color for the Overview tab widgets (Total Items, Charts, and Pinned widgets).');

		const overviewSwatchRow = containerEl.createDiv('dash-color-swatch-row dash-mb-20');
		
		COLLECTION_COLORS.forEach(c => {
			const activeColor = this.plugin.settings.overviewColor || '#818cf8';
			const swatch = overviewSwatchRow.createDiv({ cls: `dash-color-swatch ${activeColor === c ? 'active' : ''}` });
			swatch.style.setProperty('background-color', c);
			swatch.setAttribute('title', c);
			swatch.onclick = async () => {
				this.plugin.settings.overviewColor = c;
				overviewSwatchRow.querySelectorAll('.dash-color-swatch').forEach(s => s.removeClass('active'));
				swatch.addClass('active');
				
				// Clear old checks and add new one
				overviewSwatchRow.querySelectorAll('.dash-swatch-check').forEach(chk => chk.remove());
				const check = swatch.createDiv('dash-swatch-check');
				setIcon(check, 'check');
				
				await this.plugin.saveSettings();
			};
			if (activeColor === c) {
				const check = swatch.createDiv('dash-swatch-check');
				setIcon(check, 'check');
			}
		});

		// Custom Color Picker for Overview
		new Setting(containerEl)
			.setName('Custom Overview Color')
			.setDesc('Pick any custom color if you don\'t want to use the presets above.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.overviewColor || '#818cf8')
				.onChange(async v => {
					this.plugin.settings.overviewColor = v;
					overviewSwatchRow.querySelectorAll('.dash-color-swatch').forEach(s => s.removeClass('active'));
					await this.plugin.saveSettings();
				})
			);

		const themeSetting = new Setting(containerEl)
			.setName('Chart Color Theme')
			.setDesc('Select the color theme to use for chart palettes (Classic, Pastel, Neon, Monochrome).');

		const activeTheme = this.plugin.settings.colorPaletteTheme || 'classic';
		const themeLabels: Record<string, string> = {
			classic: 'Classic',
			pastel: 'Pastel',
			neon: 'Neon',
			monochrome: 'Monochrome',
		};

		const dropWrap = themeSetting.controlEl.createDiv('dash-custom-dropdown');
		const dropBtn = dropWrap.createDiv('dash-custom-dropdown-btn dash-settings-theme-dropdown-btn');
		const dropLabel = dropBtn.createSpan({ text: themeLabels[activeTheme] || 'Classic', cls: 'dash-custom-dropdown-label' });
		const dropArrow = dropBtn.createSpan({ cls: 'dash-custom-dropdown-arrow' });
		setIcon(dropArrow, 'chevron-down');

		const dropList = dropWrap.createDiv('dash-custom-dropdown-list dash-settings-theme-dropdown-list hidden');

		const options: { value: 'classic' | 'pastel' | 'neon' | 'monochrome'; label: string }[] = [
			{ value: 'classic', label: 'Classic' },
			{ value: 'pastel', label: 'Pastel' },
			{ value: 'neon', label: 'Neon' },
			{ value: 'monochrome', label: 'Monochrome' },
		];

		options.forEach(opt => {
			const item = dropList.createDiv({ 
				cls: `dash-custom-dropdown-item${activeTheme === opt.value ? ' active' : ''}` 
			});
			item.setText(opt.label);
			item.onclick = async (e) => {
				e.stopPropagation();
				this.plugin.settings.colorPaletteTheme = opt.value;
				dropLabel.setText(opt.label);
				dropList.querySelectorAll('.dash-custom-dropdown-item').forEach(i => i.removeClass('active'));
				item.addClass('active');
				dropList.addClass('hidden');
				dropBtn.removeClass('open');
				await this.plugin.saveSettings();
			};
		});

		dropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !dropList.hasClass('hidden');
			dropList.toggleClass('hidden', isOpen);
			dropBtn.toggleClass('open', !isOpen);
		};

		const closeDropdown = (ev: MouseEvent) => {
			if (!dropWrap.contains(ev.target as Node)) {
				dropList.addClass('hidden');
				dropBtn.removeClass('open');
			}
		};
		activeDocument.addEventListener('click', closeDropdown);
		this.closeDropdowns.push(() => {
			activeDocument.removeEventListener('click', closeDropdown);
		});

		new Setting(containerEl).setName('Dashboard — Collections').setHeading();
		containerEl.createEl('p', {
			text: 'Define notes to visualise. Scan schema to discover fields.',
			cls: 'dash-settings-desc',
		});

		const listEl = containerEl.createDiv('dash-settings-list');
		this.renderCollectionList(listEl);

		new Setting(containerEl).setName('Backup & Restore').setHeading();
		containerEl.createEl('p', {
			text: 'Export your configuration settings to back them up or import them onto another device.',
			cls: 'dash-settings-desc',
		});

		new Setting(containerEl)
			.setName('Export Configuration')
			.setDesc('Copy configuration JSON string to clipboard or download as a JSON file.')
			.addButton(btn => {
				btn.setButtonText('Export to Clipboard')
					.setTooltip('Copy configuration JSON string to clipboard')
					.onClick(async () => {
						try {
							const json = JSON.stringify(this.plugin.settings, null, 2);
							await navigator.clipboard.writeText(json);
							new Notice('Configuration copied to clipboard!');
						} catch (err) {
							new Notice('Failed to copy configuration: ' + String(err));
						}
					});
			})
			.addButton(btn => {
				btn.setButtonText('Download Backup')
					.setTooltip('Download configuration as a JSON file')
					.onClick(() => {
						try {
							const json = JSON.stringify(this.plugin.settings, null, 2);
							const blob = new Blob([json], { type: 'application/json' });
							const url = URL.createObjectURL(blob);
							const a = activeDocument.createElement('a');
							a.href = url;
							a.download = `activity-dashboard-settings-${new Date().toISOString().slice(0, 10)}.json`;
							activeDocument.body.appendChild(a);
							a.click();
							activeDocument.body.removeChild(a);
							URL.revokeObjectURL(url);
							new Notice('Configuration download started!');
						} catch (err) {
							new Notice('Failed to download configuration: ' + String(err));
						}
					});
			});

		new Setting(containerEl)
			.setName('Import Configuration')
			.setDesc('Restore settings from clipboard or upload a JSON backup file. Warning: This will overwrite current settings!')
			.addButton(btn => {
				btn.setButtonText('Import from Clipboard')
					.setTooltip('Restore settings from clipboard text')
					.onClick(async () => {
						try {
							const text = await navigator.clipboard.readText();
							const parsed = JSON.parse(text) as unknown;
							validateSettings(parsed);
							this.plugin.settings = { ...DEFAULT_SETTINGS, ...(parsed as Partial<DashboardSettings>) };
							await this.plugin.saveSettings();
							new Notice('Settings imported from clipboard successfully! Reloading...');
							this.display();
						} catch (err) {
							new Notice('Import failed: ' + (err instanceof Error ? err.message : String(err)));
						}
					});
			})
			.addButton(btn => {
				btn.setButtonText('Import Backup')
					.setTooltip('Upload and restore settings from a JSON file')
					.onClick(() => {
						const fileInput = activeDocument.createElement('input');
						fileInput.type = 'file';
						fileInput.accept = '.json';
						fileInput.onchange = async (e) => {
							const file = (e.target as HTMLInputElement).files?.[0];
							if (!file) return;
							const reader = new FileReader();
							reader.onload = async (evt) => {
								try {
									const content = evt.target?.result as string;
									const parsed = JSON.parse(content) as unknown;
									validateSettings(parsed);
									this.plugin.settings = { ...DEFAULT_SETTINGS, ...(parsed as Partial<DashboardSettings>) };
									await this.plugin.saveSettings();
									new Notice('Settings imported successfully! Reloading...');
									this.display();
								} catch (err) {
									new Notice('Import failed: ' + (err instanceof Error ? err.message : String(err)));
								}
							};
							reader.readAsText(file);
						};
						fileInput.click();
					});
			});
	}

	// ── Collection List ────────────────────────────────────────────────────────

	private renderCollectionList(el: HTMLElement): void {
		el.empty();
		const cols = this.plugin.settings.collections;

		if (!cols.length) {
			// Empty state — Add Collection button is part of the card
			const emptyCard = el.createDiv('dash-settings-empty-card');
			const iconWrap = emptyCard.createDiv('dash-settings-empty-icon');
			setIcon(iconWrap, 'layers');
			emptyCard.createDiv({ text: 'No collections yet', cls: 'dash-settings-empty-text' });
			emptyCard.createDiv({
				text: 'Create your first collection to start building your dashboard.',
				cls: 'dash-settings-empty-sub',
			});

			const addBtn = emptyCard.createEl('button', { cls: 'mod-cta dash-add-col-btn dash-empty-add-btn' });
			setIcon(addBtn, 'plus');
			addBtn.createSpan({ text: 'Create First Collection' });
			addBtn.onclick = () => this.addCollection();
			return;
		}

		cols.forEach(col => this.renderCollectionItem(el, col));

		// Add Collection button below list
		const addBar = el.createDiv('dash-settings-add-bar');
		const addBtn = addBar.createEl('button', { cls: 'dash-add-col-btn' });
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: 'Add Collection' });
		addBtn.onclick = () => this.addCollection();
	}

	private async addCollection(): Promise<void> {
		const newCol = this.makeNewCollection();
		this.plugin.settings.collections.push(newCol);
		await this.plugin.saveSettings();
		this.expandedId = newCol.id;
		this.display();
	}

	// ── Collection Item ────────────────────────────────────────────────────────

	private renderCollectionItem(parent: HTMLElement, col: CollectionConfig): void {
		const item = parent.createDiv('dash-settings-item');
		item.style.setProperty('--col-color', col.color);
		const isExpanded = this.expandedId === col.id;

		// Header row
		const header = item.createDiv('dash-settings-item-header');
		header.onclick = (e) => {
			if ((e.target as HTMLElement).closest('button')) return;
			this.expandedId = isExpanded ? null : col.id;
			this.display();
		};

		const colorBadge = header.createDiv('dash-settings-color-badge');
		colorBadge.style.setProperty('background-color', col.color);
		const colIconEl = colorBadge.createDiv('dash-settings-badge-icon');
		setIcon(colIconEl, col.icon);

		const meta = header.createDiv('dash-settings-item-meta');
		meta.createDiv({ text: col.name, cls: 'dash-settings-item-name' });
		const scanInfo = col.schema.length ? `${col.schema.length} fields discovered` : 'Schema not scanned';
		meta.createDiv({
			text: `${col.scanMode === 'folder' ? (col.folderPath ?? '—') : `type: ${col.typeValue ?? '—'}`} · ${scanInfo}`,
			cls: 'dash-settings-item-sub',
		});

		const actions = header.createDiv('dash-settings-item-actions');
		const expandBtn = actions.createEl('button', { cls: 'dash-settings-icon-btn', attr: { 'aria-label': isExpanded ? 'Collapse' : 'Expand' } });
		setIcon(expandBtn, isExpanded ? 'chevron-up' : 'chevron-down');
		expandBtn.onclick = (e) => {
			e.stopPropagation();
			this.expandedId = isExpanded ? null : col.id;
			this.display();
		};

		const deleteBtn = actions.createEl('button', { cls: 'dash-settings-icon-btn dash-settings-delete-btn', attr: { 'aria-label': 'Delete' } });
		setIcon(deleteBtn, 'trash-2');
		deleteBtn.onclick = async (e) => {
			e.stopPropagation();
			this.plugin.settings.collections = this.plugin.settings.collections.filter(c => c.id !== col.id);
			this.plugin.settings.overviewPins = this.plugin.settings.overviewPins.filter(p => p.collectionId !== col.id);
			if (this.expandedId === col.id) this.expandedId = null;
			await this.plugin.saveSettings();
			this.display();
		};

		if (!isExpanded) return;

		// Editor area
		const editor = item.createDiv('dash-settings-editor');

		// ── Name ─────────────────────────────────────────────────────────────
		new Setting(editor)
			.setName('Collection Name')
			.addText(t => t.setValue(col.name).onChange(async v => {
				col.name = v.trim() || 'Untitled';
				await this.plugin.saveSettings();
				// Update header live
				meta.querySelector('.dash-settings-item-name')!.textContent = col.name;
			}));

		// ── Icon Picker ───────────────────────────────────────────────────────
		new Setting(editor)
			.setName('Icon')
			.setDesc('Click an icon to select it, or type a custom Lucide icon name below.');

		const iconPickerWrap = editor.createDiv('dash-icon-picker-wrap');

		// Visual grid
		const iconGrid = iconPickerWrap.createDiv('dash-icon-grid');
		ICON_PRESETS.forEach(iconName => {
			const cell = iconGrid.createDiv({ cls: `dash-icon-cell ${col.icon === iconName ? 'active' : ''}` });
			cell.setAttribute('title', iconName);
			setIcon(cell, iconName);
			cell.onclick = async () => {
				col.icon = iconName;
				customInput.value = iconName;
				iconGrid.querySelectorAll('.dash-icon-cell').forEach(c => c.removeClass('active'));
				cell.addClass('active');
				setIcon(colIconEl, iconName);
				await this.plugin.saveSettings();
			};
		});

		// Custom text input below grid
		const customRow = iconPickerWrap.createDiv('dash-icon-custom-row');
		customRow.createSpan({ text: 'Custom:', cls: 'dash-icon-custom-label' });
		const customInput = customRow.createEl('input', {
			cls: 'dash-icon-custom-input',
			value: col.icon,
			attr: { placeholder: 'e.g. pen-line', spellcheck: 'false' },
		});
		customInput.onchange = async () => {
			const v = customInput.value.trim() || 'folder';
			col.icon = v;
			iconGrid.querySelectorAll('.dash-icon-cell').forEach(c => c.removeClass('active'));
			const match = iconGrid.querySelector(`[title="${v}"]`);
			if (match) match.addClass('active');
			setIcon(colIconEl, v);
			await this.plugin.saveSettings();
		};

		// ── Color Swatches ────────────────────────────────────────────────────
		new Setting(editor).setName('Color').setDesc('accent color for this collection');

		const swatchRow = editor.createDiv('dash-color-swatch-row');
		COLLECTION_COLORS.forEach(c => {
			const swatch = swatchRow.createDiv({ cls: `dash-color-swatch ${col.color === c ? 'active' : ''}` });
			swatch.style.setProperty('background-color', c);
			swatch.setAttribute('title', c);
			swatch.onclick = async () => {
				col.color = c;
				swatchRow.querySelectorAll('.dash-color-swatch').forEach(s => s.removeClass('active'));
				swatch.addClass('active');
				swatchRow.querySelectorAll('.dash-swatch-check').forEach(chk => chk.remove());
				const check = swatch.createDiv('dash-swatch-check');
				setIcon(check, 'check');
				item.style.setProperty('--col-color', c);
				colorBadge.style.setProperty('background-color', c);
				await this.plugin.saveSettings();
			};
			// Checkmark for selected
			if (col.color === c) {
				const check = swatch.createDiv('dash-swatch-check');
				setIcon(check, 'check');
			}
		});

		// Custom Color Picker for Collection
		new Setting(editor)
			.setName('Custom Collection Color')
			.addColorPicker(cp => cp
				.setValue(col.color)
				.onChange(async v => {
					col.color = v;
					swatchRow.querySelectorAll('.dash-color-swatch').forEach(s => s.removeClass('active'));
					item.style.setProperty('--col-color', v);
					colorBadge.style.setProperty('background-color', v);
					await this.plugin.saveSettings();
				})
			);

		// ── Scan Mode ─────────────────────────────────────────────────────────
		new Setting(editor)
			.setName('Scan Mode')
			.addDropdown(d => {
				d.addOption('folder', 'Folder Path');
				d.addOption('type-field', 'Frontmatter Type Field');
				d.setValue(col.scanMode);
				d.onChange(async v => {
					col.scanMode = v as 'folder' | 'type-field';
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (col.scanMode === 'folder') {
			new Setting(editor)
				.setName('Folder Path')
				.setDesc('Vault-relative path (e.g. Media/Books/)')
				.addText(t => {
					t.setPlaceholder('Media/Books/')
						.setValue(col.folderPath ?? '')
						.onChange(async v => {
							col.folderPath = v.trim();
							await this.plugin.saveSettings();
						});
					new FolderSuggest(this.app, t.inputEl);
				});
		} else {
			new Setting(editor)
				.setName('Type Field')
				.setDesc('Frontmatter field used to identify type (default: type)')
				.addText(t => t.setPlaceholder('type').setValue(col.typeField ?? 'type')
					.onChange(async v => {
						col.typeField = v.trim() || 'type';
						await this.plugin.saveSettings();
					}));

			new Setting(editor)
				.setName('Type Value')
				.setDesc('Value that identifies notes of this collection (e.g. book)')
				.addText(t => t.setPlaceholder('book').setValue(col.typeValue ?? '')
					.onChange(async v => {
						col.typeValue = v.trim();
						await this.plugin.saveSettings();
					}));
		}

		// ── Date Fields (Prorating) ───────────────────────────────────────────
		new Setting(editor)
			.setName('Start Date Field (Optional)')
			.setDesc('Used for Time-Span (prorating) logic in Year in Review mode.')
			.addText(t => t.setPlaceholder('startDate').setValue(col.startDateField ?? '')
				.onChange(async v => {
					col.startDateField = v.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(editor)
			.setName('End Date Field (Optional)')
			.setDesc('Used as the primary completion date or end bound in Time-Span logic.')
			.addText(t => t.setPlaceholder('endDate').setValue(col.endDateField ?? '')
				.onChange(async v => {
					col.endDateField = v.trim();
					await this.plugin.saveSettings();
				}));

		// ── Year in Review Filter ─────────────────────────────────────────────
		new Setting(editor)
			.setName('Year in Review — Filter Field')
			.setDesc('When set, only records where this field matches the value below will appear in Year in Review (e.g. "status", "progress"). Leave blank to use ALL records.')
			.addText(t => t.setPlaceholder('status (e.g.)').setValue(col.yearFilterField ?? '')
				.onChange(async v => {
					col.yearFilterField = v.trim() || undefined;
					await this.plugin.saveSettings();
				}));

		new Setting(editor)
			.setName('Year in Review — Required Value')
			.setDesc('The value the filter field must equal (e.g. "true", "completed"). Leave blank to only require the field to be truthy/present.')
			.addText(t => t.setPlaceholder('true').setValue(col.yearFilterValue ?? '')
				.onChange(async v => {
					col.yearFilterValue = v.trim() || undefined;
					await this.plugin.saveSettings();
				}));

		// ── Schema Scan ───────────────────────────────────────────────────────
		const scanSetting = new Setting(editor)
			.setName('Schema')
			.setDesc(col.schema.length
				? `${col.schema.length} fields discovered. Re-scan after adding new notes.`
				: 'No schema yet. Scan to discover available fields for widgets.');

		scanSetting.addButton(btn => {
			btn.setButtonText('Scan Schema').setCta();
			btn.onClick(async () => {
				btn.setButtonText('Scanning…').setDisabled(true);
				try {
					const scanner = new SchemaScanner(this.app);
					col.schema = await scanner.scan(col);
					await this.plugin.saveSettings();
					new Notice(`Found ${col.schema.length} fields in "${col.name}".`);
				} catch (e) {
					new Notice(`Scan failed: ${String(e)}`);
				} finally {
					this.display();
				}
			});
		});

		if (col.schema.length) {
			const preview = editor.createDiv('dash-schema-preview');
			col.schema.slice(0, 20).forEach(f => {
				const chip = preview.createDiv('dash-schema-chip');
				chip.createSpan({ text: f.key, cls: 'dash-schema-key' });
				chip.createSpan({ text: `${f.type} · ${Math.round(f.coverage * 100)}%`, cls: 'dash-schema-meta' });
			});
			if (col.schema.length > 20) {
				preview.createDiv({ text: `+ ${col.schema.length - 20} more fields`, cls: 'dash-schema-more' });
			}
		}

		// ── Note Detail Panel Customization ──────────────────────────────────
		new Setting(editor)
			.setName('Note Detail & Highlights')
			.setDesc('Customize quick status toggle buttons and up to 8 highlight properties displayed in the note overview popup.')
			.addButton(btn => {
				btn.setButtonText('Customize Note Detail')
					.setIcon('sliders-horizontal')
					.onClick(() => {
						new NoteDetailCustomizeModal(
							this.app,
							col,
							async () => {
								await this.plugin.saveSettings();
							},
							() => {
								this.display();
							}
						).open();
					});
			});
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private makeNewCollection(): CollectionConfig {
		const usedColors = new Set(this.plugin.settings.collections.map(c => c.color));
		const color = COLLECTION_COLORS.find(c => !usedColors.has(c)) ?? COLLECTION_COLORS[0];
		return {
			id: uid(),
			name: 'New Collection',
			icon: 'folder',
			color,
			scanMode: 'type-field',
			typeField: 'type',
			typeValue: '',
			schema: [],
			yearWidgets: [],
			libraryWidgets: [],
		};
	}
}

function uid(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function validateSettings(parsed: unknown): void {
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Config must be a JSON object.');
	}
	const data = parsed as Record<string, unknown>;
	if (!Array.isArray(data.collections)) {
		throw new Error('Config is missing the "collections" list.');
	}
	const collections = data.collections as unknown[];
	for (let i = 0; i < collections.length; i++) {
		const col = collections[i];
		if (!col || typeof col !== 'object') {
			throw new Error(`Collection at index ${i} is not a valid object.`);
		}
		const cMap = col as Record<string, unknown>;
		const colId = cMap.id;
		if (typeof colId !== 'string' || !colId.trim()) {
			throw new Error(`Collection at index ${i} is missing a unique "id".`);
		}
		const colName = cMap.name;
		if (typeof colName !== 'string' || !colName.trim()) {
			throw new Error(`Collection "${colId || i}" is missing a valid "name".`);
		}
		const scanMode = cMap.scanMode;
		if (scanMode !== 'folder' && scanMode !== 'type-field') {
			throw new Error(`Collection "${colName}" has invalid scanMode: "${scanMode}".`);
		}
		const libraryWidgets = cMap.libraryWidgets;
		if (libraryWidgets && !Array.isArray(libraryWidgets)) {
			throw new Error(`Collection "${colName}" "libraryWidgets" must be a list.`);
		}
		const yearWidgets = cMap.yearWidgets;
		if (yearWidgets && !Array.isArray(yearWidgets)) {
			throw new Error(`Collection "${colName}" "yearWidgets" must be a list.`);
		}
		
		const validateWidget = (w: unknown, idx: number, listName: string) => {
			if (!w || typeof w !== 'object') {
				throw new Error(`Widget at index ${idx} in "${colName}" ${listName} is not a valid object.`);
			}
			const wMap = w as Record<string, unknown>;
			const wId = wMap.id;
			if (typeof wId !== 'string' || !wId.trim()) {
				throw new Error(`Widget at index ${idx} in "${colName}" ${listName} is missing a valid "id".`);
			}
			const wType = wMap.type;
			if (typeof wType !== 'string' || !wType.trim()) {
				throw new Error(`Widget "${wId}" in "${colName}" is missing a valid "type".`);
			}
			const wTitle = wMap.title;
			if (typeof wTitle !== 'string') {
				throw new Error(`Widget "${wId}" in "${colName}" has an invalid "title".`);
			}
		};

		if (Array.isArray(libraryWidgets)) {
			libraryWidgets.forEach((w: unknown, idx: number) => validateWidget(w, idx, 'libraryWidgets'));
		}
		if (Array.isArray(yearWidgets)) {
			yearWidgets.forEach((w: unknown, idx: number) => validateWidget(w, idx, 'yearWidgets'));
		}
	}
}
