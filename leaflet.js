/*
 * Shared by every e-Leaflet page (Home + the five section pages).
 * Load it in <head>, right after the Tailwind CDN script.
 *
 * 1. Tailwind theme (colours, fonts, shadows) used by the page markup.
 * 2. "Download PDF" on Home builds one PDF of the whole leaflet. It opens each
 *    section page in a hidden frame and asks it for its text. Frames answer via
 *    postMessage, so this also works when the files are opened straight from
 *    disk (file://), where fetch() is blocked.
 *
 * 3. "Listen" button (#listen-button) on every page reads the page aloud with
 *    the browser's built-in speech (Web Speech API). No audio files needed.
 *    Auto mode: every page also starts reading by itself as soon as it opens.
 *    Browsers only allow speech after the reader has touched the site, so if a
 *    page is blocked, the first tap or key press starts the reading instead
 *    (that tap does not change page). The Listen button stops / restarts it.
 *
 * 4. Tap anywhere on the left half of the screen for the previous page, or the
 *    right half for the next one (same as the green arrows). Taps on buttons,
 *    links and form fields keep doing their own thing.
 *
 * Page text that goes into the PDF is marked with a data-pdf attribute:
 *   Home:          data-pdf="lead" (start of the PDF) and data-pdf="end" (last)
 *   Section pages: data-pdf
 *
 * Page text that "Listen" reads is marked with data-speak, read in page order.
 * Put data-say="…" on an element to have it spoken differently from how it
 * looks, e.g. <span data-say="Prescription only">Rx Only</span>.
 */

if (typeof tailwind !== "undefined") {
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          sage: {
            50: "#F4F7F4",
            100: "#E8EFE8",
            200: "#D2DFD2",
            300: "#ADC4AD",
            400: "#7E9F7E",
            500: "#547A54",
            600: "#3D5E3D",
            700: "#2E482E",
            800: "#223622",
            900: "#162316",
          },
          pharmacy: {
            cream: "#F9F8F5",
            surface: "#FFFFFF",
            ink: "#1C281D",
            muted: "#627063",
            amberSoft: "#FFF7E6",
            amberBorder: "#FAD896",
            amberText: "#875104",
          },
        },
        fontFamily: {
          sans: [
            "system-ui",
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
            "Roboto",
            "sans-serif",
          ],
          serif: ["Georgia", "Cambria", "serif"],
        },
        boxShadow: {
          "soft-card": "0 2px 10px rgba(35, 60, 35, 0.05)",
          "float-card": "0 8px 24px rgba(35, 60, 35, 0.08)",
        },
      },
    },
  };
}

// Section pages in reading order. The PDF follows this order.
const LEAFLET_SECTION_PAGES = [
  "Batch%20Tracking.html",
  "Uses.html",
  "Directions.html",
  "Warnings.html",
  "Side%20Effects.html",
];
const LEAFLET_TEXT_REQUEST = "leaflet:text";
const LEAFLET_FRAME_TIMEOUT_MS = 15000;
// Auto mode: wait this long after the page loads before reading, and treat
// speech as blocked if it still hasn't started this long after that.
const LEAFLET_AUTOPLAY_DELAY_MS = 300;
const LEAFLET_AUTOPLAY_CHECK_MS = 3000;
// Taps on these keep their own action (they don't turn the page, and the
// first-tap audio start doesn't swallow them).
const LEAFLET_OWN_ACTION =
  "a, button, input, select, textarea, label, summary, [role='button'], [contenteditable]";

function leafletTextOf(selector) {
  return Array.from(
    document.querySelectorAll(selector),
    (element) => element.innerText,
  ).join("\n");
}

// Every leaflet page answers Home's request for its PDF text.
window.addEventListener("message", function (event) {
  if (event.data !== LEAFLET_TEXT_REQUEST || !event.source) return;
  event.source.postMessage({ leafletText: leafletTextOf("[data-pdf]") }, "*");
});

// Loads every section page in an off-screen frame and resolves with their texts, in order.
function collectSectionTexts() {
  return new Promise(function (resolve, reject) {
    const texts = [];
    let frames = [];
    let received = 0;

    function finish(error) {
      clearTimeout(timer);
      window.removeEventListener("message", onReply);
      frames.forEach((frame) => frame.remove());
      if (error) reject(error);
      else resolve(texts);
    }

    function onReply(event) {
      const index = frames.findIndex(
        (frame) => frame.contentWindow === event.source,
      );
      const text = event.data && event.data.leafletText;
      if (index === -1 || texts[index] !== undefined || typeof text !== "string")
        return;
      texts[index] = text;
      received += 1;
      if (received === frames.length) finish();
    }

    window.addEventListener("message", onReply);
    const timer = setTimeout(function () {
      finish(new Error("Some leaflet pages did not respond."));
    }, LEAFLET_FRAME_TIMEOUT_MS);

    frames = LEAFLET_SECTION_PAGES.map(function (page) {
      const frame = document.createElement("iframe");
      frame.className = "pdf-source-frame";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.addEventListener("load", function () {
        frame.contentWindow.postMessage(LEAFLET_TEXT_REQUEST, "*");
      });
      frame.src = page;
      document.body.appendChild(frame);
      return frame;
    });
  });
}

