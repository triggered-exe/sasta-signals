"use client";
import { useState } from "react";
import { GiShoppingBag } from 'react-icons/gi';
import AppLayout from '../components/layout/AppLayout';
import MeeshoComponent from '../components/meesho/MeeshoComponent';
import PriceTracker from '../components/shared/PriceTracker';
import { websites } from '../config/websites';

export default function Home() {
  // Initialize selectedWebsite with the first website in the list
  const [selectedWebsite, setSelectedWebsite] = useState(websites[0]?.name || null);

  // Get the current website configuration
  const currentWebsite = websites.find(website => website.name === selectedWebsite);

  // Render the selected website component
  const renderWebsiteComponent = () => {
    if (!currentWebsite) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh] text-center">
          <GiShoppingBag className="text-6xl text-muted-foreground mb-4" />
          <p className="text-xl text-muted-foreground">Select a website to view price tracking data</p>
        </div>
      );
    }

    if (currentWebsite.name === "Meesho") {
      return <MeeshoComponent />;
    }

    return <PriceTracker apiEndpoint={currentWebsite.apiEndpoint} />;
  };

  return (
    <AppLayout selectedWebsite={selectedWebsite} setSelectedWebsite={setSelectedWebsite}>
      {renderWebsiteComponent()}
    </AppLayout>
  );
}
