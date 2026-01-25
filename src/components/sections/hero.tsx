import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Apple } from 'lucide-react';

function PlayIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
        {...props}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        >
        <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    )
}


export function HeroSection() {
  const heroImage = PlaceHolderImages.find(p => p.id === 'hero-background');
  
  if (!heroImage) return null;

  return (
    <section className="relative h-[80vh] w-full">
      <Image
        src={heroImage.imageUrl}
        alt={heroImage.description}
        fill
        className="object-cover"
        priority
        data-ai-hint={heroImage.imageHint}
      />
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center text-center text-white">
        <div className="container px-4 md:px-6">
          <div className="max-w-3xl mx-auto space-y-4">
            <h1 className="font-headline text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              Cultivate a Greener Tomorrow, Today
            </h1>
            <p className="text-lg text-gray-200 md:text-xl">
              Join the movement to make a positive impact on our planet. EcoBloom helps you adopt sustainable habits, one small step at a time.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button size="lg">
                <Apple className="mr-2 h-5 w-5" />
                Download for iOS
              </Button>
              <Button size="lg" variant="secondary">
                <PlayIcon className="mr-2 h-5 w-5" />
                Download for Android
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
