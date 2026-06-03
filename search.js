#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'fs';
import { URL } from 'url';

// 1. Parse Arguments and Options
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: nodefisher <url> <selector> [options]

Crawls a site's sitemap to gather URLs, then loads each page in a headless
browser context to allow JavaScript/APIs to render, and checks if the query
selector is present.

Arguments:
  <url>                       The homepage or frontpage URL of the site to scan.
  <selector>                  The HTML node query selector to search for (e.g. ".target-class" or "a.link").

Options:
  -f, --format <format>       Output format: txt, json, or stdout (default: txt)
  -o, --output <file>         Custom output file path (default: results.txt or results.json)
  -c, --concurrency <number>  Number of concurrent browser pages (default: 5)
  -v, --verbose               Print progress and debug logs to stderr
  -h, --help                  Show this help message
`);
  process.exit(0);
}

let format = 'txt';
let output = null;
let concurrency = 5;
let verbose = false;
const positionals = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-f' || arg === '--format') {
    format = args[++i];
  } else if (arg === '-o' || arg === '--output') {
    output = args[++i];
  } else if (arg === '-c' || arg === '--concurrency') {
    const val = parseInt(args[++i], 10);
    if (!isNaN(val) && val > 0) {
      concurrency = val;
    }
  } else if (arg === '-v' || arg === '--verbose') {
    verbose = true;
  } else if (arg.startsWith('-')) {
    console.error(`Error: Unknown option: ${arg}`);
    process.exit(1);
  } else {
    positionals.push(arg);
  }
}

if (positionals.length < 2) {
  console.error("Error: Missing required arguments.");
  console.error("Usage: nodefisher <url> <selector> [options]");
  console.error("Run 'nodefisher --help' for options.");
  process.exit(1);
}

const [rawUrl, querySelector] = positionals;

// 2. Validate and Normalize URL
let originUrl = rawUrl;
if (!/^https?:\/\//i.test(originUrl)) {
  originUrl = 'https://' + originUrl;
}

try {
  new URL(originUrl);
} catch (err) {
  console.error(`Error: Invalid URL format "${rawUrl}"`);
  process.exit(1);
}

// Validate format option
if (!['txt', 'json', 'stdout'].includes(format)) {
  console.error(`Error: Invalid format "${format}". Supported: txt, json, stdout`);
  process.exit(1);
}

const userAgentStr = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 3. In-House Crawler Helper Functions
function validURL(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

async function processPageLinks(pageUrl, originUrl, verbose) {
  const pageLinks = [];
  try {
    if (verbose) {
      console.error(`Processing page: ${pageUrl}`);
    }
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': userAgentStr },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];

    const text = await res.text();
    const linkRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    const matches = text.matchAll(linkRegex);
    
    const origin = new URL(originUrl).origin;
    for (const match of matches) {
      try {
        const url = new URL(match[1]);
        if (url.origin === origin) {
          pageLinks.push(match[1]);
        }
      } catch {
        // ignore malformed link
      }
    }
  } catch (err) {
    if (verbose) {
      console.error(`[Warning] Failed to fetch page links from ${pageUrl}: ${err.message}`);
    }
  }
  return pageLinks;
}

async function processSitemap(sitemapUrl, originUrl, verbose, visitedSitemaps = new Set()) {
  if (visitedSitemaps.has(sitemapUrl)) return [];
  visitedSitemaps.add(sitemapUrl);

  if (verbose) {
    console.error(`Processing XML: ${sitemapUrl}`);
  }
  let pages = [];
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': userAgentStr },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];

    const text = await res.text();
    const locations = [...text.matchAll(/<loc>(.*?)<\/loc>/gi)].map(match => match[1].trim());

    for (const loc of locations) {
      if (loc.toLowerCase().includes('.xml')) {
        const nestedPages = await processSitemap(loc, originUrl, verbose, visitedSitemaps);
        pages.push(...nestedPages);
      } else {
        pages.push(loc);
        const nestedLinks = await processPageLinks(loc, originUrl, verbose);
        pages.push(...nestedLinks);
      }
    }
  } catch (err) {
    if (verbose) {
      console.error(`[Warning] Failed to process sitemap ${sitemapUrl}: ${err.message}`);
    }
  }
  return pages;
}

async function gatherUrls(originUrl, verbose) {
  if (verbose) {
    console.error(`Fetching robots.txt from: ${originUrl}/robots.txt`);
  }
  let sitemaps = [];
  try {
    const res = await fetch(`${originUrl}/robots.txt`, {
      headers: { 'User-Agent': userAgentStr },
      signal: AbortSignal.timeout(15000)
    });
    
    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        const delimiterIdx = trimmed.indexOf(':');
        if (delimiterIdx === -1) continue;

        const directive = trimmed.substring(0, delimiterIdx).trim().toLowerCase();
        const value = trimmed.substring(delimiterIdx + 1).trim();

        if (directive === 'sitemap') {
          if (validURL(value)) {
            sitemaps.push(value);
          } else {
            sitemaps.push(new URL(value, originUrl).href);
          }
        }
      }
    }
  } catch (err) {
    if (verbose) {
      console.error(`[Warning] Failed to fetch robots.txt: ${err.message}`);
    }
  }

  // Fallback to /sitemap.xml if none found in robots.txt
  if (sitemaps.length === 0) {
    if (verbose) {
      console.error(`No sitemaps found in robots.txt. Trying default sitemap path: ${originUrl}/sitemap.xml`);
    }
    sitemaps.push(`${originUrl}/sitemap.xml`);
  }

  let allUrls = [];
  const visitedSitemaps = new Set();
  for (const sitemap of sitemaps) {
    const pages = await processSitemap(sitemap, originUrl, verbose, visitedSitemaps);
    allUrls.push(...pages);
  }

  // Filter out duplicates, enforce origin matching, and omit static assets
  const origin = new URL(originUrl).origin;
  const staticExtensions = /\.(png|jpg|jpeg|gif|svg|css|js|pdf|mp4|mp3|woff2?|eot|ttf|otf|ico|zip|gz)$/i;

  return [...new Set(
    allUrls
      .map(u => u.trim())
      .filter(u => {
        try {
          const urlObj = new URL(u);
          return urlObj.origin === origin && !staticExtensions.test(urlObj.pathname);
        } catch {
          return false;
        }
      })
  )];
}

// 4. Main Controller
async function main() {
  console.error(`[1/3] Gathering URLs from robots.txt and sitemaps for: ${originUrl}...`);
  
  const urls = await gatherUrls(originUrl, verbose);

  if (urls.length === 0) {
    console.error("Error: No URLs found. Ensure the site has a robots.txt with sitemap directives, a sitemap.xml, or is reachable.");
    process.exit(1);
  }

  console.error(`[2/3] Discovered ${urls.length} unique page URLs. Scanning using Playwright (Chromium) for selector "${querySelector}" with concurrency ${concurrency}...`);

  // Launch browser
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    if (err.message.includes("Executable doesn't exist") || err.message.includes("playwright install")) {
      console.error("\nError: Playwright Chromium browser is not installed.");
      console.error("Please run the following command to download the required browser binaries:");
      console.error("  npx playwright install chromium\n");
      process.exit(1);
    }
    throw err;
  }

  let scannedCount = 0;
  const totalCount = urls.length;
  const matches = [];

  async function checkPage(url) {
    let context = null;
    try {
      // Isolated browser context to prevent cookie/state bleed
      context = await browser.newContext({
        userAgent: userAgentStr,
        viewport: { width: 1280, height: 800 }
      });
      const page = await context.newPage();
      
      // Navigate and wait for general load
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      
      // Wait for selector to be attached to DOM
      await page.waitForSelector(querySelector, { state: 'attached', timeout: 5000 });
      
      if (verbose) {
        console.error(`[Match] Found selector "${querySelector}" at: ${url}`);
      }
      return url;
    } catch (err) {
      if (verbose) {
        if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
          console.error(`[Info] Selector not found on page: ${url}`);
        } else {
          console.error(`[Error] Failed to process ${url}: ${err.message}`);
        }
      }
      return null;
    } finally {
      if (context) {
        await context.close();
      }
    }
  }

  async function worker() {
    while (urls.length > 0) {
      const url = urls.shift();
      if (!url) continue;

      const match = await checkPage(url);
      if (match) {
        matches.push(match);
        if (format === 'stdout') {
          console.log(match); // Stream immediate match to stdout
        }
      }

      scannedCount++;
      if (verbose || scannedCount % 5 === 0 || scannedCount === totalCount) {
        console.error(`Progress: ${scannedCount}/${totalCount} pages processed (${Math.round((scannedCount / totalCount) * 100)}%)`);
      }
    }
  }

  try {
    // Launch parallel browser tab workers
    const numWorkers = Math.min(concurrency, totalCount);
    const workers = Array.from({ length: numWorkers }, worker);
    await Promise.all(workers);
  } finally {
    await browser.close();
  }

  // 5. Output matches
  console.error(`[3/3] Scanning complete. Found ${matches.length} matching page(s).`);

  if (format === 'json') {
    const outPath = output || 'results.json';
    fs.writeFileSync(outPath, JSON.stringify(matches, null, 2), 'utf-8');
    console.error(`Saved matches to file: ${outPath}`);
  } else if (format === 'txt') {
    const outPath = output || 'results.txt';
    fs.writeFileSync(outPath, matches.join('\n') + (matches.length > 0 ? '\n' : ''), 'utf-8');
    console.error(`Saved matches to file: ${outPath}`);
  }
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
