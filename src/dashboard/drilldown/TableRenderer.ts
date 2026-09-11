import { App, setIcon } from 'obsidian';
import type { RawRecord, CollectionConfig, DrilldownConfig } from '../../types';
import { NoteDetailModal } from '../../modals/NoteDetailModal';

export class TableRenderer {
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

		const tableWrap = container.createDiv('dash-drilldown-table-wrap');
		const table = tableWrap.createEl('table', { cls: 'dash-drilldown-table' });

		// Header
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: 'Title', attr: { scope: 'col' } });
		fields.forEach(f => headRow.createEl('th', { text: f, attr: { scope: 'col' } }));
		headRow.createEl('th', { text: '', cls: 'dash-drilldown-table-th-actions', attr: { scope: 'col' } });

		// Body
		const tbody = table.createEl('tbody');

		let renderedCount = 0;
		const batchSize = 30;

		const renderNextBatch = () => {
			const batch = records.slice(renderedCount, renderedCount + batchSize);
			for (const rec of batch) {
				const row = tbody.createEl('tr', {
					cls: 'dash-drilldown-table-row',
					attr: { tabindex: '0', role: 'button', 'aria-label': `View details for ${rec.title}` }
				});
				row.onclick = () => {
					new NoteDetailModal(app, rec, col, onRecordUpdated, onOpenNote ? () => onOpenNote(rec.filePath) : undefined, onSaveConfig).open();
				};
				row.onkeydown = (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						row.click();
					}
				};
				row.createEl('td', { text: rec.title, cls: 'dash-drilldown-table-title' });
				for (const key of fields) {
					const val = rec.fields[key];
					const displayVal = val === undefined || val === null ? '—'
						: Array.isArray(val) ? val.join(', ')
						: String(val);
					row.createEl('td', { text: displayVal });
				}

				const actionTd = row.createEl('td', { cls: 'dash-drilldown-table-td-actions' });
				const openBtn = actionTd.createEl('button', {
					cls: 'dash-drilldown-table-open-btn',
					attr: { 'aria-label': 'Open Note in Tab', title: 'Open Note' }
				});
				setIcon(openBtn, 'external-link');
				openBtn.onclick = (e) => {
					e.stopPropagation();
					if (onOpenNote) {
						onOpenNote(rec.filePath);
					} else {
						void app.workspace.openLinkText(rec.filePath, '', true);
					}
				};
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
