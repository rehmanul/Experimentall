/***************************************************************
 * ENHANCED PRODUCT EXTRACTOR
 * Version 4.0.0
 * Improved with Azure OpenAI integration, image extraction,
 * comma-separated output format, and web UI integration
 ***************************************************************/
const CONFIG = {
  
  /***************************************************************
   * SHEET & COLUMN CONFIG
   ***************************************************************/
  sheetName: "Supplier D.B",
  errorSheetName: "Error Log",
  logSheetName: "Processing Log",
  columns: {
    vendor: 1,          // Column A
    website: 4,         // Column D
    status: 6,          // Column F
    productsStart: 7,   // Column G - Now stores comma-separated products
    images: 8           // Column H - For comma-separated image URLs
  },
  
  /***************************************************************
   * RECURSIVE CRAWL CONFIG
   ***************************************************************/
  maxDepth: 3,  // Maximum depth for sub-page crawling
  productSectionPhrases: [
    "Our Products", "Product Range", "Menu & Products", "Food Products",
    "Culinary Creations", "Discover our products", "Fresh Selections",
    "Products and Solutions", "Innovations in Food", "What We Offer",
    "Our Portfolio", "Product Collection"
  ],
  
  /***************************************************************
   * EXTRACTION & AI SETTINGS
   ***************************************************************/
  translateToEnglish: true, // Translate each page's text before parsing
  maxProducts: 50,          // Maximum products to extract
  
  // Azure OpenAI API configuration
  azure: {
    enabled: true,
    apiKey: PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_KEY'),
    endpoint: PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_ENDPOINT'),
    deploymentName: PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_DEPLOYMENT'),
    systemPrompt: `Extract product titles from the HTML content provided.
Return a JSON array containing only the cleaned product titles.
Example: ["Chocolate Hazelnut Spread 200g", "Frozen Pork Front Feet (B-grade)"]`
  },
  
  // Regex-based approach for simple "product" extraction
  regexSelectors: [
    /<h1[^>]*>(.*?)<\/h1>/gi,
    /<h2[^>]*>(.*?)<\/h2>/gi,
    /<h3[^>]*>(.*?)<\/h3>/gi,
    /<h4[^>]*>(.*?)<\/h4>/gi,
    /<li[^>]*>(.*?)<\/li>/gi,
    /<td[^>]*>(.*?)<\/td>/gi,
    /<a[^>]+class="[^"]*(product|item|title|name)[^"]*"[^>]*>(.*?)<\/a>/gi,
    /data-product-name="([^"]+)"/gi,
    /class="[^"]*(title|name|product)[^"]*">([^<]+)<\/(?:div|span|p)>/gi,
    /<div[^>]+class="[^"]*(product|item-title)[^"]*"[^>]*>(.*?)<\/div>/gi,
    /<span[^>]+class="[^"]*(product|item-title)[^"]*"[^>]*>(.*?)<\/span>/gi,
    /<p[^>]+class="[^"]*(product|item-title)[^"]*"[^>]*>(.*?)<\/p>/gi
  ],
  
  // Image extraction selectors
  imageSelectors: [
    /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/gi,
    /<img[^>]+class="[^"]*product[^"]*"[^>]+src="([^"]+)"/gi,
    /<img[^>]+src="([^"]+)"[^>]+class="[^"]*product[^"]*"/gi,
    /data-src="([^"]+)"/gi,
    /data-product-image="([^"]+)"/gi
  ],
  
  // Domain-specific logic
  domainSpecific: {
    "tasteful.me": extractTastefulProducts,
    "foodysfoods.com": extractFoodysFoods
  },
  
  /***************************************************************
   * FILTERING / DETECTION
   ***************************************************************/
  bannedPhrases: [
    "MISSION", "NEWS 2025", "NEWS", "MAIN MENU", "MAIN MENU (CUSTOM)",
    "CHOOSE YOUR COUNTRY OR REGION", "CHOOSE YOUR COUNTRY", "FOOTER MAIN MENU (CUSTOM)",
    "FOOTER MENU", "OUR BRANDS", "REGISTRATI", "CONFERMA", "INIZIA", "MENU", "SEGUICI",
    "NEWSLETTER", "DECALOGO", "EVENTI", "ERROR 901", "ERROR", "MADE IN FRANCE", "MADE IN",
    "#ESHOP", "TITOLO", "CONTATTACI", "FAQ", "WWW.", "&NBSP;", "NAUTI",
    "NO PRESSURE, JUST PLEASURE", "HERKULLISTA", "YHTEYSTIEDOT", "MAKU", "HYVINVOINTI",
    "SEARCH", "INDIRIZZO", "MAIL", "TELEFONO", "SOCIAL", "ISCRIVITI", "FOLLOW", "CONTACT",
    "PERCHÉ SCEGLIERCI", "RESTA AGGIORNATO SULLE ULTIME NOVITÀ",
    "@MPBERGAMO", "MPBERGAMOSRL", "SEGUICI SU", "ISCRIVITI ALLA NEWSLETTER",
    "COUNTRY/REGION", "LANGUAGE", "NAVIGATE", "SIGN UP TO OUR NEWSLETTER",
    "MICHAEL, MANGO FARMER", "BOBBY, PAWPAW FARMER", "MALIK, PAWPAW FARMER", "MR. ATO, MANGO FARMER",
    "PRODUCT", "HOME", "ABOUT US", "PRIVATE LABEL", "ORGANA LABEL", "ZA KOGA SMO PRIMERNI",
    "PROCESS & PRIVATE LABEL DEVELOPMENT", "YOUR PRIVATELABEL PRODUCER", "DECIDE ON A RECIPE",
    "PACKAGING & DESIGN", "JOIN OUR BASHA", "REAL REVIEWS FOR REAL FLAVORS", "SHOPPING CART",
    "CHOOSE YOUR COUNTRY", "SUBSCRIBE", "CODE", "WINDOW.SHOPIFYPAYPALV4VISIBILITYTRACKING"
  ],
  
  // Lines must contain at least one "food word" to be considered a product
  foodWords: [
    "spice", "herb", "chocolate", "cocoa", "cacao", "flour", "bread", "cheese", "butter",
    "milk", "cream", "frozen", "vac", "kg", "g ", "pork", "beef", "fish", "tail", "heart",
    "liver", "snout", "chicken", "drumstick", "pack", "package", "pancreas", "nut", "jam",
    "honey", "oil", "olive", "rice", "corn", "grain", "coffee", "tea", "tomato", "pepper",
    "onion", "garlic", "egg", "pizza", "biscuit", "candy", "dessert", "cookie", "sauce",
    "syrup", "pastry", "bean", "pasta", "chips", "protein", "cereal", "seasoning",
    "sea salt", "crackers", "spread", "wine", "beer", "ethio", "ethiopian", "imported", "spices"
  ],
  
  /***************************************************************
   * INTERNAL STATE
   ***************************************************************/
  request: {
    timeout: 30000,
    retries: 3,
    delay: 2500
  },
  visited: new Set() // track visited URLs per site crawl
};

