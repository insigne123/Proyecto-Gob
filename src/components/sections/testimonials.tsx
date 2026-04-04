'use client';

import Image from 'next/image';
import { Card, CardContent } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star } from 'lucide-react';

const testimonials = [
  {
    name: 'Sarah J.',
    title: 'Eco-Warrior',
    quote: "EcoBloom has completely changed my perspective on sustainability. The daily tips are easy to follow, and I love seeing my impact grow!",
    avatarId: 'testimonial-1',
  },
  {
    name: 'Mike R.',
    title: 'Gardening Enthusiast',
    quote: "I've always wanted to be more eco-friendly but didn't know where to start. This app made it so simple and rewarding. The community is fantastic!",
    avatarId: 'testimonial-2',
  },
  {
    name: 'Chen L.',
    title: 'Busy Professional',
    quote: "As someone with a hectic schedule, I appreciate how EcoBloom breaks down sustainability into manageable steps. It's a must-have app.",
    avatarId: 'testimonial-3',
  },
];

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="py-12 sm:py-24">
      <div className="container">
        <div className="text-center">
          <h2 className="font-headline text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            From Our Community
          </h2>
          <p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed mt-4">
            Hear what our users have to say about their journey with EcoBloom.
          </p>
        </div>
        <Carousel
          opts={{
            align: 'start',
            loop: true,
          }}
          className="w-full max-w-4xl mx-auto mt-12"
        >
          <CarouselContent>
            {testimonials.map((testimonial, index) => {
              const avatarImage = PlaceHolderImages.find(p => p.id === testimonial.avatarId);
              return (
                <CarouselItem key={index} className="md:basis-1/2 lg:basis-1/3">
                  <div className="p-1">
                    <Card className="h-full bg-accent/50 border-accent">
                      <CardContent className="flex flex-col items-start justify-between p-6 h-full">
                         <div className="flex items-center mb-4">
                            {[...Array(5)].map((_, i) => (
                                <Star key={i} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                            ))}
                        </div>
                        <p className="text-accent-foreground/80 mb-6 flex-grow">{"\""}{testimonial.quote}{"\""}</p>
                        <div className="flex items-center gap-4">
                           {avatarImage && (
                              <Avatar>
                                <AvatarImage src={avatarImage.imageUrl} alt={testimonial.name} data-ai-hint={avatarImage.imageHint} />
                                <AvatarFallback>{testimonial.name.charAt(0)}</AvatarFallback>
                              </Avatar>
                           )}
                          <div>
                            <p className="font-semibold text-accent-foreground">{testimonial.name}</p>
                            <p className="text-sm text-accent-foreground/70">{testimonial.title}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </CarouselItem>
              );
            })}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
    </section>
  );
}
