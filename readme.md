# Deals Checker - Multi-Platform Price Tracking System

A comprehensive price tracking application that monitors product prices across major Indian grocery and e-commerce platforms, providing real-time notifications for price drops and deals.

## 🌐 Current Deployment
- **Backend**: DigitalOcean Droplet (68.183.85.22:8000)
- **Proxy**: Nginx reverse proxy (https://68.183.85.22/)
- **Database**: MongoDB (cloud or self-hosted)

## 🚀 Features

### Multi-Platform Support
- **Instamart** (Swiggy) - Quick grocery delivery
- **BigBasket** - Online grocery supermarket
- **Blinkit** - Instant grocery delivery
- **Zepto** - 10-minute grocery delivery
- **Amazon Fresh** - Amazon's grocery service
- **Flipkart Grocery** - Flipkart's grocery platform
- **Meesho** - Social commerce platform

### Core Functionality
- ✅ **Automated Price Tracking** - Continuous monitoring of product prices
- ✅ **Location-based Services** - Support for different pincodes/delivery areas
- ✅ **Smart Notifications** - Telegram and email alerts for significant price drops
- ✅ **Real-time Updates** - Live price comparison across platforms
- ✅ **Category-wise Tracking** - Organized tracking by product categories
- ✅ **Discount Detection** - Automatic detection of deals and offers
- ✅ **Stock Monitoring** - Track product availability

## 🏗️ Architecture

### Backend (Node.js/Express)
- **Web Scraping**: Playwright with Firefox automation
- **Database**: MongoDB with platform-specific collections
- **API**: RESTful endpoints for product search and tracking
- **Notifications**: Telegram Bot API and Resend email service
- **Context Management**: Efficient browser context reuse

### Frontend (Next.js/React)
- **UI Framework**: Next.js 14 with React 18
- **Styling**: Tailwind CSS with dark/light theme support
- **Components**: Material-UI integration
- **State Management**: React hooks and context

### Database Schema
Each platform has its own MongoDB collection with fields:
- Product identification (productId, productName)
- Pricing information (price, mrp, discount, previousPrice)
- Category data (categoryName, subcategoryName)
- Tracking metadata (priceDroppedAt, lastChecked, inStock)
- Product details (imageUrl, url, weight, brand)

## 🛠️ Technology Stack

### Backend Dependencies
- **Express.js** - Web framework
- **Mongoose** - MongoDB ODM
- **Playwright** - Browser automation
- **Axios** - HTTP client
- **Resend** - Email service
- **MailerSend** - Alternative email service
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment configuration

### Frontend Dependencies
- **Next.js 14** - React framework
- **React 18** - UI library
- **Tailwind CSS** - Utility-first CSS
- **Material-UI** - Component library
- **React Icons** - Icon library
- **Axios** - API client

## 📦 Installation & Setup

### Prerequisites
- Node.js (v18 or higher)
- MongoDB database
- pnpm or npm package manager

### Backend Setup
```bash
cd backend
pnpm install
# or npm install

# Setup Playwright browsers
npx playwright install

# Configure environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Frontend Setup
```bash
cd frontend
pnpm install
# or npm install
```

### Environment Variables
Create `.env` file in backend directory:
```env
# Database
MONGO_URI=mongodb://localhost:27017/deals-checker

# Notifications
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHANNEL_ID=your_telegram_channel_id
RESEND_API_KEY=your_resend_api_key

# Environment
ENVIRONMENT=development
PORT=8000
```

## 🚀 Running the Application

### Development Mode
```bash
# Backend
cd backend
pnpm dev

# Frontend (in another terminal)
cd frontend
pnpm dev
```

### Production Mode
```bash
# Backend
cd backend
pnpm start

# Frontend
cd frontend
pnpm build
pnpm start
```

## 🌐 Deployment Commands
```bash
# Build frontend
cd frontend && pnpm build

# Start backend in production
cd backend && pnpm start
```

## 📱 API Endpoints

### Product Search
- `POST /api/{platform}/search` - Search products on specific platform
- `GET /api/products/{platform}` - Get tracked products from platform

### Price Tracking
- `POST /api/{platform}/start-tracking` - Start price tracking
- `GET /api/{platform}/categories` - Get platform categories

### Supported Platforms
- `/api/instamart/*` - Instamart endpoints
- `/api/bigbasket/*` - BigBasket endpoints
- `/api/blinkit/*` - Blinkit endpoints
- `/api/zepto/*` - Zepto endpoints
- `/api/amazon-fresh/*` - Amazon Fresh endpoints
- `/api/flipkart-grocery/*` - Flipkart Grocery endpoints
- `/api/meesho/*` - Meesho endpoints

## 🔧 Configuration

### Browser Settings
- **User Agent**: iPad emulation for better compatibility
- **Viewport**: 1280x1024 (iPad portrait)
- **Memory Optimization**: Reduced cache and process limits
- **Context Management**: Maximum 3 concurrent contexts

### Tracking Settings
- **Night Mode**: Pauses tracking between 12 AM - 6 AM IST
- **Retry Logic**: 3 attempts with exponential backoff
- **Batch Processing**: Parallel processing with rate limiting
- **Notification Threshold**: 10% minimum discount for alerts

## 📊 Monitoring & Notifications

### Telegram Notifications
- Real-time price drop alerts
- Product availability updates
- Daily tracking summaries

### Email Notifications
- Weekly price reports
- Significant deal alerts
- System status updates

## 🔍 How It Works

### Price Tracking Process
1. **Location Setup**: Configure delivery location using pincode
2. **Category Scanning**: Automatically discover product categories
3. **Product Extraction**: Extract product details using web scraping
4. **Price Monitoring**: Continuously track price changes
5. **Notification System**: Alert users about significant price drops
6. **Data Storage**: Store historical pricing data for analysis

### Platform-Specific Features
- **Instamart**: Category-based tracking with subcategory support
- **BigBasket**: API-based product fetching with location validation
- **Blinkit**: Infinite scroll handling for complete product discovery
- **Zepto**: Sitemap-based category discovery
- **Amazon Fresh**: Search-based product tracking
- **Flipkart Grocery**: Query-based product search
- **Meesho**: Social commerce product tracking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the existing issues
2. Create a new issue with detailed description
3. Include logs and error messages

## 🔮 Future Enhancements

- [ ] Mobile app development
- [ ] Price prediction using ML
- [ ] User accounts and wishlists
- [ ] Advanced filtering and sorting
- [ ] API rate limiting and caching
- [ ] Performance monitoring dashboard
- [ ] Multi-language support
- [ ] Price history charts and analytics
- [ ] Wishlist and favorites functionality
- [ ] Push notifications for mobile
- [ ] Integration with more platforms
- [ ] Advanced search and filtering options

## 📈 Project Statistics

- **Platforms Supported**: 7 major e-commerce platforms
- **Product Categories**: 100+ categories across platforms
- **Database Collections**: 7 platform-specific collections
- **API Endpoints**: 20+ RESTful endpoints
- **Notification Channels**: Telegram + Email
- **Browser Automation**: Playwright with Firefox
- **Deployment**: Production-ready on DigitalOcean

---

**Note**: This application is designed for educational and personal use. Please ensure compliance with the terms of service of the platforms being tracked.