// Plain-text, multi-page A4 PDF (Courier 10pt, 48 lines per page).
function buildLeafletPdf(text) {
  const lines = [];
  for (const paragraph of text.split(/\n+/)) {
    const clean = paragraph
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) continue;
    let line = "";
    for (const word of clean.split(" ")) {
      if (line.length + word.length > 86) {
        lines.push(line);
        line = "";
      }
      line += (line ? " " : "") + word;
    }
    if (line) lines.push(line);
  }
  const escape = (value) => value.replace(/([\\()])/g, "\\$1");
  const objects = [
    null,
    "",
    "<< /Type /Catalog /Pages 1 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  const pages = [];
  for (let start = 0; start < lines.length; start += 48) {
    const pageId = objects.length,
      streamId = pageId + 1;
    pages.push(pageId + " 0 R");
    const content =
      "BT /F1 10 Tf 14 TL 40 795 Td\n" +
      lines
        .slice(start, start + 48)
        .map((line) => "(" + escape(line) + ") Tj T*")
        .join("\n") +
      "\nET\nBT /F1 9 Tf 40 30 Td (Patient Leaflet - Page " +
      pages.length +
      ") Tj ET";
    objects.push(
      "<< /Type /Page /Parent 1 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " +
        streamId +
        " 0 R >>",
    );
    objects.push(
      "<< /Length " +
        content.length +
        " >>\nstream\n" +
        content +
        "\nendstream",
    );
  }
  objects[1] =
    "<< /Type /Pages /Kids [" +
    pages.join(" ") +
    "] /Count " +
    pages.length +
    " >>";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += i + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xref = pdf.length;
  pdf += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  });
  pdf +=
    "trailer\n<< /Size " +
    objects.length +
    " /Root 2 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF";
  return pdf;
}

function saveLeafletPdf(pdf) {
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "Medicine-Patient-Leaflet.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- Listen: read the page aloud ---------- */

// Splits an element into spoken phrases: one per block, flex item or grid item,
// so the voice pauses between items instead of running them together.
function collectSpeechPhrases(root, phrases) {
  let current = "";
  const flush = function () {
    const text = current
      .replace(/[●™®·]/g, " ")
      .replace(/\s+\/\s+/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) phrases.push(text);
    current = "";
  };
  const walk = function (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches("svg, script, style, [aria-hidden='true']")) return;
    const display = getComputedStyle(node).display;
    if (display === "none") return;
    const parentDisplay = node.parentElement
      ? getComputedStyle(node.parentElement).display
      : "block";
    const isBlock =
      !display.startsWith("inline") || /flex|grid/.test(parentDisplay);
    if (isBlock) flush();
    if (node.hasAttribute("data-say")) {
      current += " " + node.getAttribute("data-say") + " ";
    } else {
      node.childNodes.forEach(walk);
    }
    if (isBlock) flush();
  };
  walk(root);
  flush();
}

function pageSpeechPhrases() {
  const raw = [];
  document
    .querySelectorAll("[data-speak]")
    .forEach((element) => collectSpeechPhrases(element, raw));
  // Keep "Label:" together with its value, e.g. "Expires: January 2027".
  const phrases = [];
  raw.forEach(function (text) {
    const last = phrases.length - 1;
    if (last >= 0 && /:$/.test(phrases[last])) phrases[last] += " " + text;
    else phrases.push(text);
  });
  return phrases;
}

function pickEnglishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.default && /^en/i.test(voice.lang)) ||
    voices.find((voice) => /^en-GB/i.test(voice.lang)) ||
    voices.find((voice) => /^en/i.test(voice.lang)) ||
    null
  );
}

