import { AbstractInputSuggest, App, TFolder } from 'obsidian';

/**
 * Attaches a folder autocomplete dropdown to any <input> element.
 * Usage: new FolderSuggest(app, textComponent.inputEl)
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(app: App, private textEl: HTMLInputElement) {
		super(app, textEl);
	}

	getSuggestions(query: string): TFolder[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getAllFolders(true)
			.filter(f => f.path.toLowerCase().includes(lower))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 25);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.textEl.value = folder.path;
		this.textEl.dispatchEvent(new Event('input'));
		this.close();
	}
}
