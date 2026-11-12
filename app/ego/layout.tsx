import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./ego.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["500"], display: "swap" });

export const metadata: Metadata = { title: "EGO", description: "Talk to EGO.", robots: { index: false, follow: false },
  icons: { apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "EGO", statusBarStyle: "default" },
};
export const viewport: Viewport = { viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0f1220" }, { color: "#f3f1f2" }] };

export default function EgoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`ego-root ${fraunces.variable}`}>{children}</div>;
}
