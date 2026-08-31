import { App, TFile, setIcon } from 'obsidian';
import type { RawRecord, CollectionConfig, DrilldownConfig } from '../../types';
import { NoteDetailModal } from '../../modals/NoteDetailModal';
import { NoteEditModal } from '../../modals/NoteEditModal';

export function resolveImageSrc(app: App, raw: string): string | null {
	const s = raw.trim();
	if (/^https?:\/\//i.test(s)) return s;

	const wikiMatch = s.match(/^\[\[(.*?)(?:\]\]|\|)/);
	if (wikiMatch) {
		const innerPath = wikiMatch[1].trim();
		if (/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(innerPath)) {
			const file = app.metadataCache.getFirstLinkpathDest(innerPath, '') || app.vault.getAbstractFileByPath(innerPath);
			if (file instanceof TFile) {
				return app.vault.getResourcePath(file);
			}
		}
	}

	if (/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i.test(s)) {
		const file = app.metadataCache.getFirstLinkpathDest(s, '') || app.vault.getAbstractFileByPath(s);
		if (file instanceof TFile) return app.vault.getResourcePath(file);
	}

	return null;
}

export class CardRenderer {
	private observer: IntersectionObserver | null = null;

	cleanup(): void {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	render(
		app: App,
		container: HTMLElement,
		records: RawRecord[],
		col: CollectionConfig,
		dc: DrilldownConfig,
		fields: string[],
		onRecordUpdated?: () => void | Promise<void>,
		onOpenNote?: (filePath: string) => void,
		onSaveConfig?: () => Promise<void>
	): void {
		this.cleanup();

		const grid = container.createDiv('dash-drilldown-grid');
		grid.style.setProperty('--dd-card-min', `${dc.cardSize || 200}px`);

		let renderedCount = 0;
		const batchSize = 30;

		const renderNextBatch = () => {
			const batch = records.slice(renderedCount, renderedCount + batchSize);
			for (const rec of batch) {
				const card = grid.createDiv('dash-drilldown-card');
				card.onclick = () => {
					new NoteDetailModal(app, rec, col, onRecordUpdated, onOpenNote ? () => onOpenNote(rec.filePath) : undefined, onSaveConfig).open();
				};

				// Image resolution
				if (dc.imageField) {
					const rawImg = rec.fields[dc.imageField];
					const src = rawImg ? resolveImageSrc(app, String(rawImg)) : null;
					if (src) {
						const imgWrap = card.createDiv('dash-drilldown-img-wrap');
						imgWrap.style.setProperty('--dd-img-ratio', String(dc.imageAspectRatio || 1.0));
						const img = imgWrap.createEl('img', { cls: 'dash-drilldown-img', attr: { src, loading: 'lazy' } });
						img.style.setProperty('object-fit', dc.imageFit || 'cover');

						// Quick edit button on cover hover (top-left)
						const quickEditBtn = imgWrap.createEl('button', {
							cls: 'dash-drilldown-quick-edit',
							attr: { 'aria-label': 'Edit Note Properties', title: 'Quick Edit' }
						});
						setIcon(quickEditBtn, 'edit-3');
						quickEditBtn.onclick = (e) => {
							e.stopPropagation();
							new NoteEditModal(app, rec, col, onRecordUpdated, onOpenNote ? () => onOpenNote(rec.filePath) : undefined).open();
						};

						// Quick open button on cover hover (top-right)
						const quickOpenBtn = imgWrap.createEl('button', {
							cls: 'dash-drilldown-quick-open',
							attr: { 'aria-label': 'Open Note in Tab', title: 'Open Note' }
						});
						setIcon(quickOpenBtn, 'external-link');
						quickOpenBtn.onclick = (e) => {
							e.stopPropagation();
							if (onOpenNote) {
								onOpenNote(rec.filePath);
							} else {
								void app.workspace.openLinkText(rec.filePath, '', true);
							}
						};
					}
				}

				const titleEl = card.createDiv({ text: rec.title, cls: 'dash-drilldown-card-title' });
				titleEl.setAttribute('title', rec.title);
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
			renderedCount += batch.length;
		};

		renderNextBatch();

		if (renderedCount < records.length) {
			const sentinel = container.createDiv('dash-drilldown-sentinel');
			this.observer = new IntersectionObserver((entries) => {
				if (entries[0].isIntersecting) {
					renderNextBatch();
					if (renderedCount >= records.length) {
						sentinel.remove();
						this.cleanup();
					}
				}
			}, {
				rootMargin: '100px',
			});
			this.observer.observe(sentinel);
		}
	}
}
