"use client";
import PriceTracker from "../shared/PriceTracker";

export default function InstamartPriceTracker() {
    return <PriceTracker apiEndpoint="/api/instamart/products" />;
} 