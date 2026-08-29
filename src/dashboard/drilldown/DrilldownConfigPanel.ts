import { setIcon, SliderComponent, App } from 'obsidian';
import type { CollectionConfig } from '../../types';
import { NoteDetailCustomizeModal } from '../../modals/NoteDetailCustomizeModal';

export class DrilldownConfigPanel {
	static build(
		panel: HTMLElement,
		col: CollectionConfig,
		onSaveQuiet: () => Promise<void>,
		onChange: () => void,
		app?: App
	): void {
		panel.empty();
		if (!col.drilldownConfig) {
			col.drilldownConfig = {
				layout: 'cards',
				cardSize: 200,
				fields: [],
				imageFit: 'cover',
				imageAspectRatio: 1.0,
			};
		}
		const dc = col.drilldownConfig;
		if (dc.cardSize < 50) dc.cardSize = 200;

		const heading = panel.createDiv('dash-config-panel-heading');
		heading.createSpan({ text: 'Configure View' });

		// Layout
		panel.createDiv({ text: 'Layout', cls: 'dash-config-label' });
		const layoutGroup = panel.createDiv('dash-config-pill-group');
		(['cards', 'table'] as const).forEach(l => {
			const icons: Record<string, string> = { cards: 'layout-grid', table: 'table' };
			const labels: Record<string, string> = { cards: 'Cards', table: 'Table' };
			const btn = layoutGroup.createEl('button', {
				cls: `dash-config-pill ${dc.layout === l ? 'active' : ''}`,
			});
			const iconEl = btn.createSpan({ cls: 'dash-config-pill-icon' });
			setIcon(iconEl, icons[l]);
			btn.createSpan({ text: labels[l] });
			btn.onclick = async () => {
				dc.layout = l;
				layoutGroup.querySelectorAll('.dash-config-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				
				imgSection.style.setProperty('display', l === 'cards' ? '' : 'none');
				const cssSec = panel.querySelector('.dash-card-size-section') as HTMLElement;
				if (cssSec) cssSec.style.setProperty('display', l === 'cards' ? '' : 'none');
				await onSaveQuiet();
				onChange();
			};
		});

		// Card Size (only for cards)
		const cardSizeSection = panel.createDiv('dash-config-section dash-card-size-section');
		cardSizeSection.style.setProperty('display', dc.layout === 'cards' ? '' : 'none');
		cardSizeSection.createDiv({ text: 'Card Size', cls: 'dash-config-label' });
		new SliderComponent(cardSizeSection)
			.setLimits(50, 800, 10)
			.setValue(dc.cardSize)
			.setDynamicTooltip()
			.setInstant(true)
			.onChange(async (val) => {
				dc.cardSize = val;
				await onSaveQuiet();
				onChange();
			});

		// Image section (cards only)
		const imgSection = panel.createDiv('dash-config-section');
		imgSection.style.setProperty('display', dc.layout === 'cards' ? '' : 'none');

		imgSection.createDiv({ text: 'Image Property', cls: 'dash-config-label' });

		const imgOptions = [{ value: '', label: '— None —' }, ...col.schema.map(f => ({ value: f.key, label: f.key }))];
		const imgDropWrap = imgSection.createDiv('dash-custom-dropdown');
		const imgDropBtn = imgDropWrap.createDiv('dash-custom-dropdown-btn');
		const imgDropLabel = imgDropBtn.createSpan({ text: dc.imageField || '— None —', cls: 'dash-custom-dropdown-label' });
		const imgDropArrow = imgDropBtn.createSpan({ cls: 'dash-custom-dropdown-arrow' });
		setIcon(imgDropArrow, 'chevron-down');
		const imgDropList = imgDropWrap.createDiv('dash-custom-dropdown-list hidden');

		imgOptions.forEach(opt => {
			const item = imgDropList.createDiv({
				cls: `dash-custom-dropdown-item${dc.imageField === opt.value || (!dc.imageField && opt.value === '') ? ' active' : ''}`
			});
			item.setText(opt.label);
			item.onclick = async (e) => {
				e.stopPropagation();
				dc.imageField = opt.value || undefined;
				imgDropLabel.setText(opt.value || '— None —');
				imgDropList.querySelectorAll('.dash-custom-dropdown-item').forEach(i => i.removeClass('active'));
				item.addClass('active');
				imgDropList.addClass('hidden');
				imgDropBtn.removeClass('open');
				imageFitSection.style.setProperty('display', dc.imageField ? '' : 'none');
				aspectSection.style.setProperty('display', dc.imageField ? '' : 'none');
				await onSaveQuiet();
				onChange();
			};
		});

		imgDropBtn.onclick = (e) => {
			e.stopPropagation();
			const isOpen = !imgDropList.hasClass('hidden');
			imgDropList.toggleClass('hidden', isOpen);
			imgDropBtn.toggleClass('open', !isOpen);
		};

		// Close when clicking outside
		activeDocument.addEventListener('click', () => {
			imgDropList.addClass('hidden');
			imgDropBtn.removeClass('open');
		}, { once: false });

		// Image Fit
		const imageFitSection = imgSection.createDiv('dash-config-section');
		imageFitSection.style.setProperty('display', dc.imageField ? '' : 'none');
		imageFitSection.createDiv({ text: 'Image Fit', cls: 'dash-config-label' });
		const fitGroup = imageFitSection.createDiv('dash-config-pill-group');
		(['cover', 'contain'] as const).forEach(fit => {
			const btn = fitGroup.createEl('button', {
				text: fit === 'cover' ? 'Cover' : 'Contain',
				cls: `dash-config-pill ${dc.imageFit === fit ? 'active' : ''}`,
			});
			btn.onclick = async () => {
				dc.imageFit = fit;
				fitGroup.querySelectorAll('.dash-config-pill').forEach(b => b.removeClass('active'));
				btn.addClass('active');
				await onSaveQuiet();
				onChange();
			};
		});

		// Image Aspect Ratio
		const aspectSection = imgSection.createDiv('dash-config-section');
		aspectSection.style.setProperty('display', dc.imageField ? '' : 'none');
		aspectSection.createDiv({ text: 'Image Aspect Ratio', cls: 'dash-config-label' });
		new SliderComponent(aspectSection)
			.setLimits(0.25, 2.50, 0.05)
			.setValue(dc.imageAspectRatio)
			.setDynamicTooltip()
			.setInstant(true)
			.onChange(async (val) => {
				dc.imageAspectRatio = val;
				await onSaveQuiet();
				onChange();
			});

		// Fields to Show
		panel.createDiv({ text: 'Fields to Show', cls: 'dash-config-label' });
		panel.createDiv({ text: 'None selected = only title shown', cls: 'dash-config-sublabel' });
		const fieldsWrap = panel.createDiv('dash-config-fields');
		col.schema.forEach(f => {
			const row = fieldsWrap.createDiv('dash-config-field-row');
			const cb = row.createEl('input', { type: 'checkbox', cls: 'dash-config-cb' });
			cb.checked = dc.fields.includes(f.key);
			row.createSpan({ text: f.key, cls: 'dash-config-field-label' });
			row.createSpan({ text: f.type, cls: 'dash-config-field-type' });
			cb.onchange = async () => {
				if (cb.checked) {
					if (!dc.fields.includes(f.key)) dc.fields.push(f.key);
				} else {
					dc.fields = dc.fields.filter(k => k !== f.key);
				}
				await onSaveQuiet();
				onChange();
			};
		});

		// Note Detail Panel Customization
		const ndSection = panel.createDiv('dash-config-section');
		ndSection.createDiv({ text: 'Note Detail Panel', cls: 'dash-config-label' });
		const custBtn = ndSection.createEl('button', {
			cls: 'dash-config-pill',
			attr: { style: 'width: 100%; justify-content: center; gap: 6px; margin-top: 4px;' }
		});
		const custIcon = custBtn.createSpan({ cls: 'dash-config-pill-icon' });
		setIcon(custIcon, 'sliders-horizontal');
		custBtn.createSpan({ text: 'Customize Highlights & Buttons' });
		custBtn.onclick = () => {
			const appInstance = app || (window as unknown as { app: App }).app;
			if (appInstance) {
				new NoteDetailCustomizeModal(appInstance, col, onSaveQuiet, onChange).open();
			}
		};
	}
}
