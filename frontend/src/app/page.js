"use client";
import { useState } from "react";
import { Package } from "lucide-react";
import AppLayout from "../components/layout/AppLayout";
import MeeshoComponent from "../components/meesho/MeeshoComponent";
import PriceTracker from "../components/shared/PriceTracker";
import { websites } from "../config/websites";

export default function Home() {
  const [selectedWebsite, setSelectedWebsite] = useState(websites[0]?.name || null);

  const currentWebsite = websites.find((website) => website.name === selectedWebsite);

  const renderWebsiteComponent = () => {
    if (!currentWebsite) {
      return (
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <Package className="w-12 h-12 mb-4 text-muted-foreground/40" />
          <p className="text-lg text-muted-foreground">Select a platform to view price tracking data</p>
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