/***************************************************************
 * THE MAIN MULTI-LEVEL ENTRY POINT
 ***************************************************************/
function extractAllProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.sheetName);
  const errorSheet = getErrorSheet(ss);
  const logSheet = getLogSheet(ss);
  
  try {
    validateEnvironment(sheet);
    validateApiKey();
    clearStatusColumn(sheet);
    
    const lastRow = sheet.getLastRow();
    // resume from property
    let currentRow = getResumePosition() || 2;
    
    logProcessingStart(logSheet, lastRow - 1);
    
    while (currentRow <= lastRow) {
      // Check if extraction is paused
      if (PropertiesService.getScriptProperties().getProperty("EXTRACTION_PAUSED") === "true") {
        saveResumePosition(currentRow);
        return; // Exit if paused
      }
      
      const url = sheet.getRange(currentRow, CONFIG.columns.website).getValue();
      const vendor = sheet.getRange(currentRow, CONFIG.columns.vendor).getValue();
      
      if (!url) {
        updateStatus(sheet, currentRow, '⚠️ No URL');
        currentRow++;
        continue;
      }
      
      updateStatus(sheet, currentRow, '🔄 Processing...');
      CONFIG.visited.clear();
      
      try {
        // Multi-level crawl
        const result = crawlPageForProducts(url, 0);
        const allProducts = result.products;
        const allImages = result.images;
        
        // Process with DataProcessor for classification
        let processedData = null;
        try {
          processedData = processExtractedData(allProducts, allImages, url);
        } catch (e) {
          Logger.warn("PROCESS", "Data processing error", e);
        }
        
        // write final results as comma-separated values
        writeProductsToSheet(sheet, currentRow, allProducts, allImages);
        
        // If processing was successful and enhanced data is available
        if (processedData && processedData.category) {
          // Add category/brand info to status
          updateStatus(sheet, currentRow, `✅ ${allProducts.length} products, ${allImages.length} images, Category: ${processedData.category}`);
        } else {
          updateStatus(sheet, currentRow, `✅ ${allProducts.length} products, ${allImages.length} images`);
        }
        
        logSuccess(logSheet, currentRow, vendor, url, allProducts.length, allImages.length);
      } catch (e) {
        updateStatus(sheet, currentRow, `❌ ${e.message}`);
        logError(errorSheet, e, currentRow, vendor, url);
      }
      
      // Flush & next
      currentRow++;
      saveResumePosition(currentRow);
      
      // Progress
      let percent = Math.min(100, Math.round(((currentRow - 2) / (lastRow - 1)) * 100));
      updateProgress(sheet, percent);
      
      Utilities.sleep(CONFIG.request.delay);
    }
    
    finalizeProcessing(sheet, logSheet);
  } catch (err) {
    // Log the top-level error
    logError(errorSheet, err);
    throw err;
  }
}

/**
 * Process extracted products using the DataProcessor module
 * @param {Array} products - Array of extracted product names
 * @param {Array} images - Array of image URLs
 * @param {string} url - Source URL
 * @returns {Object} Enhanced product data
 */
function processExtractedData(products, images, url) {
  try {
    if (typeof DataProcessor === 'undefined' || !DataProcessor.processData) {
      Logger.warn("PROCESS", "DataProcessor module not available");
      return {
        products: products,
        images: images
      };
    }
    
    // Create initial data object for processing
    const rawData = {
      url: url,
      content: products.join("\n"),
      name: products[0] || "",
      description: "",
      images: images,
      category: "",
      brand: ""
    };
    
    // Process data through DataProcessor for classification and enhancement
    const processedData = DataProcessor.processData(rawData);
    
    // Log the processing results
    Logger.info("PROCESS", `Processed ${products.length} products and ${images.length} images`, 
      {category: processedData.category, brand: processedData.brand});
    
    return processedData;
  } catch (e) {
    Logger.warn("PROCESS", "Data processing error, returning raw data", e);
    return {
      products: products,
      images: images
    };
  }
}

/***************************************************************
 * MULTI-LEVEL CRAWLING WITH IMAGE EXTRACTION
 ***************************************************************/
/**
 * Recursive function to crawl pages and extract products and images
 */
function crawlPageForProducts(url, depth) {
  if (depth > CONFIG.maxDepth) {
    Logger.log(`Max depth reached for: ${url}`);
    return { products: [], images: [] };
  }
  
  if (CONFIG.visited.has(url)) {
    Logger.log(`Already visited: ${url}`);
    return { products: [], images: [] };
  }
  
  CONFIG.visited.add(url);
  Logger.log(`Crawling [depth=${depth}] => ${url}`);
  
  // Fetch & translate
  const html = fetchWebpage(url);
  let translated = html;
  try {
    translated = tryTranslateHtml(html);
  } catch (e) {
    Logger.warn("TRANSLATE", `Translation error for ${url}: ${e.message}`);
  }
  
  // Find subcategory links
  const categoryLinks = findProductSectionLinks(translated, url);
  
  // Extract product titles and images from the current page
  const pageResult = extractProductsAdaptive(url, html, translated);
  
  // Go deeper
  let subProducts = [];
  let subImages = [];
  
  for (let link of categoryLinks) {
    try {
      const deeper = crawlPageForProducts(link, depth + 1);
      subProducts = subProducts.concat(deeper.products);
      subImages = subImages.concat(deeper.images);
    } catch (e) {
      Logger.log(`Error crawling sub-link: ${link}, ${e.message}`);
    }
  }
  
  // Return combined results
  return {
    products: pageResult.products.concat(subProducts),
    images: pageResult.images.concat(subImages)
  };
}

/** 
 * Find links to product sections or category pages
 */
