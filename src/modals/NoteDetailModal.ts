import { Modal, App, TFile, Notice, setIcon } from 'obsidian';
import type { RawRecord, CollectionConfig } from '../types';
import { getAdaptiveForeground, hexToRgbString, getContrastTextColor } from '../utils/ColorUtils';
import { resolveImageSrc } from '../dashboard/drilldown/CardRenderer';
import { NoteEditModal } from './NoteEditModal';
import { NoteDetailCustomizeModal } from './NoteDetailCustomizeModal';

function isFieldEmpty(val: unknown): boolean {
	if (val === undefined || val === null) return true;
	if (typeof val === 'boolean') return false;
	if (typeof val === 'number') return isNaN(val) || val === 0;
	if (typeof val === 'string') {
		const s = val.replace(/[\s\u00A0\u200B\uFEFF]/g, '').toLowerCase();
		return s === '' || s === '""' || s === "''" || s === '—' || s === '-' || s === 'null' || s === 'undefined' || s === '[]' || s === '{}';
	}
	if (Array.isArray(val)) return val.length === 0 || val.every(v => isFieldEmpty(v));
	if (typeof val === 'object') return Object.keys(val).length === 0;
	return false;
}

export class NoteDetailModal extends Modal {
	constructor(
		app: App,
		private rec: RawRecord,
		private col: CollectionConfig,
		private onSaved?: () => void | Promise<void>,
		private onOpenNote?: () => void,
		private onSaveConfig?: () => Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		this.containerEl.setCssStyles({ zIndex: '3500' });
		this.modalEl.addClass('dash-modal-dialog', 'dash-note-detail-dialog');

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dash-note-detail-modal');

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

		const fields = this.rec.fields;

		// ── Image resolution ──────────────────────────────────────
		let imageSrc: string | null = null;
		const imgKey = this.col.drilldownConfig?.imageField
			|| ['cover', 'image', 'poster', 'thumbnail', 'banner', 'goodreadsImage'].find(k => {
				const v = fields[k];
				return v && typeof v === 'string' && !v.endsWith('Ratio') &&
					(v.startsWith('http') || v.startsWith('[[') || /\.(jpg|jpeg|png|webp|gif)$/i.test(v));
			});

		if (imgKey && fields[imgKey]) {
			imageSrc = resolveImageSrc(this.app, String(fields[imgKey]));
		}

		// ── External links ────────────────────────────────────────
		const links = this.extractExternalLinks(fields);

		// ── Status pill options (Customizable) ────────────────────
		const cfgStatusField = this.col.noteDetailConfig?.statusField;
		let statusKey: string | undefined = undefined;

		if (cfgStatusField === '__none__') {
			statusKey = undefined;
		} else if (cfgStatusField && cfgStatusField.trim()) {
			statusKey = cfgStatusField.trim();
		} else {
			statusKey = ['status', 'ownership', 'playstate', 'readStatus', 'reading_status', 'state', 'condition']
				.find(k => !isFieldEmpty(fields[k]));
		}

		// ── Categorized list properties ───────────────────────────
		const listEntries = this.extractListProperties(fields, [imgKey || '']);

		// ── Additional scalar props ───────────────────────────────
		const listKeys = listEntries.map(e => e.key);
		const additionalProps = this.extractAdditionalProperties(fields, listKeys, imgKey || '');

		// ══════════════════════════════════════════════════════════
		// LAYOUT: topbar (fixed) + body (scrollable)
		// ══════════════════════════════════════════════════════════

		// ── Top bar (title + actions) ─────────────────────────────
		const topbar = contentEl.createDiv('ndm-topbar');

		const topbarLeft = topbar.createDiv('ndm-topbar-left');
		topbarLeft.createEl('h2', { text: this.rec.title, cls: 'ndm-title', attr: { title: this.rec.title } });

		// Metadata badges row beneath title
		const metaRow = topbarLeft.createDiv('ndm-meta-row');
		const badges = metaRow.createDiv('ndm-badges');
		const creator = fields.author || fields.authors || fields.developers || fields.developer
			|| fields.publishers || fields.publisher || fields.artist || fields.director;
		if (!isFieldEmpty(creator)) {
			const text = Array.isArray(creator) ? String(creator[0] ?? '') : String(creator);
			if (text.trim()) {
				const b = badges.createDiv('ndm-badge');
				setIcon(b.createSpan(), 'user');
				b.createSpan({ text: text.trim() });
			}
		}
		const releaseVal = fields.releaseDate || fields.released || fields.year || fields.date || fields.published || fields.publishedFrom;
		if (!isFieldEmpty(releaseVal)) {
			const yr = String(releaseVal).slice(0, 4);
			if (/^\d{4}$/.test(yr)) {
				const b = badges.createDiv('ndm-badge');
				setIcon(b.createSpan(), 'calendar');
				b.createSpan({ text: yr });
			}
		}
		const scoreVal = fields.onlineRating || fields.rating || fields.score || fields.puan;
		if (!isFieldEmpty(scoreVal)) {
			const rNum = typeof scoreVal === 'number' ? scoreVal : parseFloat(String(scoreVal));
			if (!isNaN(rNum) && rNum > 0) {
				const b = badges.createDiv('ndm-badge ndm-badge-gold');
				setIcon(b.createSpan(), 'star');
				b.createSpan({ text: rNum <= 10 ? `${rNum} / 10` : `${rNum} / 100` });
			}
		}

		const linksPosition = this.col.noteDetailConfig?.linksPosition ?? 'cover';

		// Top bar primary action controls (Customize, Open Note, Edit, and Optional Links Dropdown)
		const topbarActions = topbar.createDiv('ndm-topbar-actions');
		const actionGroup = topbarActions.createDiv('ndm-action-group');

		// Topbar Links Dropdown (if configured as 'topbar' and links exist)
		if (links.length > 0 && linksPosition === 'topbar') {
			const linksDropWrap = actionGroup.createDiv('dash-custom-dropdown ndm-links-dropdown-wrap');
			const linksDropBtn = linksDropWrap.createEl('button', {
				cls: 'ndm-links-dropdown-btn',
				attr: { title: 'External Web Links' }
			});
			setIcon(linksDropBtn.createSpan('ndm-btn-icon'), 'link');
			linksDropBtn.createSpan({ text: `Links (${links.length})` });
			const arrow = linksDropBtn.createSpan('ndm-links-arrow');
			setIcon(arrow, 'chevron-down');

			const linksDropList = linksDropWrap.createDiv('ndm-links-dropdown-menu hidden');
			links.forEach(lnk => {
				const item = linksDropList.createEl('a', {
					cls: 'ndm-links-dropdown-item',
					attr: { href: lnk.url, target: '_blank', rel: 'noopener noreferrer' }
				});
				const left = item.createDiv('ndm-links-dropdown-left');
				setIcon(left.createSpan('ndm-links-dropdown-icon'), lnk.icon);
				left.createSpan({ text: lnk.label });
				item.createSpan({ text: '↗', cls: 'ndm-links-dropdown-arrow' });
				item.onclick = (e) => {
					e.stopPropagation();
					linksDropList.addClass('hidden');
					linksDropBtn.removeClass('open');
				};
			});

			linksDropBtn.onclick = (e) => {
				e.stopPropagation();
				const isOpen = !linksDropList.hasClass('hidden');
				if (isOpen) {
					linksDropList.addClass('hidden');
					linksDropBtn.removeClass('open');
				} else {
					linksDropList.removeClass('hidden');
					linksDropBtn.addClass('open');
				}
			};
		}

		// Customize button
		const custBtn = actionGroup.createEl('button', {
			cls: 'ndm-action-tool-btn',
			attr: { title: 'Customize highlights and quick buttons' }
		});
		setIcon(custBtn.createSpan('ndm-btn-icon'), 'sliders-horizontal');
		custBtn.createSpan({ text: 'Customize' });
		custBtn.onclick = () => {
			const saveFn = async () => {
				if (this.onSaveConfig) await this.onSaveConfig();
				else {
					const plugin = (this.app as unknown as { plugins?: { getPlugin: (id: string) => { saveSettings: () => Promise<void> } } })
						.plugins?.getPlugin('activity-dashboard');
					if (plugin) await plugin.saveSettings();
				}
			};
			new NoteDetailCustomizeModal(this.app, this.col, saveFn, () => {
				this.close();
				new NoteDetailModal(this.app, this.rec, this.col, this.onSaved, this.onOpenNote, this.onSaveConfig).open();
			}).open();
		};

		// Open Note button
		const noteBtn = actionGroup.createEl('button', {
			cls: 'ndm-action-tool-btn',
			attr: { title: 'Open Note in Obsidian Tab' }
		});
		setIcon(noteBtn.createSpan('ndm-btn-icon'), 'file-text');
		noteBtn.createSpan({ text: 'Open Note' });
		noteBtn.onclick = () => {
			this.close();
			if (this.onOpenNote) this.onOpenNote();
			else void this.app.workspace.openLinkText(this.rec.filePath, '', true);
		};

		// Edit button (Prominent Primary CTA)
		const editBtn = actionGroup.createEl('button', {
			cls: 'ndm-action-primary-btn',
			attr: { title: 'Edit frontmatter properties' }
		});
		setIcon(editBtn.createSpan('ndm-btn-icon'), 'edit-3');
		editBtn.createSpan({ text: 'Edit' });
		editBtn.onclick = () => {
			this.close();
			new NoteEditModal(this.app, this.rec, this.col,
				async () => { if (this.onSaved) await this.onSaved(); },
				this.onOpenNote,
				() => { new NoteDetailModal(this.app, this.rec, this.col, this.onSaved, this.onOpenNote, this.onSaveConfig).open(); }
			).open();
		};

		// ── Scrollable body ───────────────────────────────────────
		const body = contentEl.createDiv('ndm-body');

		// ── Hero section (cover left, status right, fixed height) ──
		const hero = body.createDiv('ndm-hero');

		// Cover Column (Poster + Quick External Links underneath)
		const coverCol = hero.createDiv('ndm-cover-col');
		const coverBox = coverCol.createDiv('ndm-cover-box');
		if (imageSrc) {
			coverBox.createEl('img', { cls: 'ndm-cover-img', attr: { src: imageSrc, loading: 'lazy' } });
		} else {
			const ph = coverBox.createDiv('ndm-cover-placeholder');
			setIcon(ph, this.col.icon || 'file-text');
		}

		// Dedicated Under-Cover Link Bar (only when linksPosition is 'cover')
		if (links.length > 0 && linksPosition === 'cover') {
			const linksWrap = coverCol.createDiv('ndm-cover-links');
			links.forEach(lnk => {
				const linkBtn = linksWrap.createEl('button', {
					cls: 'ndm-cover-link-btn',
					attr: { title: `Open in ${lnk.label}` }
				});
				const left = linkBtn.createDiv('ndm-cover-link-left');
				setIcon(left.createSpan('ndm-cover-link-icon'), lnk.icon);
				left.createSpan({ text: lnk.label, cls: 'ndm-cover-link-text' });
				linkBtn.createSpan({ text: '↗', cls: 'ndm-cover-link-arrow' });
				linkBtn.onclick = (e) => {
					e.stopPropagation();
					window.open(lnk.url, '_blank');
				};
			});
		}

		// Hero info panel (status + highlights)
		const heroInfo = hero.createDiv('ndm-hero-info');

		// Status pills (if present and not disabled)
		if (statusKey) {
			const statusBlock = heroInfo.createDiv('ndm-status-block');
			statusBlock.createDiv({ text: statusKey.toUpperCase(), cls: 'ndm-field-label' });
			const pillRow = statusBlock.createDiv('ndm-pill-row');

			const rawVal = fields[statusKey];
			let currentValues: string[] = [];
			if (Array.isArray(rawVal)) {
				currentValues = rawVal.map(v => String(v).trim()).filter(Boolean);
			} else if (typeof rawVal === 'string' && (rawVal.includes(',') || rawVal.includes('|'))) {
				currentValues = rawVal.split(/[,|]/).map(s => s.trim()).filter(Boolean);
			} else if (!isFieldEmpty(rawVal)) {
				currentValues = [String(rawVal).trim()];
			}

			const customOptions = this.col.noteDetailConfig?.statusOptions;
			let rawOptions: string[] = [];

			if (customOptions && customOptions.length > 0) {
				rawOptions = [...customOptions];
			} else {
				const schemaField = (this.col.schema || []).find(s => s.key.toLowerCase() === statusKey.toLowerCase());
				rawOptions = schemaField?.sampleValues && schemaField.sampleValues.length > 0 ? [...schemaField.sampleValues] : [];

				if (rawOptions.length === 0) {
					if (/read/i.test(statusKey)) rawOptions = ['Read', 'Reading', 'Want to Read', 'DNF'];
					else if (/play/i.test(statusKey)) rawOptions = ['Playing', 'Completed', 'Backlog', 'Abandoned'];
					else if (/owner/i.test(statusKey)) rawOptions = ['Owned', 'Wishlist', 'Subscribed', 'Borrowed'];
					else if (currentValues.length > 0) rawOptions = [...currentValues];
				}
			}

			// Flatten and split any comma/pipe separated option strings
			const flattenedOptions: string[] = [];
			rawOptions.forEach(opt => {
				if (typeof opt === 'string' && (opt.includes(',') || opt.includes('|'))) {
					flattenedOptions.push(...opt.split(/[,|]/).map(s => s.trim()).filter(Boolean));
				} else if (opt && String(opt).trim()) {
					flattenedOptions.push(String(opt).trim());
				}
			});

			let options = Array.from(new Set(flattenedOptions));

			currentValues.forEach(cv => {
				if (!options.some(o => o.toLowerCase() === cv.toLowerCase())) {
					options.push(cv);
				}
			});

			options.slice(0, 10).forEach(opt => {
				const isActive = currentValues.some(cv => cv.toLowerCase() === opt.toLowerCase());
				const pill = pillRow.createEl('button', {
					cls: `ndm-pill ${isActive ? 'ndm-pill-active' : ''}`,
					text: opt
				});
				pill.onclick = async () => {
					if (Array.isArray(rawVal)) {
						let updated: string[];
						if (currentValues.some(cv => cv.toLowerCase() === opt.toLowerCase())) {
							updated = currentValues.filter(cv => cv.toLowerCase() !== opt.toLowerCase());
							pill.removeClass('ndm-pill-active');
						} else {
							updated = [...currentValues, opt];
							pill.addClass('ndm-pill-active');
						}
						currentValues = updated;
						await this.updateSingleProperty(statusKey, updated);
					} else if (typeof rawVal === 'string' && (rawVal.includes(',') || rawVal.includes('|'))) {
						let updated: string[];
						if (currentValues.some(cv => cv.toLowerCase() === opt.toLowerCase())) {
							updated = currentValues.filter(cv => cv.toLowerCase() !== opt.toLowerCase());
							pill.removeClass('ndm-pill-active');
						} else {
							updated = [...currentValues, opt];
							pill.addClass('ndm-pill-active');
						}
						currentValues = updated;
						await this.updateSingleProperty(statusKey, updated.join(', '));
					} else {
						if (currentValues.some(cv => cv.toLowerCase() === opt.toLowerCase())) {
							currentValues = [];
							pill.removeClass('ndm-pill-active');
							await this.updateSingleProperty(statusKey, '');
						} else {
							currentValues = [opt];
							pillRow.querySelectorAll('.ndm-pill').forEach(p => p.removeClass('ndm-pill-active'));
							pill.addClass('ndm-pill-active');
							await this.updateSingleProperty(statusKey, opt);
						}
					}
				};
			});
		}

		// Highlights grid (Customizable up to 8 items)
		const customHighlights = (this.col.noteDetailConfig?.highlightFields || []).filter(f => !isFieldEmpty(fields[f]));
		const pinnedFields = (this.col.drilldownConfig?.fields || []).filter(f => !isFieldEmpty(fields[f]));
		const autoFields: string[] = [];

		if (customHighlights.length === 0 && pinnedFields.length === 0) {
			for (const [k, v] of Object.entries(fields)) {
				if (k.startsWith('_') || k === 'position' || k.toLowerCase() === 'title') continue;
				if (isFieldEmpty(v)) continue;
				if (typeof v === 'string' && (v.startsWith('http') || /\.(jpg|png|webp|jpeg)/i.test(v))) continue;
				if (Array.isArray(v)) continue;
				autoFields.push(k);
				if (autoFields.length >= 8) break;
			}
		}

		let highlightFields: string[] = [];
		if (customHighlights.length > 0) {
			highlightFields = customHighlights.slice(0, 8);
		} else if (pinnedFields.length > 0) {
			highlightFields = pinnedFields.slice(0, 8);
		} else {
			highlightFields = autoFields.slice(0, 8);
		}

		if (highlightFields.length > 0) {
			const hlBlock = heroInfo.createDiv('ndm-highlights-block');
			const colName = this.col.name ? this.col.name.toUpperCase() : '';
			hlBlock.createDiv({ text: colName ? `${colName} HIGHLIGHTS` : 'KEY HIGHLIGHTS', cls: 'ndm-field-label' });
			const hlGrid = hlBlock.createDiv('ndm-highlights-grid');
			highlightFields.forEach(key => {
				const val = fields[key];
				const displayVal = typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val);
				const cell = hlGrid.createDiv('ndm-highlight-cell');
				cell.createDiv({ text: key.toUpperCase(), cls: 'ndm-hl-label' });
				cell.createDiv({ text: displayVal, cls: 'ndm-hl-val', attr: { title: displayVal } });
			});
		}

