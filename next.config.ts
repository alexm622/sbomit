import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Make Cloudflare bindings (D1, etc.) available via getCloudflareContext()
// when running `next dev` locally.
initOpenNextCloudflareForDev();
