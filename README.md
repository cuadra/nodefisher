# Sitemap HTML Selector Scanner CLI (Playwright Edition)

<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/4b682047-6c0d-4d7b-928f-4c3badda3e00" />

A fast Node.js CLI tool that crawls a website's sitemap to gather all URLs, loads each page concurrently in a headless browser (using [Playwright](https://playwright.dev/)), and waits for client-side JavaScript/APIs to render before checking for a specified CSS/HTML query selector.

This allows detection of dynamic elements (e.g. login/newsletter forms, React/Vue/Angular rendered components, and third-party widgets) that are not present in static HTML sources.

## 🚀 Features

- **Programmatic Sitemap Gathering:** Parses `robots.txt` and recursively loads nested XML sitemaps to discover all page URLs.
- **Dynamic JS Rendering:** Uses headless Chromium to run all page scripts, load APIs, and render dynamic contents.
- **Smart Element Waiting:** Uses Playwright's `waitForSelector` to detect when target nodes are rendered, with a 5-second automatic timeout.
- **Controlled Concurrency:** Set a custom parallel tab/context limit (default: `5` concurrent pages) to optimize scraping speed without overloading systems or getting rate-limited.
- **Isolated Browser Contexts:** Every page is opened in its own isolated browser context, avoiding cookie/session contamination and maintaining clean execution states.
- **Multiple Output Formats:** Save results as standard line-delimited text (`txt`), a structured `json` array, or print matches directly to standard output (`stdout`) in real-time.
- **Clean Output Streams:** Matches write cleanly to `stdout` or files, while progress logs, warnings, and stats are sent to `stderr` for clean terminal piping.

---

## 📦 Installation

Ensure you have [Node.js](https://nodejs.org/) installed (version 18+ is recommended).

1. Install the CLI tool globally:
   ```bash
   npm install -g nodefisher
   ```
   *(Note: This will automatically download the required Chromium browser binary during the installation process.)*

---

## 🛠️ Usage

Run the tool using `nodefisher`:

```bash
nodefisher <url> <selector> [options]
```

### Required Arguments
- `<url>`: The frontpage/homepage URL of the website to crawl (e.g., `https://example.com` or simply `example.com`).
- `<selector>`: The CSS/HTML query selector to search for (e.g. `".target-class"`, `"#main-title"`, or `".newsletter-signup"`).

### Optional Flags
- `-f, --format <format>`: Output format. Options: `txt`, `json`, or `stdout` (default: `txt`).
- `-o, --output <file>`: Custom path to save the output file. Defaults to `results.txt` (for `txt` format) or `results.json` (for `json` format).
- `-c, --concurrency <number>`: Number of concurrent browser pages to process in parallel (default: `5`).
- `-v, --verbose`: Print detailed page processing, info messages (timeouts vs. success), and match detections to `stderr`.
- `-h, --help`: Display the help message.

---

## 💡 Examples

### 1. Basic Dynamic Scan (Default Text Output File)
Crawls `https://example.com` for dynamic elements matching `.newsletter-signup` and saves to `results.txt`:
```bash
nodefisher https://example.com ".newsletter-signup"
```

### 2. Save Results as JSON File (Verbose Mode)
Crawls and saves matching URLs into `matches.json` while printing detailed browser loading logs:
```bash
nodefisher example.com ".newsletter-signup" --format json --output matches.json --verbose
```

### 3. Print directly to Stdout (Real-time Streaming)
Prints matching URLs directly to standard output as they are found.
```bash
nodefisher https://example.com ".dynamic-element" --format stdout
```

### 4. Custom Concurrency
Scan a site using 10 concurrent browser context workers:
```bash
nodefisher example.com ".target-class" --concurrency 10
```

---

## ⚙️ How it Works

1. **URL Discovery:** The CLI takes the target URL, parses its `robots.txt` file, fetches sitemaps recursively, and outputs all unique URLs on the domain.
2. **Headless Browser Setup:** Playwright launches a headless Chromium instance.
3. **Parallel Worker Pool:** A worker queue pulls URLs. It initializes isolated browser contexts up to the `--concurrency` limit.
4. **JS Page Load:** Each worker navigates to its URL, allowing JavaScript to run and external APIs to load.
5. **Selector Matching:** The script invokes Playwright's `page.waitForSelector(selector, { timeout: 5000 })`. If the element renders within 5 seconds, the page is flagged as a match. If it does not appear (or the page fails to load), the page is skipped.
6. **Output Writing:** Matching URLs are saved/printed based on the chosen output format.