		// ── Categories & Lists ────────────────────────────────────
		if (listEntries.length > 0) {
			const catSection = body.createDiv('ndm-section');
			catSection.createDiv({ text: 'CATEGORIES & LISTS', cls: 'ndm-section-title' });

			listEntries.forEach(entry => {
				const row = catSection.createDiv('ndm-cat-row');
				const labelEl = row.createDiv('ndm-cat-label');
				setIcon(labelEl.createSpan('ndm-cat-icon'), entry.icon);
				labelEl.createSpan({ text: entry.key.toUpperCase() });

				const pillWrap = row.createDiv('ndm-cat-pills');
				entry.values.forEach(v => {
					pillWrap.createDiv({ text: v, cls: 'ndm-tag' });
				});
			});
		}

		// ── Additional Properties ─────────────────────────────────
		if (additionalProps.length > 0) {
			const propSection = body.createDiv('ndm-section');
			propSection.createDiv({ text: 'ADDITIONAL PROPERTIES', cls: 'ndm-section-title' });

			const propTable = propSection.createDiv('ndm-prop-table');
			additionalProps.forEach(([k, v]) => {
				const row = propTable.createDiv('ndm-prop-row');
				row.createDiv({ text: k, cls: 'ndm-prop-key' });
				const valEl = row.createDiv('ndm-prop-val');

				if (typeof v === 'boolean') {
					valEl.createSpan({ text: v ? 'true' : 'false', cls: `ndm-bool ${v ? 'ndm-bool-true' : 'ndm-bool-false'}` });
				} else if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
					const a = valEl.createEl('a', { text: v, cls: 'ndm-link', attr: { href: v, target: '_blank' } });
					a.onclick = e => { e.stopPropagation(); window.open(v, '_blank'); };
				} else {
					valEl.createSpan({ text: String(v) });
				}
			});
		}
	}

	private async updateSingleProperty(key: string, value: unknown): Promise<void> {
		const tfile = this.app.vault.getAbstractFileByPath(this.rec.filePath);
		if (!(tfile instanceof TFile)) return;
		try {
			await this.app.fileManager.processFrontMatter(tfile, (fm: Record<string, unknown>) => { fm[key] = value; });
			this.rec.fields[key] = value;
			new Notice(`Updated ${key}: ${value}`);
			if (this.onSaved) await this.onSaved();
		} catch (err) {
			console.error('Failed to update frontmatter:', err);
		}
	}

	private extractExternalLinks(fields: Record<string, unknown>): { label: string; url: string; icon: string }[] {
		const links: { label: string; url: string; icon: string }[] = [];
		const seen = new Set<string>();
		for (const [key, val] of Object.entries(fields)) {
			if (isFieldEmpty(val)) continue;
			const s = String(val).trim();
			if (!/^https?:\/\//i.test(s)) continue;
			if (/\.(jpg|jpeg|png|webp|gif|svg|avif)($|\?)/i.test(s)) continue;
			const lk = key.toLowerCase(), lu = s.toLowerCase();
			let label = '', icon = 'external-link';
			if (lk.includes('steam') || lu.includes('steampowered.com')) { label = 'Steam'; }
			else if (lk.includes('hltb') || lu.includes('howlongtobeat.com')) { label = 'HLTB'; icon = 'clock'; }
			else if (lk.includes('goodreads') || lu.includes('goodreads.com')) { label = 'Goodreads'; icon = 'book-open'; }
			else if (lk.includes('imdb') || lu.includes('imdb.com')) { label = 'IMDb'; icon = 'film'; }
			else if (lk.includes('igdb') || lu.includes('igdb.com')) { label = 'IGDB'; }
			else if (lk.includes('itad') || lu.includes('isthereanydeal.com')) { label = 'ITAD'; icon = 'tag'; }
			else if (lk.includes('youtube') || lu.includes('youtube.com')) { label = 'YouTube'; icon = 'video'; }
			else { label = key.replace(/url$/i, '').toUpperCase() || 'Link'; }
			if (label && !seen.has(label)) { seen.add(label); links.push({ label, url: s, icon }); }
		}
		return links.slice(0, 4);
	}

	private extractListProperties(fields: Record<string, unknown>, excludeKeys: string[]): { key: string; values: string[]; icon: string }[] {
		const out: { key: string; values: string[]; icon: string }[] = [];
		const excl = new Set(excludeKeys.map(k => k.toLowerCase()));
		for (const [key, val] of Object.entries(fields)) {
			if (key.startsWith('_') || key === 'position' || excl.has(key.toLowerCase())) continue;
			if (isFieldEmpty(val)) continue;
			const lower = key.toLowerCase();
			let values: string[] = [];
			if (Array.isArray(val)) {
				values = val.map(v => String(v).trim()).filter(v => !isFieldEmpty(v));
			} else if (typeof val === 'string' && /genres|platforms|gamemodes|tags|series|cast|categories|authors|writers|artists|characters|themes|publishers|developers/i.test(lower) && (val.includes(',') || val.includes('|'))) {
				values = val.split(/[,|]/).map(s => s.trim()).filter(v => !isFieldEmpty(v));
			}
			if (values.length === 0) continue;
			let icon = 'tag';
			if (lower.includes('genre') || lower.includes('theme')) icon = 'bookmark';
			else if (lower.includes('platform')) icon = 'monitor';
			else if (lower.includes('mode') || lower.includes('character')) icon = 'users';
			else if (lower.includes('series') || lower.includes('franchise')) icon = 'book';
			else if (lower.includes('writer') || lower.includes('artist') || lower.includes('author')) icon = 'user';
			out.push({ key, values, icon });
		}
		return out;
	}

	private extractAdditionalProperties(fields: Record<string, unknown>, listKeys: string[], imgKey: string): [string, unknown][] {
		const excluded = new Set([
			'title', 'filepath', 'position', 'cover', 'image', 'poster', 'thumbnail', 'banner',
			imgKey.toLowerCase(),
			...listKeys.map(k => k.toLowerCase()),
			...(this.col.drilldownConfig?.fields || []).map(k => k.toLowerCase()),
			...(this.col.noteDetailConfig?.highlightFields || []).map(k => k.toLowerCase()),
		]);
		const out: [string, unknown][] = [];
		for (const [key, val] of Object.entries(fields)) {
			if (key.startsWith('_') || excluded.has(key.toLowerCase())) continue;
			if (isFieldEmpty(val)) continue;
			if (Array.isArray(val)) continue;
			out.push([key, val]);
		}
		return out;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
