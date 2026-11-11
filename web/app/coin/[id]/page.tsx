"use client";

import { CoinScreen } from "@/components/CoinScreen";
import { useParams } from "next/navigation";

export default function CoinPage() {
  const params = useParams<{ id: string }>();
  return <CoinScreen id={params.id} />;
}
