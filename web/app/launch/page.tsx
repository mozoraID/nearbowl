import { LaunchForm } from "@/components/LaunchForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch a coin",
  description: "Seed a NearBowl coin with USDC. The seed becomes the pool, and the timer starts immediately.",
};

export default function LaunchPage() {
  return (
    <div className="page page-pad">
      <header className="section-head">
        <h1>Launch a coin</h1>
        <p>Name the pet, pick a ticker, and seed the bowl with USDC. Add a picture if you want. The card updates as you go.</p>
      </header>
      <LaunchForm />
    </div>
  );
}
