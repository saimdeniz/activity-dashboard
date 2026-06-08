/**
 * Utility functions for color manipulation and dynamic palette generation.
 */

/**
 * Generates an array of harmonious colors by rotating the hue of a base color.
 * Resulting colors have a slight variance in lightness/saturation for a premium look.
 */
export function generatePalette(baseHex: string, count: number): string[] {
	const hsl = hexToHsl(baseHex);
	if (!hsl) return Array(count).fill(baseHex);

	const palette: string[] = [];
	// If count is 1, just return the base
	if (count <= 1) return [baseHex];

	for (let i = 0; i < count; i++) {
		// Calculate a shift in hue. We don't want to rotate too wildly for small counts,
		// but for large counts (like 50 actors), we rotate progressively.
		const hShift = (360 / Math.max(count, 12)) * i;
		const h = (hsl.h + hShift) % 360;
		
		// Subtly vary saturation and lightness to make barcharts look more "dynamic"
		// alternating between slightly darker/lighter or more/less saturated
		const s = Math.max(30, Math.min(90, hsl.s + (i % 2 === 0 ? 5 : -5)));
		const l = Math.max(30, Math.min(80, hsl.l + (i % 3 === 0 ? 3 : -3)));
		
		palette.push(`hsl(${h}, ${s}%, ${l}%)`);
	}

	return palette;
}

/** Converts Hex (#RRGGBB) to HSL object */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
	let r = 0, g = 0, b = 0;
	// Handle #RGB
	if (hex.length === 4) {
		r = parseInt(hex[1] + hex[1], 16);
		g = parseInt(hex[2] + hex[2], 16);
		b = parseInt(hex[3] + hex[3], 16);
	} else if (hex.length === 7) {
		r = parseInt(hex.substring(1, 3), 16);
		g = parseInt(hex.substring(3, 5), 16);
		b = parseInt(hex.substring(5, 7), 16);
	} else {
		return null;
	}

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

	return { h: h * 360, s: s * 100, l: l * 100 };
}
