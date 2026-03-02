import { join } from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../../"),
  serverExternalPackages: ["pg"],
};

export default nextConfig;
