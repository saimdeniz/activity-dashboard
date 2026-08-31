import { Plugin, TFile } from 'obsidian';
import { DashboardView, VIEW_TYPE_DASHBOARD } from './dashboard/DashboardView';
import { DashboardSettingTab, DEFAULT_SETTINGS } from './settings/SettingsTab';
import { migrateSettings } from './core/Migration';
import type { DashboardSettings, CollectionConfig } from './types';
import { SchemaScanner } from './core/SchemaScanner';
import { CollectionReader } from './core/CollectionReader';

export default class LibraryDashPlugin extends Plugin {
	settings!: DashboardSettings;
	private scanTimeout: number | null = null;

	async onload(): Promise<void> {
		try {
			await this.loadSettings();

			this.registerView(VIEW_TYPE_DASHBOARD, leaf => new DashboardView(leaf, this));

			this.addRibbonIcon('layout-dashboard', 'Dashboard', () => {
				void this.openDashboard();
			});

			this.addCommand({
				id: 'open-dashboard',
				name: 'Open',
				callback: () => void this.openDashboard(),
			});

			this.addSettingTab(new DashboardSettingTab(this.app, this));

			// Hook into Metadata changes to dynamically update schemas and invalidate cache
			this.registerEvent(
				this.app.metadataCache.on('changed', (file) => {
					CollectionReader.invalidateCache();
					this.scheduleSchemaRescan(file);
				})
			);

			this.registerEvent(
				this.app.vault.on('create', (file) => {
					CollectionReader.invalidateCache();
					if (file instanceof TFile) this.scheduleSchemaRescan(file);
				})
			);

			this.registerEvent(
				this.app.vault.on('delete', () => {
					CollectionReader.invalidateCache();
					this.scheduleSchemaRescan();
				})
			);

			this.registerEvent(
				this.app.vault.on('rename', (file) => {
					CollectionReader.invalidateCache();
					if (file instanceof TFile) this.scheduleSchemaRescan(file);
				})
			);

			// Auto-redraw dashboards when the Obsidian theme changes (light/dark mode switch)
			this.registerEvent(
				this.app.workspace.on('css-change', () => {
					for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
						if (leaf.view instanceof DashboardView) {
							leaf.view.refresh();
						}
					}
				})
			);
		} catch (err) {
			console.error('[ActivityDashboard] Critical error during onload:', err);
		}
	}

	private pendingScanFiles = new Set<TFile>();

	private scheduleSchemaRescan(file?: TFile) {
		if (file) this.pendingScanFiles.add(file);
		if (this.scanTimeout) window.clearTimeout(this.scanTimeout);
		this.scanTimeout = window.setTimeout(() => {
			void (async () => {
				try {
					let changed = false;
					const scanner = new SchemaScanner(this.app);
					const reader = new CollectionReader(this.app);
					const filesToScan = Array.from(this.pendingScanFiles);
					this.pendingScanFiles.clear();

					for (const col of this.settings.collections) {
						if (filesToScan.length > 0) {
							const totalFiles = reader.countAll(col);
							for (const f of filesToScan) {
								if (!this.fileMatchesCollection(f, col)) continue;
								const colChanged = scanner.updateSchemaWithFile(f, col, totalFiles);
								if (colChanged) changed = true;
							}
						} else {
							const newSchema = await scanner.scan(col);
							if (JSON.stringify(col.schema) !== JSON.stringify(newSchema)) {
								col.schema = newSchema;
								changed = true;
							}
						}
					}
					if (changed) {
						await this.saveSettingsQuiet();
						// Also refresh the UI config panel if it's currently open!
						for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
							if (leaf.view instanceof DashboardView) {
								leaf.view.refresh();
							}
						}
					}
				} catch (err) {
					console.error('[ActivityDashboard] Error during scheduled schema rescan:', err);
				}
			})();
		}, 10000); // 10s debounce to reduce CPU load during active typing
	}

	private fileMatchesCollection(file: TFile, col: CollectionConfig): boolean {
		if (col.scanMode === 'folder' && col.folderPath) {
			const raw = col.folderPath;
			const prefix = raw.endsWith('/') ? raw : raw + '/';
			return file.path.startsWith(prefix) || file.path === raw;
		}

		const typeField = col.typeField ?? 'type';
		const typeValue = (col.typeValue ?? '').toLowerCase().trim();
		if (!typeValue) return false;

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return false;
		return String(fm[typeField] ?? '').trim().toLowerCase() === typeValue;
	}

	onunload(): void {
		if (this.scanTimeout) window.clearTimeout(this.scanTimeout);
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData() as Record<string, unknown> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...migrateSettings(loaded),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Refresh any open dashboard views
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			if (leaf.view instanceof DashboardView) {
				leaf.view.refresh();
			}
		}
	}

	/** Save settings to disk WITHOUT triggering a full dashboard re-render. */
	async saveSettingsQuiet(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async openDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		if (existing.length) {
			this.app.workspace.setActiveLeaf(existing[0], { focus: true });
		} else {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		}
	}
}
