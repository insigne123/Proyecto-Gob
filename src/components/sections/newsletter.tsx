import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Leaf } from 'lucide-react';

export function NewsletterSection() {
  return (
    <section id="cta" className="bg-secondary py-12 sm:py-24">
      <div className="container">
        <Card className="max-w-3xl mx-auto shadow-lg bg-background">
            <CardHeader className="text-center p-8">
                <Leaf className="h-12 w-12 text-primary mx-auto mb-4 animate-pulse"/>
                <CardTitle className="font-headline text-3xl font-bold tracking-tighter sm:text-4xl">
                    Ready to Grow?
                </CardTitle>
                <CardDescription className="text-lg mt-2 text-muted-foreground">
                    Download EcoBloom today and start your journey towards a more sustainable lifestyle. Plus, sign up for our newsletter for exclusive tips and updates!
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-0">
                <form className="flex w-full flex-col items-center gap-4 sm:flex-row">
                    <Input type="email" placeholder="Enter your email" className="flex-grow bg-white dark:bg-black/20" />
                    <Button type="submit" size="lg">Subscribe</Button>
                </form>
            </CardContent>
        </Card>
      </div>
    </section>
  );
}
