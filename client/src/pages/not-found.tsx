import { Card, CardContent } from "@/components/ui/card";
import { Coffee } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 pb-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Coffee className="h-6 w-6" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">Page not found</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This page doesn't exist. Head back to order your coffee.
          </p>
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to Brew →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
