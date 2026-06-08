# Activity Dashboard for Obsidian

Activity Dashboard is a data visualization and overview panel plugin for Obsidian. It aggregates metadata and properties from your markdown notes into interactive widgets, timelines, and statistics cards without requiring complex Dataview queries or JavaScript code.

The plugin helps you build visual command centers for tracking reading lists, gaming libraries, project progress, or personal habits.

## Key Features

### Collections and Pinboards
Organize your tracking into separate workspaces called Collections (e.g., Books, Games, Projects) based on specific folders in your vault. You can also pin specific widgets from different collections to a global Overview Pinboard for a unified dashboard.

### Customizable Widgets
Create widgets by selecting any metadata property from your notes:
* **Distribution Charts:** Visual pie and doughnut charts for categorical data.
* **Activity Timelines:** Stacked bar charts that group completion dates into monthly, weekly, or yearly views.
* **Ranking Lists:** Sorted list boards displaying top items based on numerical properties.
* **Calculation Cards:** Metric displays showing summary calculations like count, sum, or average.

### Interactive Drilldowns
All charts and widgets support interactive drilldown. Clicking a segment of a chart or an item on a timeline opens a side panel displaying note cards or a table of the specific notes that match the selected data point.

### Interface Customization
* Drag-and-drop grid system for arranging widgets.
* Dynamic auto-scroll support when dragging items to the edges of the window.
* Contextual layout adjustments for grids and lists.
* Automated property schema syncing that scans vault metadata in the background.

## Installation

### Manual Installation
1. Go to the Releases page of this repository and download the latest release files (main.js, manifest.json, and styles.css).
2. Create a folder named activity-dashboard under your vault's .obsidian/plugins/ directory.
3. Copy the downloaded files into that folder.
4. Open Obsidian settings, navigate to Community Plugins, reload, and enable Dashboard.

## Getting Started
1. Click the Ribbon icon or run the command palette option to open the Dashboard.
2. Go to the plugin settings tab and create your first Collection, targeting the folder containing your notes.
3. Open the Dashboard tab, click the edit button, and add a widget.
4. Select the property you want to visualize (e.g., status, rating, genre) and customize the chart type.
