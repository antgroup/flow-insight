import { defineConfig } from "tsup";
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// Simple CSS inlining plugin
const cssInlinePlugin: esbuild.Plugin = {
  name: "css-inline",
  setup(build) {
    // Handle CSS imports
    build.onResolve({ filter: /\.css$/ }, (args) => {
      return {
        path: path.isAbsolute(args.path) 
          ? args.path 
          : path.join(args.resolveDir, args.path),
        namespace: 'css-inline',
      };
    });

    build.onLoad({ filter: /.*/, namespace: 'css-inline' }, async (args) => {
      try {
        // Read CSS file
        const css = await fs.promises.readFile(args.path, 'utf8');
        
        // Generate JS that injects CSS directly into document head
        return {
          contents: `
            const styleId = "${path.basename(args.path).replace('.', '-')}";
            
            // Check if style was already added
            if (!document.getElementById(styleId) && typeof document !== 'undefined') {
              const style = document.createElement('style');
              style.id = styleId;
              style.textContent = ${JSON.stringify(css)};
              document.head.appendChild(style);
            }
            
            export default {};
          `,
          loader: 'js',
        };
      } catch (e) {
        console.error(`Error processing CSS file ${args.path}:`, e);
        return {
          contents: `
            console.error("Failed to load CSS: ${args.path}");
            export default {};
          `,
          loader: 'js',
        };
      }
    });
  },
};

export default defineConfig({
  entry: ["src/index.ts"],
  dts: {
    resolve: true,
  },
  sourcemap: true,
  minify: true,
  splitting: false,
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === 'cjs' ? '.js' : '.mjs',
    dts: '.d.ts',
  }),
  outDir: "dist",
  clean: true,
  external: ["react", "react-dom", "@mui/icons-material", "@mui/material", "@mui/material/styles", "@emotion/react", "@emotion/styled", "react-syntax-highlighter", "lucide-react"],
  injectStyle: true,
  legacyOutput: false,
  treeshake: true,
  esbuildPlugins: [cssInlinePlugin],
  esbuildOptions(options) {
    options.bundle = true;
    options.platform = 'browser';
    options.target = 'es2015';
    options.define = {
      ...options.define,
      'process.env.NODE_ENV': JSON.stringify('production'),
    };
    options.mainFields = ['browser', 'module', 'main'];
  }
});
