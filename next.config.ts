import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Todas as telas leem dados do banco a cada pedido; por isso o modo "cache components" fica desligado
  // (ele exige envolver toda leitura de dados em Suspense) e as páginas usam `dynamic = "force-dynamic"`.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
