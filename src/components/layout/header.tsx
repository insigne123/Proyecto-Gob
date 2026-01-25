import Link from 'next/link';
import { Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center">
        <div className="mr-4 flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <Leaf className="h-6 w-6 text-primary" />
            <span className="font-bold sm:inline-block">
              EcoBloom
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm md:flex">
            <Link
              href="#features"
              className="text-foreground/60 transition-colors hover:text-foreground/80"
            >
              Features
            </Link>
            <Link
              href="#tips"
              className="text-foreground/60 transition-colors hover:text-foreground/80"
            >
              Tips
            </Link>
            <Link
              href="#testimonials"
              className="text-foreground/60 transition-colors hover:text-foreground/80"
            >
              Testimonials
            </Link>
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-4">
          <Button>
            Get Started
          </Button>
        </div>
      </div>
    </header>
  );
}
