"use client";

import { Pet } from "@/components/Pet";
import type { PetMood } from "@/lib/format";
import { safeCoinImage } from "@/lib/image";
import { useState } from "react";

function displaySrc(previewSrc: string | null | undefined, imageUri: string | null | undefined): string | null {
  if (previewSrc?.startsWith("blob:")) return previewSrc;
  const preview = previewSrc ? safeCoinImage(previewSrc) : null;
  if (preview) return preview;
  return safeCoinImage(imageUri);
}

export function CoinArt({
  imageUri,
  previewSrc,
  mood,
  size = "sm",
  pulse = false,
  alt,
}: {
  imageUri?: string | null;
  previewSrc?: string | null;
  mood: PetMood;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
  alt: string;
}) {
  const src = displaySrc(previewSrc, imageUri);
  const [broken, setBroken] = useState<string | null>(null);
  if (!src || broken === src) {
    return <Pet mood={mood} pulse={pulse} size={size} />;
  }
  return (
    // Blob hosts and older https links are not a fixed remote pattern, and a failed load must fall back to the pet.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`coin-photo coin-photo-${size}`}
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      draggable={false}
      onError={() => setBroken(src)}
    />
  );
}
