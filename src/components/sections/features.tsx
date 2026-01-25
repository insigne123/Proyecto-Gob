import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Recycle, Sprout, Droplets, Users } from 'lucide-react';

const features = [
  {
    icon: <Recycle className="h-10 w-10 text-primary transition-transform group-hover:scale-110 group-hover:-rotate-6" />,
    title: 'Track Your Impact',
    description: 'Monitor your carbon footprint and see the positive changes you make in real-time.',
  },
  {
    icon: <Sprout className="h-10 w-10 text-primary transition-transform group-hover:scale-110 group-hover:rotate-6" />,
    title: 'Eco-Friendly Habits',
    description: 'Discover and adopt new sustainable habits with our guided challenges and tips.',
  },
  {
    icon: <Users className="h-10 w-10 text-primary transition-transform group-hover:scale-110" />,
    title: 'Join the Community',
    description: 'Connect with like-minded individuals, share your progress, and inspire others.',
  },
  {
    icon: <Droplets className="h-10 w-10 text-primary transition-transform group-hover:scale-110" />,
    title: 'Conserve Resources',
    description: 'Learn how to reduce water and energy consumption with practical, easy-to-follow advice.',
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-12 sm:py-24">
      <div className="container">
        <div className="text-center">
          <h2 className="font-headline text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Why You'll Love EcoBloom
          </h2>
          <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed mt-4">
            Our app is packed with features designed to make your eco-journey simple, rewarding, and fun.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <div key={index} className="group text-center">
              <div className="flex justify-center mb-4">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold">{feature.title}</h3>
              <p className="text-muted-foreground mt-2">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
