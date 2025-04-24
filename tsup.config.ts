import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  sourcemap: true,
  minify: true,
  splitting: false,
  format: ["cjs", "esm"],
  outDir: "dist",
  clean: true,
  external: ["react", "react-dom"],
  injectStyle: false,
  legacyOutput: true,
  treeshake: true,
  esbuildOptions(options) {
    options.bundle = true;
    options.platform = 'browser';
    options.target = 'es2015';
  },
});
