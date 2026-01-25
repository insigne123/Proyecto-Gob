import Image from 'next/image';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Home, Sprout, ShoppingBag } from 'lucide-react';

const tipsData = {
  home: {
    image: PlaceHolderImages.find(p => p.id === 'tip-home'),
    tips: [
      { title: 'Start a compost bin', content: 'Reduce landfill waste by composting your fruit and vegetable scraps. It creates nutrient-rich soil for your plants.' },
      { title: 'Unplug electronics', content: 'Many electronics draw power even when turned off. Unplug them or use a power strip to save energy.' },
      { title: 'Switch to LED bulbs', content: 'LEDs use up to 85% less energy and last much longer than incandescent bulbs, saving you money.' },
    ],
  },
  garden: {
    image: PlaceHolderImages.find(p => p.id === 'tip-garden'),
    tips: [
      { title: 'Plant native species', content: 'Native plants are adapted to your local climate, require less water, and support local wildlife and pollinators.' },
      { title: 'Collect rainwater', content: 'Use a rain barrel to collect water for your garden, reducing your reliance on treated tap water.' },
      { title: 'Use natural pest control', content: 'Introduce beneficial insects like ladybugs or use natural sprays to manage pests without harmful chemicals.' },
    ],
  },
  shopping: {
    image: PlaceHolderImages.find(p => p.id === 'tip-out'),
    tips: [
      { title: 'Bring reusable bags', content: 'A single reusable bag can replace hundreds of plastic bags over its lifetime. Keep them in your car or by the door.' },
      { title: 'Buy in bulk', content: 'Purchasing food from bulk bins reduces packaging waste. Bring your own containers for an even bigger impact.' },
      { title: 'Choose seasonal produce', content: 'Locally grown, seasonal produce has a smaller carbon footprint from transportation and storage.' },
    ],
  },
};

export function InteractiveTipsSection() {
  return (
    <section id="tips" className="bg-secondary py-12 sm:py-24">
      <div className="container">
        <div className="text-center">
          <h2 className="font-headline text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Your Daily Dose of Green
          </h2>
          <p className="mx-auto max-w-[700px] text-secondary-foreground/80 md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed mt-4">
            Simple, actionable tips to make a difference in every part of your life.
          </p>
        </div>
        <Tabs defaultValue="home" className="mt-12 w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="home"><Home className="mr-2"/> At Home</TabsTrigger>
            <TabsTrigger value="garden"><Sprout className="mr-2"/> In the Garden</TabsTrigger>
            <TabsTrigger value="shopping"><ShoppingBag className="mr-2"/> Out Shopping</TabsTrigger>
          </TabsList>
          {Object.entries(tipsData).map(([key, data]) => (
            <TabsContent key={key} value={key}>
              <Card className="border-none bg-transparent">
                <CardContent className="p-0 sm:p-6">
                  <div className="grid gap-8 md:grid-cols-2 items-center">
                    <div className="flex items-center justify-center">
                      {data.image && (
                         <Image
                            src={data.image.imageUrl}
                            alt={data.image.description}
                            width={600}
                            height={400}
                            className="rounded-lg object-cover shadow-lg aspect-[3/2]"
                            data-ai-hint={data.image.imageHint}
                         />
                      )}
                    </div>
                    <div className="flex flex-col justify-center">
                      <Accordion type="single" collapsible className="w-full">
                        {data.tips.map((tip, index) => (
                          <AccordionItem value={`item-${index}`} key={index}>
                            <AccordionTrigger className="text-lg font-medium text-left">{tip.title}</AccordionTrigger>
                            <AccordionContent className="text-base text-secondary-foreground/80">{tip.content}</AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
