/**
 * Utility functions for color manipulation and dynamic palette generation.
 */

/**
 * Generates an array of harmonious colors by rotating the hue of a base color.
 * Resulting colors have a slight variance in lightness/saturation for a premium look.
 */
export function generatePalette(
	baseHex: string = '#818cf8',
	count: number = 1,
	theme: 'classic' | 'pastel' | 'neon' | 'monochrome' = 'classic'
): string[] {
	if (!baseHex || typeof baseHex !== 'string' || baseHex.startsWith('var(')) {
		baseHex = '#818cf8';
	}
	const hsl = hexToHsl(baseHex) || { h: 240, s: 70, l: 60 };

	const palette: string[] = [];
	if (count <= 1) return [baseHex];

	for (let i = 0; i < count; i++) {
		let h = hsl.h;
		if (theme !== 'monochrome') {
			const hShift = (360 / Math.max(count, 12)) * i;
			h = (hsl.h + hShift) % 360;
		}

		let s = hsl.s;
		let l = hsl.l;

		if (theme === 'pastel') {
			s = 45 + (i % 2 === 0 ? 5 : -5);
			l = 70 + (i % 3 === 0 ? 3 : -3);
		} else if (theme === 'neon') {
			s = 90 + (i % 2 === 0 ? 5 : -5);
			l = 50 + (i % 3 === 0 ? 3 : -3);
		} else if (theme === 'monochrome') {
			const lMin = 35;
			const lMax = 75;
			l = count > 1 ? lMin + ((lMax - lMin) / (count - 1)) * i : hsl.l;
			s = hsl.s;
		} else {
			s = Math.max(30, Math.min(90, hsl.s + (i % 2 === 0 ? 5 : -5)));
			l = Math.max(30, Math.min(80, hsl.l + (i % 3 === 0 ? 3 : -3)));
		}

		palette.push(hslToHex(h, s, l));
	}

	return palette;
}

/** Converts Hex (#RRGGBB, #RGB) or rgb(...) to HSL object { h, s, l } */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
	if (!hex || typeof hex !== 'string') return null;
	const clean = hex.trim();
	let r = 0, g = 0, b = 0;
	if (clean.startsWith('#')) {
		if (clean.length === 4) {
			r = parseInt(clean[1] + clean[1], 16);
			g = parseInt(clean[2] + clean[2], 16);
			b = parseInt(clean[3] + clean[3], 16);
		} else if (clean.length >= 7) {
			r = parseInt(clean.substring(1, 3), 16);
			g = parseInt(clean.substring(3, 5), 16);
			b = parseInt(clean.substring(5, 7), 16);
		} else {
			return null;
		}
	} else if (clean.startsWith('rgb')) {
		const match = clean.match(/\d+/g);
		if (match && match.length >= 3) {
			r = parseInt(match[0], 10);
			g = parseInt(match[1], 10);
			b = parseInt(match[2], 10);
		} else {
			return null;
		}
	} else {
		return null;
	}

	if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s = 0, l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}

	return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Converts HSL (h: 0-360, s: 0-100, l: 0-100) to Hex (#RRGGBB) */
export function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = Math.max(0, Math.min(100, s)) / 100;
	l = Math.max(0, Math.min(100, l)) / 100;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color).toString(16).padStart(2, '0');
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

/** Parses hex or rgb into { r, g, b } */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	let r = 129, g = 140, b = 248;
	if (!hex || typeof hex !== 'string') return { r, g, b };
	const clean = hex.trim();
	if (clean.startsWith('#')) {
		if (clean.length === 4) {
			r = parseInt(clean[1] + clean[1], 16);
			g = parseInt(clean[2] + clean[2], 16);
			b = parseInt(clean[3] + clean[3], 16);
		} else if (clean.length >= 7) {
			r = parseInt(clean.substring(1, 3), 16);
			g = parseInt(clean.substring(3, 5), 16);
			b = parseInt(clean.substring(5, 7), 16);
		}
	} else if (clean.startsWith('rgb')) {
		const match = clean.match(/\d+/g);
		if (match && match.length >= 3) {
			r = parseInt(match[0], 10);
			g = parseInt(match[1], 10);
			b = parseInt(match[2], 10);
		}
	}
	return { 
		r: isNaN(r) ? 129 : r, 
		g: isNaN(g) ? 140 : g, 
		b: isNaN(b) ? 248 : b 
	};
}

/** Converts any Hex or RGB color string to an "r, g, b" triplet for CSS rgba() */
export function hexToRgbString(hex: string): string {
	const { r, g, b } = hexToRgb(hex);
	return `${r}, ${g}, ${b}`;
}

/** Returns the perceived relative luminance of a color (0 to 255) */
export function getLuminance(hex: string): number {
	const { r, g, b } = hexToRgb(hex);
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Returns high-contrast text color ('#ffffff' or '#0f172a') to display ON TOP OF a solid background of `hex` */
export function getContrastTextColor(hex: string): string {
	const lum = getLuminance(hex);
	return lum > 160 ? '#0f172a' : '#ffffff';
}

/** 
 * Returns an adaptive foreground color for icons/borders/text that guarantees visibility
 * against the Obsidian theme background (preventing black-on-black or white-on-white).
 */
export function getAdaptiveForeground(hex: string, isDarkTheme = true): string {
	if (!hex || typeof hex !== 'string') return isDarkTheme ? '#cbd5e1' : '#1e293b';
	if (hex.startsWith('var(')) return hex;

	const lum = getLuminance(hex);
	if (isDarkTheme) {
		// In dark theme, if color is too dark (e.g. black #000000 or deep navy), lighten it
		if (lum < 75) {
			const hsl = hexToHsl(hex);
			if (hsl && hsl.s > 10) {
				return hslToHex(hsl.h, Math.max(40, hsl.s), 72);
			}
			return '#cbd5e1'; // Crisp visible silver for pure darks
		}
	} else {
		// In light theme, if color is too light (e.g. white #ffffff or pale yellow), darken it
		if (lum > 185) {
			const hsl = hexToHsl(hex);
			if (hsl && hsl.s > 10) {
				return hslToHex(hsl.h, Math.max(40, hsl.s), 28);
			}
			return '#1e293b'; // Crisp visible dark slate for pure lights
		}
	}
	return hex;
}

