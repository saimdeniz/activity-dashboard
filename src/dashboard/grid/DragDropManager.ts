import type { CollectionConfig, DashboardSettings } from '../../types';

export class DragDropManager {
	private dragY = -1;
	private autoScrollRaf: number | null = null;
	private lastDragTime = 0;

	constructor(private containerEl: HTMLElement) {}

	startAutoScroll(): void {
		this.lastDragTime = Date.now();
		if (this.autoScrollRaf) return;
		const loop = () => {
			// Automatically stop RAF loop if no drag activity received in 500ms (e.g. drag cancelled/aborted)
			if (Date.now() - this.lastDragTime > 500) {
				this.stopAutoScroll();
				return;
			}
			if (this.dragY !== -1) {
				const rect = this.containerEl.getBoundingClientRect();
				const threshold = 60; // 60px from the screen edge
				if (this.dragY >= rect.top && this.dragY - rect.top < threshold) {
					this.containerEl.scrollTop -= 15;
				} else if (this.dragY <= rect.bottom && rect.bottom - this.dragY < threshold) {
					this.containerEl.scrollTop += 15;
				}
			}
			this.autoScrollRaf = window.requestAnimationFrame(loop);
		};
		loop();
	}

	stopAutoScroll(): void {
		if (this.autoScrollRaf) window.cancelAnimationFrame(this.autoScrollRaf);
		this.autoScrollRaf = null;
		this.dragY = -1;
	}

	setDragY(y: number): void {
		this.dragY = y;
		this.lastDragTime = Date.now();
	}

	/** Attach lightweight drag events to an overview card */
	attachOverviewDragEvents(
		card: HTMLElement,
		itemId: string,
		settings: DashboardSettings,
		saveQuiet: () => Promise<void>
	): void {
		let dragSrcId: string | null = null;

		card.addEventListener('dragstart', (e) => {
			dragSrcId = itemId;
			card.addClass('dash-dragging');
			e.dataTransfer?.setData('text/plain', itemId);
		});
		card.addEventListener('dragend', () => {
			dragSrcId = null;
			card.removeClass('dash-dragging');
			(card.ownerDocument || document).querySelectorAll('.dash-drag-over').forEach(el => el.removeClass('dash-drag-over'));
		});
		card.addEventListener('dragover', (e) => {
			e.preventDefault();
			const srcId = e.dataTransfer?.getData('text/plain') || dragSrcId;
			if (srcId && srcId !== itemId) card.addClass('dash-drag-over');
		});
		card.addEventListener('dragleave', () => card.removeClass('dash-drag-over'));
		card.addEventListener('drop', (e) => {
			e.preventDefault();
			card.removeClass('dash-drag-over');
			const srcId = e.dataTransfer?.getData('text/plain') || dragSrcId;
			if (!srcId || srcId === itemId) return;

			const layout2 = settings.overviewLayout;
			if (!layout2) return;
			const fromIdx = layout2.findIndex(i => i.id === srcId);
			const toIdx   = layout2.findIndex(i => i.id === itemId);
			if (fromIdx === -1 || toIdx === -1) return;

			const [moved] = layout2.splice(fromIdx, 1);
			layout2.splice(toIdx, 0, moved);
			settings.overviewLayout = layout2;
			void saveQuiet().then(() => {
				const grid = card.parentElement;
				if (grid) {
					const draggedEl = grid.querySelector(`[data-widget-id="${CSS.escape(srcId)}"]`) as HTMLElement;
					if (draggedEl) {
						if (fromIdx < toIdx) {
							card.after(draggedEl);
						} else {
							card.before(draggedEl);
						}
					}
				}
			}).catch(err => console.error('[ActivityDashboard] Save failed:', err));
		});
	}

	/** Attach drag events to a collection widget card */
	attachCollectionDragEvents(
		card: HTMLElement,
		widgetId: string,
		col: CollectionConfig,
		activeMode: 'year' | 'library' | 'month',
		saveQuiet: () => Promise<void>
	): void {
		let dragSrcId: string | null = null;

		card.addEventListener('dragstart', (e) => {
			dragSrcId = widgetId;
			card.addClass('dash-dragging');
			e.dataTransfer?.setData('text/plain', widgetId);
		});
		card.addEventListener('dragend', () => {
			dragSrcId = null;
			card.removeClass('dash-dragging');
			(card.ownerDocument || document).querySelectorAll('.dash-drag-over').forEach(el => el.removeClass('dash-drag-over'));
		});
		card.addEventListener('dragover', (e) => {
			e.preventDefault();
			const srcId = e.dataTransfer?.getData('text/plain') || dragSrcId;
			if (srcId && srcId !== widgetId) card.addClass('dash-drag-over');
		});
		card.addEventListener('dragleave', () => card.removeClass('dash-drag-over'));
		card.addEventListener('drop', (e) => {
			e.preventDefault();
			card.removeClass('dash-drag-over');
			const srcId = e.dataTransfer?.getData('text/plain') || dragSrcId;
			if (!srcId || srcId === widgetId) return;

			const activeWidgets = activeMode === 'library'
				? (col.libraryWidgets || [])
				: activeMode === 'month'
					? (col.monthWidgets && col.monthWidgets.length ? col.monthWidgets : (col.yearWidgets || []))
					: (col.yearWidgets || []);
			const widgets = [...activeWidgets];
			const fromIdx = widgets.findIndex(w => w.id === srcId);
			const toIdx = widgets.findIndex(w => w.id === widgetId);
			if (fromIdx === -1 || toIdx === -1) return;

			const [item] = widgets.splice(fromIdx, 1);
			widgets.splice(toIdx, 0, item);
			
			if (activeMode === 'library') {
				col.libraryWidgets = widgets;
			} else if (activeMode === 'month') {
				col.monthWidgets = widgets;
			} else {
				col.yearWidgets = widgets;
			}

			void saveQuiet().then(() => {
				const grid = card.parentElement;
				if (grid) {
					const draggedEl = grid.querySelector(`[data-widget-id="${CSS.escape(srcId)}"]`) as HTMLElement;
					if (draggedEl) {
						if (fromIdx < toIdx) {
							card.after(draggedEl);
						} else {
							card.before(draggedEl);
						}
					}
				}
			}).catch(err => console.error('[ActivityDashboard] Save failed:', err));
		});
	}
}
