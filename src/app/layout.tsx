import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnimeQuiz - ทายเพลงอนิเมะกับเพื่อน",
  description: "เกมทายชื่อเพลงอนิเมะแบบ real-time multiplayer ดึงเพลงจาก YouTube เล่นกับเพื่อนได้เลย!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Noto+Sans+Thai:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style={{ position: 'relative', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
