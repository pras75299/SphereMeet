import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SphereMeet — Virtual Office',
  description: 'Proximity audio/video virtual workspace',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ imageRendering: 'pixelated' }}>{children}</body>
    </html>
  );
}
