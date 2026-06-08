import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryFile = 'src/main.ts';

export default defineConfig(({ mode }) => {
	const prod = mode === 'production';
	const outDir = 'dist';

	return {
		plugins: [
			viteStaticCopy({
				targets: [
					{ src: 'manifest.json', dest: '.' },
					{ src: 'styles.css', dest: '.' },
				],
			}),
		],
		resolve: {
			alias: {
				src: path.resolve(__dirname, './src'),
			},
		},
		build: {
			lib: {
				entry: path.resolve(__dirname, entryFile),
				name: 'main',
				fileName: () => 'main.js',
				formats: ['cjs'],
			},
			minify: prod,
			sourcemap: prod ? false : 'inline',
			cssCodeSplit: false,
			emptyOutDir: false,
			outDir,
			rollupOptions: {
				input: { main: path.resolve(__dirname, entryFile) },
				output: {
					dir: outDir,
					entryFileNames: 'main.js',
				},
				external: [
					'obsidian',
					'electron',
					'@codemirror/state',
					'@codemirror/view',
					...builtinModules,
				],
			},
		},
	};
});

