/** @type {import('next').NextConfig} */
const nextConfig = {
  // Baileys (and its dependencies — @hapi/boom, pino, and Baileys'
  // own ESM-only media-decoding dep audio-decode) rely on dynamic
  // requires and ESM syntax that Next's webpack bundler chokes on if
  // it tries to bundle them for the server runtime — that's the
  // "Module not found: ESM packages need to be imported" error.
  // Marking them external makes Next just `require()` them normally
  // at runtime via Node instead of bundling them at all.
  //
  // IMPORTANT: on Next.js 14 this setting lives under `experimental`
  // — it only became a stable top-level `serverExternalPackages` key
  // in Next.js 15. Since this project is pinned to 14.2.5, using the
  // stable-key name here gets silently ignored (Next just warns
  // "Unrecognized key(s)" and moves on), which is why the build was
  // still trying to bundle Baileys before this fix.
  experimental: {
    serverComponentsExternalPackages: ["@whiskeysockets/baileys", "@hapi/boom", "pino", "audio-decode"],
  },
};
module.exports = nextConfig;