function findProductSectionLinks(translatedHtml, baseUrl) {
  let links = [];
  for (const phrase of CONFIG.productSectionPhrases) {
    const blockRegex = new RegExp(`.{0,200}${escapeRegex(phrase)}.{0,200}`, "gi");
    let match;
    while ((match = blockRegex.exec(translatedHtml)) !== null) {
      const snippet = match[0];
      const hrefRegex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
      let hrefM;
      while ((hrefM = hrefRegex.exec(snippet)) !== null) {
        let linkUrl = hrefM[1];
        linkUrl = absoluteUrl(linkUrl, baseUrl);
        if (linkUrl && isValidUrl(linkUrl)) {
          links.push(linkUrl);
        }
      }
    }
  }
  return [...new Set(links)];
}

/***************************************************************
 * IMPROVED HTML TRANSLATION - ERROR FIX
 ***************************************************************/
/**
 * Enhanced tryTranslateHtml with better error handling
 */
function tryTranslateHtml(html) {
  try {
    // If html is null or undefined, return empty string
    if (!html) return "";
    
    // More aggressive cleaning to remove problematic content
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/\s+/g, " ")      // Normalize whitespace
      .trim();
    
    // Further reduce size - try a smaller chunk
    cleaned = cleaned.substring(0, 1000);
    
    // Additional validation
    if (cleaned.length < 10) return "";
    
    // Try translation with error handling
    return LanguageApp.translate(cleaned, "auto", "en");
  } catch (e) {
    Logger.log(`Translation error: ${e.message}`);
    // Return original text or simplified version as fallback
    return html.replace(/<[^>]+>/g, " ").substring(0, 1000);
  }
}

/***************************************************************
 * ADAPTIVE PRODUCT & IMAGE EXTRACTION (AZURE OPENAI INTEGRATION)
 ***************************************************************/
function extractProductsAdaptive(url, originalHtml, translatedHtml) {
  // Extract images first
  const productImages = extractProductImages(originalHtml, url);
  
  // Domain-specific extraction
  let domainResults = [];
  for (let domain in CONFIG.domainSpecific) {
    if (url.includes(domain)) {
      domainResults = CONFIG.domainSpecific[domain](originalHtml);
      break;
    }
  }
  
  // Generic regex extraction
  let regexResults = extractProductsWithRegex(originalHtml);
  
  // Combine, filter
  let combined = mergeUnique(domainResults, regexResults);
  
  // If minimal results, try Azure OpenAI
  if (combined.length < 3 && CONFIG.azure.enabled) {
    try {
      let azureProds = queryAzureOpenAI(originalHtml);
      combined = mergeUnique(combined, azureProds);
    } catch (e) {
      Logger.warn("AZURE", `Azure extraction error: ${e.message}`);
    }
  }
  
  // Heuristic approach as final fallback
  if (combined.length < 3) {
    let heuristics = heuristicLineExtraction(translatedHtml);
    combined = mergeUnique(combined, heuristics);
  }
  
  // Filter and translate if needed
  let final = filterProducts(combined);
  if (CONFIG.translateToEnglish) {
    try {
      final = final.map(p => safeTranslate(p));
    } catch (e) {
      Logger.warn("TRANSLATE", `Translation error: ${e.message}`);
    }
  }
  
  return {
    products: final,
    images: [...new Set(productImages)]
  };
}

/**
 * Extract product images from HTML
 */
function extractProductImages(html, baseUrl) {
  const images = new Set();
  
  try {
    // JSON-LD product images
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/gs);
    if (jsonLdMatch) {
      for (const match of jsonLdMatch) {
        try {
          const jsonStr = match.replace(/<script type="application\/ld\+json">|<\/script>/g, '');
          const data = JSON.parse(jsonStr);
          if (data['@type'] === 'Product' && data.image) {
            const imageUrls = Array.isArray(data.image) ? data.image : [data.image];
            imageUrls.forEach(url => images.add(absoluteUrl(url, baseUrl)));
          }
        } catch (e) {
          Logger.log(`JSON-LD image extraction error: ${e.message}`);
        }
      }
    }
    
    // Open Graph images
    const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/gi);
    if (ogMatch) {
      for (const match of ogMatch) {
        const urlMatch = match.match(/content="([^"]*)"/i);
        if (urlMatch && urlMatch[1]) {
          images.add(absoluteUrl(urlMatch[1], baseUrl));
        }
      }
    }
    
    // Product images using selectors
    for (const selector of CONFIG.imageSelectors) {
      const matches = html.matchAll(selector);
      for (const match of matches) {
        if (match[1] && isLikelyProductImage(match[1])) {
          images.add(absoluteUrl(match[1], baseUrl));
        }
      }
    }
    
    // General <img> tags near product indicators
    const imgTags = html.match(/<img[^>]+src="([^"]+)"[^>]*>/gi);
    if (imgTags) {
      for (const tag of imgTags) {
        const srcMatch = tag.match(/src="([^"]*)"/i);
        if (srcMatch && srcMatch[1] && 
            (tag.toLowerCase().includes('product') || tag.toLowerCase().includes('item'))) {
          images.add(absoluteUrl(srcMatch[1], baseUrl));
        }
      }
    }
    
  } catch (e) {
    Logger.log(`General image extraction error: ${e.message}`);
  }
  
  return [...images].filter(url => isValidImageUrl(url));
}

/**
 * Check if a URL is likely a product image
 */
function isLikelyProductImage(url) {
  const lowerUrl = url.toLowerCase();
  
  // Filter out common non-product images
  if (
    lowerUrl.includes('logo') ||
    lowerUrl.includes('icon') ||
    lowerUrl.includes('banner') ||
    lowerUrl.includes('background') ||
    lowerUrl.includes('bg.') ||
    lowerUrl.includes('bullet') ||
    lowerUrl.includes('button')
  ) {
    return false;
  }
  
  // Check for image file extensions
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lowerUrl);
}

/**
 * Check if URL is a valid image URL
 */
function isValidImageUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Azure OpenAI API for extracting products - with improved error handling
 */
