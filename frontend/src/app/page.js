"use client";
import { useState } from "react";
import { GiShoppingBag } from 'react-icons/gi';
import AppLayout from '../components/layout/AppLayout';
import InstamartPriceTracker from '../components/instamart/InstamartPriceTracker';
import ZeptoPriceTracker from '../components/zepto/ZeptoPriceTracker';
import BigBasketPriceTracker from '../components/bigbasket/BigBasketPriceTracker';
import AmazonFreshPriceTracker from '../components/amazon/AmazonFreshPriceTracker';
import FlipkartGroceryPriceTracker from '../components/flipkart/FlipkartGroceryPriceTracker';
import { websites } from '../config/websites';

export default function Home() {
  // Initialize selectedWebsite with the first website in the list
  const [selectedWebsite, setSelectedWebsite] = useState(websites[0]?.name || null);

  // Render the selected website component
  const renderWebsiteComponent = () => {
    switch (selectedWebsite) {
      case "Instamart":
        return <InstamartPriceTracker />;
      case "Zepto":
        return <ZeptoPriceTracker />;
      case "BigBasket":
        return <BigBasketPriceTracker />;
      case "Amazon Fresh":
        return <AmazonFreshPriceTracker />;
      case "Flipkart Grocery":
        return <FlipkartGroceryPriceTracker />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center">
            <GiShoppingBag className="text-6xl text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-xl text-gray-500 dark:text-gray-400">Select a website to view price tracking data</p>
          </div>
        );
    }
  };

  return (
    <AppLayout selectedWebsite={selectedWebsite} setSelectedWebsite={setSelectedWebsite}>
      {renderWebsiteComponent()}
    </AppLayout>
  );
}
