import { DemoGuide } from "@/components/DemoGuide";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try the demo",
  description: "Connect a testnet wallet, take free tUSDC, and launch or feed a NearBowl coin.",
};

export default function DemoPage() {
  return (
    <div className="page page-pad">
      <DemoGuide />
    </div>
  );
}