function queryAzureOpenAI(html) {
  if (!CONFIG.azure.apiKey || !CONFIG.azure.endpoint || !CONFIG.azure.deploymentName) {
    throw new Error("Azure OpenAI configuration is incomplete");
  }
  
  // Ensure endpoint ends with trailing slash
  const baseEndpoint = CONFIG.azure.endpoint.endsWith('/') 
    ? CONFIG.azure.endpoint 
    : CONFIG.azure.endpoint + '/';
  
  // Construct proper API URL
  const apiUrl = `${baseEndpoint}openai/deployments/${CONFIG.azure.deploymentName}/chat/completions?api-version=2023-05-15`;
  
  Logger.log(`Calling Azure OpenAI API at: ${apiUrl}`);
  
  const payload = {
    messages: [
      { role: "system", content: CONFIG.azure.systemPrompt },
      { role: "user", content: `Extract product titles from this HTML: ${html.substring(0, 6000)}` }
    ],
    temperature: 0.1,
    max_tokens: 2000
  };
  
  const options = {
    method: 'post',
    headers: {
      'api-key': CONFIG.azure.apiKey.trim(),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  for (let attempt = 0; attempt < CONFIG.request.retries; attempt++) {
    try {
      let resp = UrlFetchApp.fetch(apiUrl, options);
      let code = resp.getResponseCode();
      let text = resp.getContentText();
      
      Logger.log(`Azure OpenAI response code: ${code}`);
      
      if (code === 200) {
        let result = JSON.parse(text);
        if (result.choices && result.choices[0]) {
          let content = result.choices[0].message.content.trim();
          // Attempt to find array
          if (!content.startsWith("[")) {
            let arrMatch = content.match(/(\[[\s\S]*\])/);
            if (arrMatch && arrMatch[1]) {
              content = arrMatch[1];
            }
          }
          
          try {
            let products = JSON.parse(content);
            if (Array.isArray(products)) {
              return products.filter(p => typeof p === 'string').map(cleanText);
            }
          } catch (e) {
            Logger.log(`Error parsing Azure OpenAI response: ${e.message}`);
            return [];
          }
        }
        throw new Error(result.error?.message || 'Unknown Azure OpenAI parse error');
      } else {
        Logger.error("AZURE", `HTTP ${code}: ${text}`);
        throw new Error(`HTTP ${code}: ${text}`);
      }
    } catch (err) {
      if (attempt === CONFIG.request.retries - 1) {
        throw err;
      }
      Logger.log(`Retry ${attempt + 1} after error: ${err.message}`);
      Utilities.sleep(CONFIG.request.delay * (attempt + 1));
    }
  }
  throw new Error('Azure OpenAI extraction: All retries failed.');
}

/**
 * Generic regex approach for product extraction
 */
function extractProductsWithRegex(html) {
  let resultSet = new Set();
  for (let selector of CONFIG.regexSelectors) {
    const matches = html.matchAll(selector);
    for (let match of matches) {
      let text = match[2] || match[1] || "";
      text = cleanText(text);
      if (text.length > 2) {
        resultSet.add(text);
      }
    }
  }
  return Array.from(resultSet);
}

/**
 * Domain-specific extraction for tasteful.me
 */
function extractTastefulProducts(html) {
  let result = [];
  // Known pattern: "Visit something »"
  const pattern = /Visit\s+([^»]+)»/gi;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    let product = cleanText(m[1]);
    if (product && product.length > 2) result.push(product);
  }
  // Additional headings
  const headingPattern = /<h2[^>]*>([^<]+)<\/h2>/gi;
  while ((m = headingPattern.exec(html)) !== null) {
    let candidate = cleanText(m[1]);
    if (candidate === candidate.toUpperCase() && candidate.length > 3) {
      result.push(candidate);
    }
  }
  return result;
}

/**
 * Domain-specific extraction for foodysfoods.com
 */
function extractFoodysFoods(html) {
  let result = [];
  const pattern = /<[^>]*class="[^"]*title-2[^"]*"[^>]*>(.*?)<\/[^>]+>/gi;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    let product = cleanText(m[1]);
    if (product && product.length > 2) result.push(product);
  }
  return result;
}

/**
 * Heuristic approach for product extraction
 */
function heuristicLineExtraction(translatedText) {
  let textContent = translatedText.replace(/\r?\n+/g, "\n");
  let lines = textContent.split('\n').map(l => cleanText(l)).filter(Boolean);
  const productIndicators = [
    "frozen", "vac", "grade", "kg", "g ", "pork", "beef", "fish", "tail",
    "heart", "liver", "snout", "chicken", "drumstick", "pack", "package",
    "c12kg", "feet", "pancreas", "chocolate", "spice", "herb", "flour", "butter",
    "milk", "cream", "oil", "nut", "jam", "honey", "dip", "bread", "pastry"
  ];
  let results = [];
  for (let line of lines) {
    const lowerLine = line.toLowerCase();
    if (productIndicators.some(ind => lowerLine.includes(ind))) {
      if (line.length > 2 && line.length < 200) {
        results.push(line);
      }
    }
  }
  return [...new Set(results)];
}

/***************************************************************
 * FILTER & TRANSLATION
 ***************************************************************/
/**
 * Filter products to remove invalid entries
 */
function filterProducts(products) {
  let results = [];
  for (let p of products) {
    const trimmed = p.trim();
    const normalized = trimmed.replace(/[^\w\s]/g, "").toUpperCase();
    if (normalized.length < 3 || normalized.length > 200) continue;
    
    // Check for banned phrases
    let banned = false;
    for (let ban of CONFIG.bannedPhrases) {
      if (normalized.includes(ban)) {
        banned = true;
        break;
      }
    }
    if (banned) continue;
    
    // Check for code or CSS
    if (looksLikeCodeOrCss(trimmed)) continue;
    
    // Must contain at least one "food word"
    let lowered = trimmed.toLowerCase();
    let hasFoodWord = CONFIG.foodWords.some(fw => lowered.includes(fw));
    if (!hasFoodWord) continue;
    
    results.push(trimmed);
  }
  return results;
}

/**
 * Check if text looks like code or CSS
 */
