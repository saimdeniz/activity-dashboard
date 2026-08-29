import type { WidgetSize } from '../../types';

const SPANS = [3, 4, 6, 9, 12] as const;

/**
 * Helper to update card size classes in-place without triggering a full re-render.
 */
export function applySizeClass(card: HTMLElement, size: WidgetSize): void {
	const toRemove = Array.from(card.classList).filter(c => 
		c.startsWith('dash-widget-s') || c.startsWith('dash-widget-h-')
	);
	toRemove.forEach(c => card.classList.remove(c));
	card.classList.add(`dash-widget-h-${size.height}`);
	card.classList.add(`dash-widget-s${size.span}`);
}

/**
 * Attaches snap-to-grid horizontal and vertical resize handles to a widget card.
 */
export function attachResizeHandles(
	card: HTMLElement,
	grid: HTMLElement,
	currentSize: WidgetSize,
	onResizeEnd: (newSize: WidgetSize) => Promise<void>,
	onRedrawCharts?: () => void
): void {
	// ── Snap-to-Grid right handle ──
	const resizeHandle = card.createDiv('dash-widget-resize-handle');
	resizeHandle.setAttribute('title', 'Drag to resize width');

	resizeHandle.addEventListener('mousedown', (startEv) => {
		startEv.preventDefault();
		startEv.stopPropagation();
		card.addClass('dash-resizing');
		const startX = startEv.clientX;
		const gridWidth = grid.offsetWidth;
		const colWidth = gridWidth / 12;
		const curSpan = currentSize.span;

		const onMove = (mv: MouseEvent) => {
			const dx = mv.clientX - startX;
			const targetCols = Math.round(curSpan + dx / colWidth);
			const snapped = SPANS.reduce((prev, cur) =>
				Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
			);
			card.style.setProperty('grid-column', `span ${snapped}`);
		};

		const onUp = (upEv: MouseEvent) => {
			activeDocument.removeEventListener('mousemove', onMove);
			activeDocument.removeEventListener('mouseup', onUp);
			card.removeClass('dash-resizing');
			card.style.removeProperty('grid-column');

			const dx = upEv.clientX - startX;
			const targetCols = Math.round(curSpan + dx / colWidth);
			const snapped = SPANS.reduce((prev, cur) =>
				Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
			);

			if (snapped !== curSpan) {
				currentSize.span = snapped;
				applySizeClass(card, currentSize);
				void onResizeEnd(currentSize).then(() => {
					if (onRedrawCharts) onRedrawCharts();
				});
			}
		};

		activeDocument.addEventListener('mousemove', onMove);
		activeDocument.addEventListener('mouseup', onUp);
	});

	// Touch support for right handle
	resizeHandle.addEventListener('touchstart', (startEv) => {
		if (startEv.touches.length !== 1) return;
		startEv.preventDefault();
		startEv.stopPropagation();
		card.addClass('dash-resizing');
		const startX = startEv.touches[0].clientX;
		const gridWidth = grid.offsetWidth;
		const colWidth = gridWidth / 12;
		const curSpan = currentSize.span;

		const onTouchMove = (mv: TouchEvent) => {
			if (mv.touches.length !== 1) return;
			const dx = mv.touches[0].clientX - startX;
			const targetCols = Math.round(curSpan + dx / colWidth);
			const snapped = SPANS.reduce((prev, cur) =>
				Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
			);
			card.style.setProperty('grid-column', `span ${snapped}`);
		};

		const onTouchEnd = (upEv: TouchEvent) => {
			activeDocument.removeEventListener('touchmove', onTouchMove);
			activeDocument.removeEventListener('touchend', onTouchEnd);
			card.removeClass('dash-resizing');
			card.style.removeProperty('grid-column');

			if (upEv.changedTouches.length === 0) return;
			const dx = upEv.changedTouches[0].clientX - startX;
			const targetCols = Math.round(curSpan + dx / colWidth);
			const snapped = SPANS.reduce((prev, cur) =>
				Math.abs(cur - targetCols) < Math.abs(prev - targetCols) ? cur : prev
			);

			if (snapped !== curSpan) {
				currentSize.span = snapped;
				applySizeClass(card, currentSize);
				void onResizeEnd(currentSize).then(() => {
					if (onRedrawCharts) onRedrawCharts();
				});
			}
		};

		activeDocument.addEventListener('touchmove', onTouchMove, { passive: false });
		activeDocument.addEventListener('touchend', onTouchEnd);
	}, { passive: false });

	// ── Bottom height-toggle handle ──
	const heightHandle = card.createDiv('dash-widget-height-handle');
	heightHandle.setAttribute('title', 'Drag vertically or click to resize height');
	
	heightHandle.addEventListener('mousedown', (startEv) => {
		startEv.preventDefault();
		startEv.stopPropagation();
		card.addClass('dash-resizing');
		
		const startY = startEv.clientY;
		const initialHeight = currentSize.height;

		const onMove = (mv: MouseEvent) => {
			const dy = mv.clientY - startY;
			let targetHeight = initialHeight;
			if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
			else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
			
			if (targetHeight === 'small') {
				card.removeClass('dash-widget-h-mini');
				card.addClass('dash-widget-h-small');
			} else {
				card.removeClass('dash-widget-h-small');
				card.addClass('dash-widget-h-mini');
			}
		};

		const onUp = (upEv: MouseEvent) => {
			activeDocument.removeEventListener('mousemove', onMove);
			activeDocument.removeEventListener('mouseup', onUp);
			card.removeClass('dash-resizing');

			const dy = upEv.clientY - startY;
			let targetHeight = initialHeight;
			
			if (Math.abs(dy) < 5) {
				// Click toggle behavior
				targetHeight = initialHeight === 'mini' ? 'small' : 'mini';
			} else {
				if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
				else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
			}

			if (targetHeight !== initialHeight) {
				currentSize.height = targetHeight;
				applySizeClass(card, currentSize);
				void onResizeEnd(currentSize).then(() => {
					if (onRedrawCharts) onRedrawCharts();
				});
			} else {
				applySizeClass(card, currentSize);
			}
		};

		activeDocument.addEventListener('mousemove', onMove);
		activeDocument.addEventListener('mouseup', onUp);
	});

	// Touch support for bottom handle
	heightHandle.addEventListener('touchstart', (startEv) => {
		if (startEv.touches.length !== 1) return;
		startEv.preventDefault();
		startEv.stopPropagation();
		card.addClass('dash-resizing');
		
		const startY = startEv.touches[0].clientY;
		const initialHeight = currentSize.height;

		const onTouchMove = (mv: TouchEvent) => {
			if (mv.touches.length !== 1) return;
			const dy = mv.touches[0].clientY - startY;
			let targetHeight = initialHeight;
			if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
			else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
			
			if (targetHeight === 'small') {
				card.removeClass('dash-widget-h-mini');
				card.addClass('dash-widget-h-small');
			} else {
				card.removeClass('dash-widget-h-small');
				card.addClass('dash-widget-h-mini');
			}
		};

		const onTouchEnd = (upEv: TouchEvent) => {
			activeDocument.removeEventListener('touchmove', onTouchMove);
			activeDocument.removeEventListener('touchend', onTouchEnd);
			card.removeClass('dash-resizing');

			if (upEv.changedTouches.length === 0) return;
			const dy = upEv.changedTouches[0].clientY - startY;
			let targetHeight = initialHeight;
			
			if (Math.abs(dy) < 5) {
				targetHeight = initialHeight === 'mini' ? 'small' : 'mini';
			} else {
				if (initialHeight === 'mini' && dy > 40) targetHeight = 'small';
				else if (initialHeight === 'small' && dy < -40) targetHeight = 'mini';
			}

			if (targetHeight !== initialHeight) {
				currentSize.height = targetHeight;
				applySizeClass(card, currentSize);
				void onResizeEnd(currentSize).then(() => {
					if (onRedrawCharts) onRedrawCharts();
				});
			} else {
				applySizeClass(card, currentSize);
			}
		};

		activeDocument.addEventListener('touchmove', onTouchMove, { passive: false });
		activeDocument.addEventListener('touchend', onTouchEnd);
	}, { passive: false });
}
