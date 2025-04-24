import { defineConfig } from "tsup";

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
  external: ["react", "react-dom", "@mui/icons-material", "@mui/material", "@mui/material/styles", "@emotion/react", "@emotion/styled", "react-syntax-highlighter"],
  injectStyle: false,
  legacyOutput: false,
  treeshake: true,
  esbuildOptions(options, context) {
    options.bundle = true;
    options.platform = 'browser';
    options.target = 'es2015';
    options.define = {
      ...options.define,
      'process.env.NODE_ENV': JSON.stringify('production'),
    };
    options.mainFields = ['browser', 'module', 'main'];
  },
});