function looksLikeCodeOrCss(line) {
  const patterns = [
    /[{};]/,
    /--\w+/,
    /\bvar\s+\w+/i,
    /\bfunction\s*\(/i,
    /\bwindow\./i,
    /\bdocument\./i,
    /\/\*/,
    /background\s*:/i,
    /position\s*:/i,
    /\=\s*['"]/
  ];
  for (let pat of patterns) {
    if (pat.test(line)) return true;
  }
  return false;
}

/**
 * Translate text safely
 */
function safeTranslate(text) {
  try {
    let translated = LanguageApp.translate(text, "auto", "en");
    return translated;
  } catch (e) {
    Logger.log(`Translation error: ${e.message}`);
    return text; 
  }
}

/***************************************************************
 * SHEET WRITING - COMMA-SEPARATED FORMAT
 ***************************************************************/
/**
 * Write products and images to sheet in comma-separated format
 */
function writeProductsToSheet(sheet, row, products, images) {
  // Join all products with comma for single cell
  const productString = products.join(", ");
  sheet.getRange(row, CONFIG.columns.productsStart).setValue(productString);
  
  // Write images as comma-separated list
  if (images && images.length > 0) {
    const imageString = images.join(", ");
    sheet.getRange(row, CONFIG.columns.images).setValue(imageString);
  }
}

/***************************************************************
 * BASIC UTILS
 ***************************************************************/
/** Fetch webpage with error handling */
function fetchWebpage(url) {
  const options = {
    muteHttpExceptions: true,
    followRedirects: true,
    timeout: CONFIG.request.timeout,
    headers: { "User-Agent": "Mozilla/5.0" }
  };
  const resp = UrlFetchApp.fetch(url, options);
  const code = resp.getResponseCode();
  if (code === 200) {
    return resp.getContentText();
  } else {
    if (code === 403) throw new Error("Access denied by website (403)");
    if (/DNS/.test(resp.getContentText())) throw new Error("Website not found (DNS error)");
    throw new Error(`Failed to fetch webpage: ${code}`);
  }
}

/** Merge arrays uniquely */
function mergeUnique(a1, a2) {
  const merged = new Set(a1);
  for (let item of a2) merged.add(item);
  return Array.from(merged);
}

/** Clean text */
function cleanText(txt) {
  if (!txt) return "";
  return txt
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert relative URL to absolute */
function absoluteUrl(linkUrl, baseUrl) {
  if (!linkUrl) return null;
  if (/^https?:\/\//i.test(linkUrl)) {
    return linkUrl;
  }
  try {
    return new URL(linkUrl, baseUrl).href;
  } catch (e) {
    return null;
  }
}

/** Check if URL is valid */
function isValidUrl(u) {
  if (!u) return false;
  return /^https?:\/\//i.test(u);
}

/** Escape string for regex */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/***************************************************************
 * STATUS & LOGGING
 ***************************************************************/
function updateStatus(sheet, row, status) {
  sheet.getRange(row, CONFIG.columns.status).setValue(status);
}

function updateProgress(sheet, pct) {
  let blocks = Math.floor(pct / 5);
  let bar = "▓".repeat(blocks) + "░".repeat(20 - blocks);
  sheet.getRange(1, CONFIG.columns.status).setValue(`Progress: ${bar} ${pct}%`);
  
  // Update global state for UI
  PropertiesService.getScriptProperties().setProperty("PROGRESS_PCT", String(pct));
}

function clearStatusColumn(sheet) {
  const lastRow = sheet.getLastRow();
  sheet.getRange(2, CONFIG.columns.status, lastRow - 1, 1).clearContent();
  sheet.getRange(1, CONFIG.columns.status).setValue("Ready to start...");
}

function logError(errorSheet, error, rowNum, vendor, url) {
  errorSheet.appendRow([
    new Date(),
    rowNum || "N/A",
    vendor || "Unknown",
    url || "N/A",
    error.message,
    error.stack
  ]);
}

function logSuccess(logSheet, row, vendor, url, productCount, imageCount) {
  logSheet.appendRow([
    new Date(), 
    row, 
    vendor, 
    url, 
    "SUCCESS", 
    `Extracted ${productCount} products and ${imageCount || 0} images`
  ]);
}

function logProcessingStart(logSheet, totalRows) {
  logSheet.appendRow([new Date(), `Starting extraction for ${totalRows} rows`]);
}

function finalizeProcessing(sheet, logSheet) {
  PropertiesService.getScriptProperties().deleteProperty("resumeRow");
  sheet.getRange(1, CONFIG.columns.productsStart).setValue(`Last Updated: ${new Date().toLocaleString()}`);
  logSheet.appendRow([new Date(), "Processing complete"]);
}

/***************************************************************
 * VALIDATION & STATE MANAGEMENT
 ***************************************************************/
function validateEnvironment(sheet) {
  if (!sheet) throw new Error(`Sheet "${CONFIG.sheetName}" not found`);
}

function validateApiKey() {
  if (!CONFIG.azure.apiKey) {
    throw new Error("Azure OpenAI API key not found. Please set it in Script Properties.");
  }
  if (!CONFIG.azure.endpoint) {
    throw new Error("Azure OpenAI endpoint not found. Please set it in Script Properties.");
  }
  if (!CONFIG.azure.deploymentName) {
    throw new Error("Azure OpenAI deployment name not found. Please set it in Script Properties.");
  }
}

function saveResumePosition(row) {
  PropertiesService.getScriptProperties().setProperty("resumeRow", String(row));
}

function getResumePosition() {
  return Number(PropertiesService.getScriptProperties().getProperty("resumeRow")) || 2;
}

/***************************************************************
 * CUSTOM MENU & UI INTEGRATION
 ***************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🛒 Product Extractor")
    .addItem("⚙️ Setup API Key", "setupApiKey")
    .addItem("🔌 Test Connection", "testApiConnection")
    .addItem("🔍 Diagnose Problems", "runDiagnosis")
    .addSeparator()
    .addItem("▶️ Start Extraction", "extractAllProducts")
    .addItem("⏸️ Pause/Resume", "togglePause")
    .addItem("🔄 Reset Progress", "resetProgress")
    .addSeparator()
    .addItem("📊 Show Logs", "showLogs")
    .addItem("🖥️ Open Web Dashboard", "openWebDashboard")
    .addToUi();
}

function setupApiKey() {
  const ui = SpreadsheetApp.getUi();
  
  let resp = ui.prompt("Azure OpenAI Setup", "Enter your Azure OpenAI API Key:", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty("AZURE_OPENAI_KEY", resp.getResponseText().trim());
  }
  
  resp = ui.prompt("Azure OpenAI Endpoint", "Enter your Azure OpenAI Endpoint URL:", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty("AZURE_OPENAI_ENDPOINT", resp.getResponseText().trim());
  }
  
  resp = ui.prompt("Azure OpenAI Deployment", "Enter your Azure OpenAI Deployment Name:", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty("AZURE_OPENAI_DEPLOYMENT", resp.getResponseText().trim());
  }
  
  ui.alert("API configuration saved successfully!");
}

function testApiConnection() {
  const ui = SpreadsheetApp.getUi();
  try {
    // Execute diagnosis and show a simple pass/fail message
    const diagResults = diagnoseProblem();
    if (diagResults.success) {
      ui.alert("Success", "Azure OpenAI API is working!", ui.ButtonSet.OK);
    } else {
      ui.alert("Error", `Azure OpenAI API test failed: ${diagResults.message}`, ui.ButtonSet.OK);
    }
  } catch (error) {
    ui.alert("Error", `Azure OpenAI API test failed: ${error.message}`, ui.ButtonSet.OK);
  }
}

function togglePause() {
  const props = PropertiesService.getScriptProperties();
  const paused = props.getProperty("EXTRACTION_PAUSED") === "true";
  if (paused) {
    props.deleteProperty("EXTRACTION_PAUSED");
    SpreadsheetApp.getActiveSpreadsheet().toast("Extraction resumed", "Product Extractor");
    extractAllProducts();
  } else {
    props.setProperty("EXTRACTION_PAUSED", "true");
    SpreadsheetApp.getActiveSpreadsheet().toast("Extraction paused", "Product Extractor");
  }
}

function resetProgress() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert("Reset Progress", "This will reset all progress. Continue?", ui.ButtonSet.YES_NO)
      === ui.Button.YES) {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty("EXTRACTION_PAUSED");
    props.deleteProperty("resumeRow");
    props.setProperty("PROGRESS_PCT", "0");
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheetName);
    clearStatusColumn(sheet);
    ui.alert("Progress Reset", "All progress has been reset.", ui.ButtonSet.OK);
  }
}

function showLogs() {
  const ui = SpreadsheetApp.getUi();
  getLogSheet(SpreadsheetApp.getActiveSpreadsheet());
  ui.alert("Logs", `Please see the "${CONFIG.logSheetName}" sheet.`, ui.ButtonSet.OK);
}

function openWebDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setWidth(800)
    .setHeight(600)
    .setTitle('AI Product Extractor');
  SpreadsheetApp.getUi().showModalDialog(html, 'AI Product Extractor Dashboard');
}

/***************************************************************
 * SHEETS FOR ERRORS & LOGS
 ***************************************************************/
function getErrorSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.errorSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.errorSheetName);
    sheet.appendRow(["Timestamp", "Row", "Vendor", "URL", "Error", "Stack Trace"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getLogSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.logSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.logSheetName);
    sheet.appendRow(["Timestamp", "Row", "Vendor", "URL", "Status", "Message"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/***************************************************************
 * WEB APP IMPLEMENTATION
 ***************************************************************/
/**
 * Web app entry point - serves the HTML UI when accessed via GET request
 * @param {Object} e - Event parameter containing URL parameters
 * @returns {HtmlOutput} The web app HTML interface
 */
function doGet(e) {
  // Check if a specific page is requested via URL parameter
  if (e && e.parameter && e.parameter.page) {
    // Route to specific page
    switch (e.parameter.page.toLowerCase()) {
      case 'datacenter':
        return HtmlService.createTemplateFromFile('DataCenter')
          .evaluate()
          .setTitle('AI Extractor - Data Center')
          .addMetaTag('viewport', 'width=device-width, initial-scale=1');
      
      case 'stryke':
      case 'strykecenter':
        return HtmlService.createTemplateFromFile('StrykeCenter')
          .evaluate()
          .setTitle('AI Extractor - Stryke Center')
          .addMetaTag('viewport', 'width=device-width, initial-scale=1');
      
      case 'settings':
        return HtmlService.createTemplateFromFile('Settings')
          .evaluate()
          .setTitle('AI Extractor - Settings')
          .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
  }
  
  // Default: serve the main Index page
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('AI Extractor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function checkSystemStatus() {
  try {
    // Check API keys
    const apiKey = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_KEY');
    const endpoint = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_ENDPOINT');
    const deployment = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_DEPLOYMENT');
    
    const isPaused = PropertiesService.getScriptProperties().getProperty("EXTRACTION_PAUSED") === "true";
    const progress = Number(PropertiesService.getScriptProperties().getProperty("PROGRESS_PCT") || "0");
    
    if (!apiKey || !endpoint || !deployment) {
      return { 
        status: "API configuration missing", 
        level: "warning"
      };
    }
    
    if (isPaused) {
      return { 
        status: "Extraction paused", 
        level: "warning"
      };
    }
    
    if (progress > 0 && progress < 100) {
      return { 
        status: `Processing (${progress}%)`, 
        level: "success"
      };
    }
    
    return { 
      status: "Ready", 
      level: "success"
    };
  } catch (e) {
    return { 
      status: "Error: " + e.message, 
      level: "error" 
    };
  }
}

/**
 * Get extraction progress for UI
 */
function getExtractionProgress() {
  const progress = Number(PropertiesService.getScriptProperties().getProperty("PROGRESS_PCT") || "0");
  const currentRow = Number(PropertiesService.getScriptProperties().getProperty("resumeRow") || "0");
  const isPaused = PropertiesService.getScriptProperties().getProperty("EXTRACTION_PAUSED") === "true";
  
  return {
    percent: progress,
    currentRow: currentRow,
    isPaused: isPaused,
    lastUpdate: new Date().toISOString()
  };
}

/**
 * Get recent extraction statistics for UI
 */
function getExtractionStats() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(CONFIG.logSheetName);
    const errorSheet = ss.getSheetByName(CONFIG.errorSheetName);
    
    if (!logSheet || !errorSheet) {
      return {
        total: 0,
        success: 0,
        errors: 0,
        lastSuccess: null,
        lastError: null
      };
    }
    
    // Get last 20 log entries
    const logRange = logSheet.getRange(2, 1, Math.min(20, Math.max(0, logSheet.getLastRow()-1)), 6);
    const logValues = logRange.getValues();
    
    // Get last 10 error entries
    const errorRange = errorSheet.getRange(2, 1, Math.min(10, Math.max(0, errorSheet.getLastRow()-1)), 6);
    const errorValues = errorRange.getValues();
    
    // Calculate stats
    let successCount = 0;
    let lastSuccess = null;
    
    for (const row of logValues) {
      if (row[4] === "SUCCESS") {
        successCount++;
        if (!lastSuccess && row[0]) lastSuccess = row[0];
      }
    }
    
    return {
      total: logValues.length,
      success: successCount,
      errors: errorValues.length,
      lastSuccess: lastSuccess ? lastSuccess.toISOString() : null,
      lastError: errorValues.length > 0 && errorValues[0][0] ? errorValues[0][0].toISOString() : null
    };
  } catch (e) {
    Logger.error("STATS", "Error getting extraction stats", e);
    return {
      total: 0,
      success: 0,
      errors: 0,
      lastSuccess: null,
      lastError: null,
      error: e.message
    };
  }
}

/**
 * Comprehensive diagnostic function for troubleshooting
 */
function diagnoseProblem() {
  try {
    // Check Azure configuration
    const apiKey = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_KEY');
    const endpoint = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_ENDPOINT');
    const deployment = PropertiesService.getScriptProperties().getProperty('AZURE_OPENAI_DEPLOYMENT');
    
    if (!apiKey) {
      return { success: false, message: "Azure OpenAI API key is missing" };
    }
    
    if (!endpoint) {
      return { success: false, message: "Azure OpenAI endpoint is missing" };
    }
    
    if (!deployment) {
      return { success: false, message: "Azure OpenAI deployment name is missing" };
    }
    
    // Ensure endpoint ends with trailing slash
    const baseEndpoint = endpoint.endsWith('/') ? endpoint : endpoint + '/';
    const apiUrl = `${baseEndpoint}openai/deployments/${deployment}/chat/completions?api-version=2023-05-15`;
    
    // Prepare a minimal test payload
    const payload = {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hello" }
      ],
      temperature: 0.1,
      max_tokens: 20
    };
    
    const options = {
      method: 'post',
      headers: {
        'api-key': apiKey.trim(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    let resp = UrlFetchApp.fetch(apiUrl, options);
    let code = resp.getResponseCode();
    
    if (code === 200) {
      let result = JSON.parse(resp.getContentText());
      if (result.choices && result.choices[0] && result.choices[0].message) {
        return { 
          success: true, 
          message: "Connection successful", 
          response: result.choices[0].message.content
        };
      } else {
        return { 
          success: false, 
          message: "Unexpected response format from API" 
        };
      }
    } else {
      return { 
        success: false, 
        message: `HTTP ${code}: ${resp.getContentText().substring(0, 100)}...` 
      };
    }
    
  } catch (e) {
    return { 
      success: false, 
      message: e.message,
      stack: e.stack
    };
  }
}

/**
 * Show Data Center UI panel
 */
function showDataCenter() {
  const html = HtmlService.createHtmlOutputFromFile('DataCenter')
    .setWidth(800)
    .setHeight(600)
    .setTitle('Data Center');
  SpreadsheetApp.getUi().showModalDialog(html, 'Data Center');
}

/**
 * Show Stryke Center UI panel
 */
function showStrykeCenter() {
  const html = HtmlService.createHtmlOutputFromFile('StrykeCenter')
    .setWidth(800)
    .setHeight(600)
    .setTitle('Stryke Center');
  SpreadsheetApp.getUi().showModalDialog(html, 'Stryke Center');
}

/**
 * Show Settings UI panel
 */
function showSettings() {
  const html = HtmlService.createHtmlOutputFromFile('Settings')
    .setWidth(600)
    .setHeight(500)
    .setTitle('Settings');
  SpreadsheetApp.getUi().showModalDialog(html, 'Settings');
}

/**
 * Start extraction from web UI
 */
function startExtractionFromUI() {
  try {
    // Clear paused flag
    PropertiesService.getScriptProperties().deleteProperty("EXTRACTION_PAUSED");
    
    // Start extraction in a new thread
    var lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        // Run extraction
        extractAllProducts();
        return { success: true, message: "Extraction started successfully" };
      } finally {
        lock.releaseLock();
      }
    } else {
      return { success: false, message: "Another extraction is already running" };
    }
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Pause extraction from web UI
 */
function pauseExtractionFromUI() {
  try {
    PropertiesService.getScriptProperties().setProperty("EXTRACTION_PAUSED", "true");
    return { success: true, message: "Extraction paused successfully" };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Resume extraction from web UI
 */
function resumeExtractionFromUI() {
  try {
    PropertiesService.getScriptProperties().deleteProperty("EXTRACTION_PAUSED");
    extractAllProducts();
    return { success: true, message: "Extraction resumed successfully" };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * Run diagnosis from UI
 */
function runDiagnosis() {
  const results = diagnoseProblem();
  const ui = SpreadsheetApp.getUi();
  if (results.success) {
    ui.alert("Diagnostic Results", "All systems operational.\n\nAPI test response: " + results.response, ui.ButtonSet.OK);
  } else {
    ui.alert("Diagnostic Results", "Problem detected: " + results.message, ui.ButtonSet.OK);
  }
}

/**
 * Test URL extraction functionality
 */
function testUrlExtraction(url) {
  try {
    // Validate URL
    if (!isValidUrl(url)) {
      throw new Error('Invalid URL format');
    }
    
    // Extract without saving to sheet
    CONFIG.visited.clear();
    const result = crawlPageForProducts(url, 0);
    
    return {
      url: url,
      products: result.products,
      images: result.images
    };
  } catch (e) {
    Logger.error('TEST', `Test extraction failed for ${url}`, e);
    throw e;
  }
}

/**
 * Process batch of URLs
 */
function processBatchUrls(urls) {
  const results = [];
  
  for (const url of urls) {
    try {
      const result = testUrlExtraction(url);
      results.push(result);
    } catch (e) {
      results.push({
        url: url,
        error: e.message
      });
    }
  }
  
  return results;
}

/**
 * Classify product text
 */
function classifyProductText(text) {
  try {
    if (typeof DataProcessor !== 'undefined' && DataProcessor.classifyProduct) {
      return DataProcessor.classifyProduct({
        name: text,
        description: text
      });
    } else {
      // Use Azure OpenAI as fallback if DataProcessor is not available
      const payload = {
        messages: [
          { 
            role: "system", 
            content: "You are a product classification expert. Analyze the following product and provide a JSON response with category, subcategory, and attributes." 
          },
          { role: "user", content: text }
        ]
      };
      
      const response = queryAzureOpenAI(JSON.stringify(payload));
      return { 
        text: text,
        classification: response
      };
    }
  } catch (e) {
    Logger.error('CLASSIFY', 'Classification error', e);
    throw e;
  }
}

/**
 * Save Azure settings
 */
function saveAzureSettings(apiKey, endpoint, deployment) {
  try {
    if (apiKey) {
      PropertiesService.getScriptProperties().setProperty('AZURE_OPENAI_KEY', apiKey);
      CONFIG.azure.apiKey = apiKey;
    }
    
    if (endpoint) {
      PropertiesService.getScriptProperties().setProperty('AZURE_OPENAI_ENDPOINT', endpoint);
      CONFIG.azure.endpoint = endpoint;
    }
    
    if (deployment) {
      PropertiesService.getScriptProperties().setProperty('AZURE_OPENAI_DEPLOYMENT', deployment);
      CONFIG.azure.deploymentName = deployment;
    }
    
    return { success: true };
  } catch (e) {
    Logger.error('SETTINGS', 'Error saving Azure settings', e);
    throw e;
  }
}

/**
 * Save extraction settings
 */
function saveExtractionSettings(maxDepth, maxProducts, translateEnabled, requestDelay) {
  try {
    const props = PropertiesService.getScriptProperties();
    
    props.setProperty('MAX_DEPTH', maxDepth);
    props.setProperty('MAX_PRODUCTS', maxProducts);
    props.setProperty('TRANSLATE_ENABLED', String(translateEnabled));
    props.setProperty('REQUEST_DELAY', requestDelay);
    
    // Update runtime configuration
    CONFIG.maxDepth = Number(maxDepth);
    CONFIG.maxProducts = Number(maxProducts);
    CONFIG.translateToEnglish = translateEnabled;
    CONFIG.request.delay = Number(requestDelay);
    
    return { success: true };
  } catch (e) {
    Logger.error('SETTINGS', 'Error saving extraction settings', e);
    throw e;
  }
}

/**
 * Get filter settings
 */
function getFilterSettings() {
  return {
    BANNED_PHRASES: CONFIG.bannedPhrases.join('\n'),
    FOOD_WORDS: CONFIG.foodWords.join('\n')
  };
}

/**
 * Save filter settings
 */
function saveFilterSettings(bannedPhrases, foodWords) {
  try {
    const bannedArray = bannedPhrases.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(phrase => phrase.toUpperCase());
    
    const foodArray = foodWords.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(word => word.toLowerCase());
    
    // Update runtime configuration
    CONFIG.bannedPhrases = bannedArray;
    CONFIG.foodWords = foodArray;
    
    // Store in script properties (for persistence)
    PropertiesService.getScriptProperties().setProperty(
      'BANNED_PHRASES', 
      JSON.stringify(bannedArray)
    );
    
    PropertiesService.getScriptProperties().setProperty(
      'FOOD_WORDS', 
      JSON.stringify(foodArray)
    );
    
    return { success: true };
  } catch (e) {
    Logger.error('SETTINGS', 'Error saving filter settings', e);
    throw e;
  }
}

/**
 * Save appearance settings
 */
function saveAppearanceSettings(theme, language) {
  try {
    PropertiesService.getScriptProperties().setProperty('DISPLAY_THEME', theme);
    PropertiesService.getScriptProperties().setProperty('DISPLAY_LANGUAGE', language);
    
    return { success: true };
  } catch (e) {
    Logger.error('SETTINGS', 'Error saving appearance settings', e);
    throw e;
  }
}

/**
 * Get all settings
 */
function getAllSettings() {
  const props = PropertiesService.getScriptProperties().getProperties();
  
  // Filter out sensitive information
  const filtered = {};
  for (const key in props) {
    if (!key.includes("KEY") && !key.includes("PASSWORD")) {
      filtered[key] = props[key];
    } else {
      filtered[key] = "[SECURED]";
    }
  }
  
  // Add current configuration
  filtered.MAX_DEPTH = CONFIG.maxDepth;
  filtered.MAX_PRODUCTS = CONFIG.maxProducts;
  filtered.TRANSLATE_ENABLED = CONFIG.translateToEnglish;
  filtered.REQUEST_DELAY = CONFIG.request.delay;
  filtered.AZURE_OPENAI_ENDPOINT = CONFIG.azure.endpoint;
  filtered.AZURE_OPENAI_DEPLOYMENT = CONFIG.azure.deploymentName;
  filtered.DISPLAY_THEME = props.DISPLAY_THEME || 'light';
  filtered.DISPLAY_LANGUAGE = props.DISPLAY_LANGUAGE || 'en';
  
  return filtered;
}

/***************************************************************
 * LOGGER IMPLEMENTATION
 ***************************************************************/
/**
 * Enhanced logging system
 */
const Logger = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },

  currentLevel: 1, // Default to INFO

  /**
   * Set minimum log level
   */
  setLevel: function(level) {
    if (this.levels[level] !== undefined) {
      this.currentLevel = this.levels[level];
    }
  },

  /**
   * Log debug message
   */
  debug: function(category, message, data) {
    if (this.currentLevel <= this.levels.DEBUG) {
      this._log("DEBUG", category, message, data);
    }
    //original logger.log:
    console.log(`[DEBUG] [${category}] ${message}`, data || '');
  },

  /**
   * Log info message
   */
  info: function(category, message, data) {
    if (this.currentLevel <= this.levels.INFO) {
      this._log("INFO", category, message, data);
    }
    //original logger.log:
    console.log(`[INFO] [${category}] ${message}`, data || '');
  },

  /**
   * Log warning message
   */
  warn: function(category, message, data) {
    if (this.currentLevel <= this.levels.WARN) {
      this._log("WARN", category, message, data);
    }
    //original logger.log:
     console.log(`[WARN] [${category}] ${message}`, data || '');
  },

  /**
   * Log error message
   */
  error: function(category, message, data) {
    if (this.currentLevel <= this.levels.ERROR) {
      this._log("ERROR", category, message, data);
    }
    //original logger.log:
     console.log(`[ERROR] [${category}] ${message}`, data || '');
  },

  /**
   * Internal logging function
   */
  _log: function(level, category, message, data) {
    // Store in script properties for UI access (limited to last 50 logs)
    try {
      const logs = JSON.parse(PropertiesService.getScriptProperties().getProperty("RECENT_LOGS") || "[]");

      // Add new log entry
      logs.unshift({
        timestamp: new Date().toISOString(),
        level: level,
        category: category,
        message: message,
        data: data ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : null
      });

      // Keep only the last 50 logs
      if (logs.length > 50) {
        logs.length = 50;
      }

      PropertiesService.getScriptProperties().setProperty("RECENT_LOGS", JSON.stringify(logs));
    } catch (e) {
      console.error("Error storing log entry:", e);
    }
  },

  /**
   * Get recent logs for UI
   */
  getRecentLogs: function(limit = 50) {
    try {
      const logs = JSON.parse(PropertiesService.getScriptProperties().getProperty("RECENT_LOGS") || "[]");
      return logs.slice(0, limit);
    } catch (e) {
      console.error("Error retrieving logs:", e);
      return [];
    }
  },

  /**
   * Clear logs
   */
  clearLogs: function() {
    PropertiesService.getScriptProperties().deleteProperty("RECENT_LOGS");
  }
};

