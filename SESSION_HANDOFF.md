# Session Handoff: High-Performance Payload Search

**Date:** June 22, 2026
**Target Component:** `src/components/MessageDetailPanel.tsx`

## Overview
This document details the architectural decisions, functionality, and constraints implemented during the recent feature development of the "High-Performance Payload Search" inside the Consumer tab's message details panel.

## Problem Statement
Previously, the app used `react-syntax-highlighter` alongside a highly customized mapping function that split the JSON payload by newlines and rendered thousands of individual React node lines to inject `<mark>` highlight tags. This approach caused massive Virtual DOM bloat and UI freezing when dealing with large message payloads (50,000+ characters), making real-time search unusable.

## Technical Solution & Architecture
We removed the React-bound looping mechanisms and shifted the heavy lifting directly to the browser's C++ HTML parser engine using `dangerouslySetInnerHTML`. 

### Key Implementations:
1. **Raw HTML Generation over VDOM:** 
   - We generate raw HTML strings. If a file is large (>50k chars) or if the user initiates a search, we completely bypass `SyntaxHighlighter` and fall back to raw `<pre dangerouslySetInnerHTML={{ __html: highlightedHtml }} />`.
2. **Debounce & Length Constraints:**
   - A custom `setTimeout` 300ms debounce loop protects the UI during rapid typing.
   - Searching only triggers when the input length is `>= 2` to prevent catastrophic multi-thousand match scenarios on single-letter inputs.
3. **Unicode Token Ringing (The Encoding Fix):**
   - We use a case-insensitive `RegExp` replacement engine (`'gi'`) to wrap matches.
   - *CRITICAL CONSTRAINT:* We temporarily wrap matches in strict Unicode control characters (`\u0001`, `\u0002`, `\u0003`) during the initial `replace()` run. E.g., `\u0001{count}\u0002{match}\u0003`. 
   - *Why?* If we inserted `<mark>` tags directly, the subsequent `escapeHtml()` function (which protects against XSS from the payload) would destroy them. We also avoided `\x01` notation as standard JSON parsers/bundlers can mangle it into literal `\\x01` string output.
   - After `escapeHtml()`, we perform a final regex replacement (`/\u0001(\d+)\u0002/g`) to safely convert the unicode tokens into `<mark id="search-match-$1">` HTML tags.
4. **Occurrence Tracking (`matchCount` & `currentMatchIndex`):**
   - The UI correctly tracks occurrences (e.g. `2 / 52`).
   - The user can press `Enter` while focused in the search input or use the Up/Down UI buttons to invoke `handleNextMatch()` or `handlePrevMatch()`.
   - A `useEffect` automatically triggers `element.scrollIntoView({ behavior: 'smooth', block: 'center' })` to bring the active match into view.
5. **Zero-Render Highlight Switching:**
   - Re-generating the 50,000+ character HTML string purely to change the background color of the *active* match would be extremely slow.
   - *Solution:* We inject a dynamic, tiny `<style>` block directly into the DOM just above the payload. The style block specifically targets `#search-match-${currentMatchIndex}` to give it a bright `var(--accent-color)` background and a white outline, while all other generic `.search-match` elements receive a faint, faded orange background. Navigating matches *only* triggers a React state update on this tiny `<style>` tag, leaving the massive payload DOM untouched.
6. **Smart Escape Key Flow:**
   - An `onKeyDown` handler listens for `Escape` on the input box.
   - If the user types a query, `Esc` -> clears the query, calls `e.stopPropagation()` to prevent the panel from closing.
   - If the query is empty, `Esc` -> calls `e.currentTarget.blur()` and `e.stopPropagation()`. 
   - Once blurred, the global `window` event listener in `ReadMessageList.tsx` takes over. The next `Esc` closes the side panel completely.

## Future Considerations
- If payloads exceed 5-10 Megabytes, even `dangerouslySetInnerHTML` might lock the main thread for 100-200ms during the initial regex replace execution. A potential future fix would be to pass the search regex and payload to a Web Worker, allowing it to construct the HTML string asynchronously off-thread, and post the final string back to the UI.
- `react-json-view` and `react-xml-viewer` were fully removed from the codebase to keep the bundle extremely lightweight, as `react-syntax-highlighter` already provides sufficient generic formatting.

## Status
All features are deployed, tested, and fully committed. The codebase is clean.
