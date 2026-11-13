import { StartGuide } from "@/components/StartGuide";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get started",
  description: "Try one NearBowl cycle: faucet, launch, feed, then sell or claim.",
};

export default function StartPage() {
  return (
    <div className="page page-pad">
      <StartGuide />
    </div>
  );
}
