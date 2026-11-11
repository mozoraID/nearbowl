import { StartGuide } from "@/components/StartGuide";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get started",
  description: "Connect a testnet wallet, take free tUSDC, and launch or feed a NearBowl coin.",
};

export default function StartPage() {
  return (
    <div className="page page-pad">
      <StartGuide />
    </div>
  );
}
