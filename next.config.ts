import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Make Cloudflare bindings (D1, etc.) available via getCloudflareContext()
// when running `next dev` locally.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
// next.config.js
module.exports = {
  allowedDevOrigins: ['10.0.0.219'],
}
