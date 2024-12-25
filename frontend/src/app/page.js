"use client";
import { useState, useRef, useEffect } from "react";
import { FaBars } from 'react-icons/fa';
import axios from 'axios';
import InstamartComponent from '../components/instamart/InstamartComponent';
import InstamartProducts from '../components/instamart/InstamartProducts';
import MeeshoComponent from '../components/meesho/MeeshoComponent';
import MeeshoProducts from '../components/meesho/MeeshoProducts';

// Create axios instance with SSL certificate bypass
const axiosInstance = axios.create({
  httpsAgent: typeof window !== 'undefined' ? new (require('https').Agent)({
    rejectUnauthorized: false
  }) : null
});

// Set the default config for all axios requests
useEffect(() => {
  if (typeof window !== 'undefined') {
    axios.defaults.httpsAgent = new (require('https').Agent)({
      rejectUnauthorized: false
    });
  }
}, []);

const websites = [
  {
    name: "Instamart",
    url: "https://instamart.com",
    description: "Instamart is a grocery delivery service.",
    image: "https://instamart.com/logo.png",
  },
  {
    name: "Meesho",
    url: "https://meesho.com",
    description: "Meesho is a wholesale marketplace.",
    image: "https://meesho.com/logo.png",
  },
  {
    name: "Zepto",
    url: "https://zepto.com",
    description: "Zepto is a grocery delivery service.",
    image: "https://zepto.com/logo.png",
  },
  {
    name: "Zomato",
    url: "https://zomato.com",
    description: "Zomato is a food delivery service.",
    image: "https://zomato.com/logo.png",
  },
  {
    name: "Swiggy",
    url: "https://swiggy.com",
    description: "Swiggy is a food delivery service.",
    image: "https://swiggy.com/logo.png",
  },
];

export default function Home() {
  const [selectedWebsite, setSelectedWebsite] = useState(null);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // New state for modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalProducts, setModalProducts] = useState([]);
  const [modalTitle, setModalTitle] = useState("");

  // Add this new state variable
  const [isLoading, setIsLoading] = useState(false);

  // Add these new state variables
  const [isWebsiteMenuOpen, setIsWebsiteMenuOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const slideoutRef = useRef(null);

  // Add this useEffect for handling resize and mobile detection
  useEffect(() => {
    const handleResize = () => {
      const newIsMobile = window.innerWidth < 768;
      setIsMobile(newIsMobile);
      // Remove this line to prevent closing the menu on resize
      // setIsWebsiteMenuOpen(false);
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleWebsiteClick = (websiteName) => {
    setSelectedWebsite(websiteName);
    setIsWebsiteMenuOpen(false); // Close the slideout when a website is selected
  };

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    // This function is now handled in InstamartComponent
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalProducts([]);
    setModalTitle("");
  };

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isModalOpen]);

  // Add this function to handle clicks outside the slideout
  const handleClickOutside = (event) => {
    if (slideoutRef.current && !slideoutRef.current.contains(event.target)) {
      setIsWebsiteMenuOpen(false);
    }
  };

  // Add this useEffect to handle clicks outside the slideout
  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 flex items-center">
        <button
          className="text-2xl mr-4"
          onClick={() => setIsWebsiteMenuOpen(!isWebsiteMenuOpen)}
          aria-label="Toggle menu"
        >
          <FaBars />
        </button>
        <h1 className="text-2xl font-bold">Website Comparison</h1>
      </header>

      <div className="flex flex-1 relative">
        {/* Website selection slideout */}
        <div 
          ref={slideoutRef}
          className={`fixed top-0 left-0 h-full bg-white shadow-lg transition-transform duration-300 ease-in-out transform ${
            isWebsiteMenuOpen ? 'translate-x-0' : '-translate-x-full'
          } ${isMobile ? 'w-64' : 'w-1/3 max-w-xs'} z-50`}
        >
          <div className="p-4">
            <h2 className="text-2xl font-bold mb-4">Select a Website</h2>
            {websites.map((website) => (
              <button
                key={website.name}
                className={`w-full mb-4 p-4 text-left border rounded-lg shadow-md transform transition duration-200 hover:scale-105 hover:shadow-lg ${
                  selectedWebsite === website.name
                    ? "bg-blue-100 border-blue-400"
                    : "bg-white"
                }`}
                style={{ maxWidth: "250px" }}
                onClick={() => handleWebsiteClick(website.name)}
              >
                <div className="flex items-center">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium">{website.name}</h3>
                  </div>
                  {selectedWebsite === website.name && (
                    <span className="ml-2 text-green-500">✓</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="w-full p-4">
          {selectedWebsite ? (
            <>
              {selectedWebsite === "Instamart" ? (
                <InstamartComponent
                  axiosInstance={axiosInstance}
                  setIsModalOpen={setIsModalOpen}
                  setModalTitle={setModalTitle}
                  setModalProducts={setModalProducts}
                  setIsLoading={setIsLoading}
                  setError={setError}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                />
              ) : selectedWebsite === "Meesho" ? (
                <MeeshoComponent
                  axiosInstance={axiosInstance}
                  setIsModalOpen={setIsModalOpen}
                  setModalTitle={setModalTitle}
                  setModalProducts={setModalProducts}
                  setIsLoading={setIsLoading}
                  setError={setError}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  isLoading={isLoading}
                  isModalOpen={isModalOpen}
                  modalProducts={modalProducts}
                />
              ) : (
                <p>Selected website: {selectedWebsite}</p>
              )}
            </>
          ) : (
            <p>Select a website to view details.</p>
          )}
        </div>

        {/* Fullscreen Modal */}
        {isModalOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-auto bg-gray-800"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="bg-white p-8 rounded-lg w-full max-w-[90vw] h-auto max-h-[90vh] overflow-y-auto relative bg-gray-300">
              {/* Modal Header */}
              <div className="flex justify-between items-center mb-4 sticky top-0 bg-white z-10  bg-gray-300">
                <h2 id="modal-title" className="text-2xl font-bold">
                  {modalTitle}
                </h2>
                <button
                  onClick={closeModal}
                  aria-label="Close modal"
                  className="text-2xl focus:outline-none hover:text-red-600"
                >
                  &times;
                </button>
              </div>

              {/* Loading Spinner */}
              {isLoading && (
                <div className="flex justify-center items-center h-64">
                  <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
                </div>
              )}

              {/* Modal Content */}
              {!isLoading && (
                <div className="modal-content">
                  {/* Render modal content based on selectedWebsite */}
                  {selectedWebsite === "Instamart" && (
                    <InstamartProducts products={modalProducts} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
