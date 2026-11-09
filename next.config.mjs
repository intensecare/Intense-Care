/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfkit reads its own font metric files at runtime, so it must stay a plain node_modules import;
    // the fonts and logo it embeds live in /assets and are traced into the PDF routes explicitly.
    serverComponentsExternalPackages: ["pdfkit"],
    outputFileTracingIncludes: {
      "/api/quotations/[id]/pdf": ["./assets/**/*"],
      "/api/invoices/[id]/pdf": ["./assets/**/*"],
      "/api/quote/[token]/pdf": ["./assets/**/*"],
    },
  },
  async redirects() {
    // Links sent before the customer page moved keep working.
    return [
      { source: "/customer/job/:token", destination: "/customer/service/:token", permanent: true },
      { source: "/operations", destination: "/", permanent: false },
      { source: "/quality", destination: "/quality-queue", permanent: false },
      { source: "/finance", destination: "/invoices", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Customer secure links: never leak the token via Referer, never cache.
        source: "/customer/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
