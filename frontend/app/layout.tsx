
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResearchFinder AI",
  description:
    "Discover academic papers with AI-powered semantic search.",
  icons: {
    icon: "/researchfinder-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