document.addEventListener("DOMContentLoaded", function () {
  const button = document.getElementById("listen-button");
  if (!button) return;
  if (!("speechSynthesis" in window)) {
    button.hidden = true;
    return;
  }
  const speech = window.speechSynthesis;
  const label = button.querySelector("[data-listen-label]");
  const playIcon = button.querySelector("[data-listen-icon='play']");
  const stopIcon = button.querySelector("[data-listen-icon='stop']");
  let reading = false;
  let session = 0;

  function showReading(isReading) {
    reading = isReading;
    button.dataset.speaking = String(isReading);
    label.textContent = isReading ? "Stop" : "Listen";
    // SVG elements have no .hidden property, so set the attribute itself.
    playIcon.toggleAttribute("hidden", isReading);
    stopIcon.toggleAttribute("hidden", !isReading);
  }

  function stopReading() {
    session += 1;
    speech.cancel();
    showReading(false);
  }

  // Reads the page aloud. onBlocked runs if the browser refuses to speak
  // because the reader hasn't touched the page yet (autoplay rules).
  function startReading(onBlocked) {
    const phrases = pageSpeechPhrases();
    if (!phrases.length) return;
    if (speech.speaking || speech.pending) speech.cancel();
    speech.resume();
    const current = ++session;
    const voice = pickEnglishVoice();
    let started = false;

    function blocked() {
      if (current !== session) return; // already stopped or restarted
      stopReading();
      if (onBlocked) onBlocked();
    }

    // One utterance per phrase: natural pauses, and avoids Chrome cutting off
    // long utterances after ~15 seconds.
    phrases.forEach(function (text, index) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = document.documentElement.lang || "en";
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      utterance.onstart = function () {
        started = true;
      };
      utterance.onerror = function (event) {
        if (event.error === "not-allowed") blocked();
        else if (index === phrases.length - 1 && current === session)
          showReading(false);
      };
      if (index === phrases.length - 1) {
        utterance.onend = function () {
          if (current === session) showReading(false);
        };
      }
      speech.speak(utterance);
    });
    showReading(true);

    // Chrome reports a block with a "not-allowed" error; Safari can just stay
    // silent, so also give up if nothing has started after a few seconds.
    if (onBlocked) {
      setTimeout(function () {
        if (!started && !speech.speaking) blocked();
      }, LEAFLET_AUTOPLAY_CHECK_MS);
    }
  }

  button.addEventListener("click", function () {
    if (reading) stopReading();
    else startReading();
  });

  // Stop talking when the reader leaves the page.
  window.addEventListener("pagehide", function () {
    if (reading) stopReading();
  });

  /* Auto mode: read every page aloud as soon as it opens. */

  // Speech was blocked: the reader's first tap or key press starts it instead.
  function startOnFirstTouch() {
    function onFirst(event) {
      if (
        event.type === "keydown" &&
        /^(Escape|Shift|Control|Alt|Meta)$/.test(event.key)
      )
        return; // browsers don't count these as interacting with the page
      document.removeEventListener("click", onFirst, true);
      document.removeEventListener("keydown", onFirst, true);
      if (button.contains(event.target) || reading) return; // Listen handles itself
      startReading(startOnFirstTouch);
      // Use this tap to start the audio, not to turn the page.
      if (event.type === "click" && !event.target.closest(LEAFLET_OWN_ACTION))
        event.preventDefault();
    }
    document.addEventListener("click", onFirst, true);
    document.addEventListener("keydown", onFirst, true);
  }

  function autoRead() {
    // Skip the hidden frames Home loads to build the PDF.
    if (window.self !== window.top) return;
    startReading(startOnFirstTouch);
  }

  // Start once the page has finished loading and styling (Tailwind runs first).
  window.addEventListener("load", function () {
    setTimeout(autoRead, LEAFLET_AUTOPLAY_DELAY_MS);
  });
  // Also when coming back with the browser's Back button.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) autoRead();
  });
});

/* ---------- Tap the left / right side of the screen to change page ---------- */

document.addEventListener("DOMContentLoaded", function () {
  const pager = document.querySelector(".leaflet-pager");
  if (!pager) return;
  // On Home the first slot is a faded placeholder (<span>), so there is no Previous.
  const previous = pager.firstElementChild.matches("a.pager-link")
    ? pager.firstElementChild
    : null;
  const next = pager.lastElementChild.matches("a.pager-link")
    ? pager.lastElementChild
    : null;

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // detail is 0 for clicks that don't come from a real press (e.g. keyboard),
    // which carry no usable screen position.
    if (event.detail === 0) return;
    if (event.target.closest(LEAFLET_OWN_ACTION)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // finishing a text selection

    const onLeft = event.clientX < document.documentElement.clientWidth / 2;
    const link = onLeft ? previous : next;
    if (!link) return; // Home has nothing before it

    // Short buzz on phones that support it, so the tap is felt as well as seen.
    if (navigator.vibrate) navigator.vibrate(15);
    link.classList.add("is-pressed");
    window.location.href = link.href;
  });

  // Coming back with the browser's Back button can restore the page as it was
  // left, so clear the pressed look.
  window.addEventListener("pageshow", function () {
    pager
      .querySelectorAll(".is-pressed")
      .forEach((link) => link.classList.remove("is-pressed"));
  });
});

// Home only: wire up the "Download PDF" button.
document.addEventListener("DOMContentLoaded", function () {
  const button = document.getElementById("download-pdf");
  if (!button) return;
  const label = button.querySelector("[data-pdf-label]");
  const status = document.getElementById("pdf-status");

  button.addEventListener("click", async function () {
    button.disabled = true;
    label.textContent = "Preparing PDF…";
    if (status) status.textContent = "";
    try {
      const sections = await collectSectionTexts();
      const text = [
        leafletTextOf('[data-pdf="lead"]'),
        ...sections,
        leafletTextOf('[data-pdf="end"]'),
      ].join("\n");
      saveLeafletPdf(buildLeafletPdf(text));
    } catch (error) {
      if (status)
        status.textContent =
          "Some leaflet pages didn't load, so the PDF wasn't created. Keep all the leaflet files together in one folder, then try again.";
    } finally {
      button.disabled = false;
      label.textContent = "Download PDF";
    }
  });
});
