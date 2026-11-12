import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EGO",
    short_name: "EGO",
    description: "Talk to EGO.",
    start_url: "/ego",
    scope: "/ego",
    display: "standalone",
    background_color: "#f3f1f2",
    theme_color: "#1d2340",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
