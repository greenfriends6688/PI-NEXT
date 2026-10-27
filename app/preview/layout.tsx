import type { Metadata } from "next";
import "./preview.css";

export const metadata: Metadata = {
  title: "Pi Web · Design Preview",
  description: "Tivano-inspired design direction for the Pi Web shell and its PWA",
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
