export const productQueries = {
  Groceries: {
    Staples: ["Rice", "Wheat Flour", "Pulses", "Sugar", "Salt", "Cooking Oil"],
    SpicesAndCondiments: ["Spices", "Masala"],
    CannedAndPackagedFoods: [
      "Pasta",
      "Noodles",
      "Sauces",
      "Pickles",
      "Jams",
      "Canned Vegetables",
    ],
  },
  FreshFruitsAndVegetables: {
    Fruits: ["fruits"],
    Vegetables: ["vegetables"],
    ExoticProduce: ["exotic produce"],
  },
  DairyProducts: {
    Milk: ["milk"],
    Cheese: ["cheese"],
    YogurtAndCurd: ["yogurt", "curd"],
    ButterAndGhee: ["butter", "ghee"],
  },
  BakeryAndBreakfastItems: {
    Bread: ["Bread"],
    BreakfastCereals: ["Cornflakes", "Oats", "Muesli", "Granola", "cereals"],
    BakedGoods: ["Cookies", "Cakes", "Pastries", "Muffins"],
  },
  SnacksAndBeverages: {
    Snacks: ["Chips", "Namkeens", "Biscuits", "Chocolates", "Nuts"],
    Beverages: ["Tea", "Coffee", "Juices", "Soft Drinks", "Energy Drinks"],
    Sweets: ["sweets", "ice creams", "candies", "indian sweets"],
  },
  PersonalCare: {
    HairCare: ["Shampoo", "Conditioner", "Hair Oil", "Hair Styling Products"],
    SkinCare: ["Face Wash", "Moisturizer", "Sunscreen", "Face Creams"],
    OralCare: ["Toothpaste", "Toothbrushes", "Mouthwash", "Dental Floss"],
  },
  KitchenEssentials: {
    Cookware: ["Pans", "Pots", "Pressure Cookers", "Non-Stick Cookware"],
    Utensils: ["Spoons", "Ladles", "Knives", "Spatulas"],
    Storage: ["Containers", "Jars", "Tiffin Boxes", "Food Wraps"],
  },
  CleaningSupplies: {
    Laundry: ["Detergent", "Fabric Softener", "Stain Remover"],
    Dishwashing: ["Dish Soap", "Dishwasher Tablets", "Scrubbers"],
    HomeCleaning: ["Floor Cleaner", "Glass Cleaner", "Disinfectants"],
  },
  FrozenFoods: {
    ReadyToEatMeals: ["Frozen Pizzas", "Frozen Parathas", "Microwave Meals"],
    FrozenVegetables: ["Peas", "Corn", "Mixed Vegetables"],
    FrozenDesserts: ["Ice Cream", "Frozen Yogurt", "Gelato"],
  },
  MedicinesAndHealthcare: {
    OTCMedicines: ["Pain Relievers", "Cough Syrups", "Antacids"],
    HealthSupplements: [
      "Vitamins",
      "Protein Supplements",
      "Creatine",
      "Omega-3 Supplements",
      "Pre-workout",
      "Weight Gainers",
      "BCAA Supplements",
    ],
    FitnessFoods: [
      "Protein Bars",
      "Energy Bars",
      "Protein Shakes",
      "Diet Foods",
      "Sugar-Free Products",
    ],
    FirstAid: ["Bandages", "Antiseptic Creams", "Thermometers"],
    WellnessDevices: ["BP Monitors", "Glucose Meters", "Weighing Scales"],
  },
  HealthySpecialDietFoods: {
    DietSpecific: [
      "Keto-Friendly Foods",
      "Low-Carb Options",
      "Diabetic-Friendly Foods",
      "Low-Sodium Products",
    ],
    PlantBasedProtein: ["Tofu", "Tempeh", "Seitan", "Plant-Based Meat"],
    DryFruitsNuts: [
      "Almonds",
      "Cashews",
      "Walnuts",
      "Dates",
      "Raisins",
      "Mixed Dry Fruits",
    ],
    Seeds: [
      "Pumpkin Seeds",
      "Sunflower Seeds",
      "Watermelon Seeds",
      "Mixed Seeds",
    ],
  },
  Electronics: {
    MobileAccessories: ["chargers", "earphones", "power banks", "headphones", "speakers", "gadgets"],
    SmallAppliances: ["home appliances", "kitchen appliances", "personal care appliances", "office appliances", "lighting"],
    Batteries: ["batteries"],
  },
  StationeryAndOfficeSupplies: {
    Stationery: ["stationery", "office supplies", "art supplies", "craft supplies", "school supplies"],
  },
  Fashion: {
    Apparel: ["T-Shirts", "Jeans", "Dresses", "Shirts"],
    Accessories: ["Belts", "Watches", "Sunglasses", "Bags"],
  },
  BeautyAndWellness: {
    Makeup: ["makeup", "skincare", "haircare", "fragrances", "wellness"],
    Fragrances: ["fragrances", "perfumes", "deodorants", "body sprays"],
    Wellness: ["essential oils", "aromatherapy candles", "massage oils"],
  },
  SeasonalItems: {
    FestiveDecor: ["rangoli colors", "diya lamps", "festive lights"],
    Gifts: ["chocolates", "gift hampers", "greeting cards"],
  },

  RegionalCuisineIngredients: {
    SouthIndian: ["idli batter", "dosa batter", "coconut oil", "sambar powder"],
    NorthIndian: ["paneer", "ghee", "rajma", "chole masala"],
    International: ["pasta sauce", "olive oil", "soy sauce", "tortilla wraps"],
  },

  BeveragesExtended: {
    HotBeverages: [
      "Green Tea",
      "Black Tea",
      "Herbal Tea",
      "Instant Coffee",
      "Ground Coffee",
      "hot chocolate",
    ],
    Concentrates: ["squash", "syrups", "drink mixes"],
  },

  PartyAndEntertainment: {
    PartySupplies: [
      "Paper Plates",
      "Disposable Cutlery",
      "Napkins",
      "Party Decorations",
    ],
    QuickSnacks: ["Frozen Appetizers", "Dips", "Cheese Platters", "Party Mix"],
  },
  EcoFriendlyProducts: {
    SustainableItems: [
      "Reusable Bags",
      "Bamboo Products",
      "Eco-friendly Cleaners",
    ],
    Biodegradable: [
      "Biodegradable Bags",
      "Natural Cleaning Products",
      "Compostable Items",
    ],
  },
  //   BabyCare: {
  //     Diapers: ["Disposable Diapers", "Cloth Diapers"],
  //     BabyFood: ["Infant Formula", "Baby Cereal", "Purees"],
  //     BabyAccessories: ["Baby Wipes", "Baby Bottles", "Pacifiers"],
  //   },
  //   PetSupplies: {
  //     PetFood: ["Dog Food", "Cat Food", "Bird Food", "Fish Food"],
  //     PetAccessories: ["Toys", "Collars", "Leashes", "Litter Boxes"],
  //   },
//   HomeDecorAndGardening: {
//     Decor: ["candles", "photo frames", "vases"],
//     Gardening: ["seeds", "pots", "fertilizers", "gardening tools"],
//   },
};
