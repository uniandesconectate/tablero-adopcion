import type { Metadata } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conecta-TE · Adopción y acompañamiento",
  description: "Una mirada a la adopción de herramientas para preparar acompañamientos docentes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
