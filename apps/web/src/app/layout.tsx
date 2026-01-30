import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gather Clone',
  description: 'Virtual office with proximity audio/video',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
