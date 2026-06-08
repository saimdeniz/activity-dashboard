# Project Instructions & AI Agent Rules

This document outlines the architectural guidelines, UI/UX design rules, and security constraints for the `activity-dashboard` plugin. Any AI agent modifying this codebase must adhere strictly to these rules.

---

## 1. Architectural & Logic Rules

### 📅 Timezone-Safe Date Handling
* **Rule**: Never parse date strings from frontmatter using bare `new Date(value)` as it defaults to local timezone offsets and causes date shifts in positive/negative GMT zones.
* **Solution**: Always use the custom parsing regexes in `src/utils/dateUtils.ts` (`extractDate`) or `src/utils/TimeUtils.ts` (`toDate`). These match the digits directly and normalize to UTC midnight (`Date.UTC`), ensuring consistency.
* **API Constraints**: Always use UTC date methods (`getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()`) when performing filters, queries, or aggregations.

### 🧮 Safe Formula Evaluation
* **Rule**: User-defined mathematical formulas (e.g. for custom widgets) must never be evaluated using raw `eval()` or unvalidated `new Function()`.
* **Solution**: Use the `GenericAggregator.evaluateSafeExpression` method. It:
  1. Safely substitutes numeric frontmatter values.
  2. Whitelists only safe mathematical operators `/^[0-9.+\-*/() ]*$/` and whitelisted functions like `Math.abs`, `Math.min`, `Math.max`, `Math.round`, `Math.floor`, and `Math.ceil`.
  3. Throws an error on unauthorized syntax to prevent Remote Code Execution (RCE).

### ⚙️ Settings Backup & Import Validation
* **Rule**: Before importing or saving any configuration via Settings backup/restore, the JSON structure must be fully validated.
* **Solution**: Always invoke the `validateSettings(parsed)` helper in `src/settings/SettingsTab.ts`. It verifies types, checks for mandatory lists (`collections`), and confirms widget fields, throwing descriptive exceptions to prevent plugin crashes.

---

## 2. UI / UX Design & Styling Rules

### 🎨 Color Palette & Themes
* Use the color tokens in `src/types.ts` (`COLLECTION_COLORS` and `CHART_PALETTE`).
* Always query Obsidian variables via `getComputedStyle(document.body).getPropertyValue(name).trim()` for compatibility with user themes (Light/Dark mode changes).
* Common variables: `--interactive-accent`, `--text-muted`, `--background-primary`, and `--background-modifier-border`.

### 📐 Control Layout Alignments
* Keep drilldown header controls aligned at a consistent height of **32px** (with `box-sizing: border-box`).
* Do not use native `<select>` dropdown controls as they render in OS-default styling (causing white Win32 menus in dark themes). Always use custom HTML list elements with custom classes like `.dash-custom-dropdown` and `.dash-custom-dropdown-list`.

### 📱 Mobile Responsiveness
* Keep margins clean and layouts wrap-friendly.
* Maintain reorder buttons (`chevron-up`/`chevron-down` actions) in widget headers for convenient ordering on touch screens.

---

## 3. Workflow Commitments
* **Code Modifiers**: Always run compilation (`npm run build` or `cmd.exe /c "npm run build"`) before finalizing turns to check for TypeScript errors.
* **Deletions**: Deleting any file (including source files, config files, package-lock files, or user notes) must always be pre-approved by the user. Never execute a delete operation without explicit confirmation.

---

## 4. AI Agent Interaction & Query Guidelines
* **Default to Text/Explanation**: If the user's message is investigatory, conceptual, or a question (e.g. asking "how does X work?", "why is Y needed?", "explain Z", or asking for alternatives), **DO NOT write code, edit files, or execute commands**. You must answer purely in text.
* **Coding Trigger**: Only modify, write, or create code/files if the user explicitly commands it using action verbs (e.g. "implement this", "fix the bug", "refactor X", "write a script", "code the solution") or explicitly requests a code implementation.
* **Keep it Concise**: Keep explanations direct and avoid unnecessary verbosity.

### 🛑 Quality Guard Rules
* **No Placeholders**: Never write placeholder code (e.g., `// ... existing code ...` or `// TODO`). Always rewrite/provide the full block or file content to prevent syntax errors and broken files.
* **Scoped CSS Only**: Do not style generic HTML tags globally. Ensure all styles added to `styles.css` are scoped inside plugin-specific classes (e.g., prefix classes or widget wrappers) to prevent style bleeding into other Obsidian components.
* **No Redundant Dependencies**: Do not install new npm/bun packages if the functionality can be accomplished using the native Obsidian API or Vanilla JS/TS. Always check `package.json` first.
* **No Emojis**: Never use emojis in code, code comments, commit messages, console output, or user-facing notices. Use plain text or Obsidian-specific callout/styling structures instead.



