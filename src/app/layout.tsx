import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { Toast } from "@heroui/react";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clipfarm",
  description: "Vidéos longues → shorts verticaux, pilotable par agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      data-theme="dark"
      className={`${manrope.variable} ${jetbrainsMono.variable} dark h-full font-sans antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <AppShell>{children}</AppShell>
        <Toast.Provider placement="bottom end" />
      </body>
    </html>
  );
}
