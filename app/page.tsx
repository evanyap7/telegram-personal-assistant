"use client";

import { useState } from "react";
import {
  IconContactless,
  IconNfcWaves,
  IconBolt,
  IconPubSub,
  IconMicrophone,
  IconCameraScan,
  IconCalendar,
  IconClock,
  IconShield,
  IconTerminal,
  IconSheetTable,
  IconTelegram,
  IconLinkedIn,
  IconGitHub,
  IconPencil,
  IconTrash,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconSparkles,
  IconActivity,
  IconDatabase,
  IconLayers,
  IconCodeBracket,
} from "@/components/icons";

type ShowcaseKey = "apple-pay" | "paylah" | "voice" | "vision" | "calendar";

const ACCENT: Record<ShowcaseKey, { bg: string; border: string; text: string; badge: string }> = {
  "apple-pay": { bg: "bg-[#4d7cff]", border: "border-[#4d7cff]", text: "text-white", badge: "bg-[#4d7cff] text-white" },
  paylah: { bg: "bg-[#9b6bff]", border: "border-[#9b6bff]", text: "text-white", badge: "bg-[#9b6bff] text-white" },
  voice: { bg: "bg-[#ffd21f]", border: "border-[#ffd21f]", text: "text-[#0a0a0a]", badge: "bg-[#ffd21f] text-[#0a0a0a]" },
  vision: { bg: "bg-[#3ecf6e]", border: "border-[#3ecf6e]", text: "text-[#0a0a0a]", badge: "bg-[#3ecf6e] text-[#0a0a0a]" },
  calendar: { bg: "bg-[#2bd4c7]", border: "border-[#2bd4c7]", text: "text-[#0a0a0a]", badge: "bg-[#2bd4c7] text-[#0a0a0a]" },
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<ShowcaseKey>("apple-pay");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "sheet">("card");
  const [interactiveCategory, setInteractiveCategory] = useState<string>("Dining");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("All");

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const showcaseData: Record<
    ShowcaseKey,
    {
      title: string;
      badge: string;
      icon: React.ReactNode;
      description: string;
      terminal: Array<{ role: "device" | "system" | "ai" | "bot"; label: string; text: string }>;
      previewCard: {
        header: string;
        lines: Array<{ label: string; value: string }>;
      };
      sheetRow: {
        timestamp: string;
        type: string;
        amount: string;
        category: string;
        description: string;
        status: string;
      };
    }
  > = {
    "apple-pay": {
      title: "Apple Pay Tap-to-Log",
      badge: "iOS 17+ Shortcuts",
      icon: <IconContactless className="w-4 h-4" />,
      description:
        "Tap your iPhone at any physical terminal. iOS Shortcuts fires a cryptographically signed HMAC webhook to log the expense and send an interactive Telegram card.",
      terminal: [
        { role: "device", label: "NFC_SIGNAL", text: "Apple Pay NFC tap detected: S$14.50 at 'Toast Box'" },
        { role: "system", label: "WEBHOOK", text: "POST /api/apple-wallet [200 OK • 380ms latency]" },
        { role: "ai", label: "AI_INFERENCE", text: "Gemini 3.6 Flash: Category 'Dining' • Item 'Kaya Toast Set'" },
        { role: "bot", label: "TELEGRAM", text: "Dispatched interactive card with live action callbacks" },
      ],
      previewCard: {
        header: "Apple Pay Expense Recorded",
        lines: [
          { label: "Item", value: "Kaya Toast Set" },
          { label: "Amount", value: "SGD 14.50" },
          { label: "Merchant", value: "Toast Box (Marina Bay Sands)" },
          { label: "Category", value: interactiveCategory },
          { label: "Storage", value: "Google Sheets • Row #34 (Active)" },
        ],
      },
      sheetRow: {
        timestamp: "07 Sep 2026 @ 3:13 PM",
        type: "expense",
        amount: "SGD 14.50",
        category: interactiveCategory,
        description: "Kaya Toast Set @ Toast Box (Apple Pay)",
        status: "active",
      },
    },
    paylah: {
      title: "DBS PayLah! & PayNow Push",
      badge: "Cloud Pub/Sub",
      icon: <IconPubSub className="w-4 h-4" />,
      description:
        "Event-driven push architecture. Whenever DBS emails a payment receipt, Google Cloud Pub/Sub pushes it directly to the serverless webhook for regex extraction.",
      terminal: [
        { role: "device", label: "GMAIL_EVENT", text: "DBS Transaction Alert: 'SGD 8.60 to FOMO PAY'" },
        { role: "system", label: "PUB/SUB", text: "Push event dispatched → /api/gmail-webhook [200 OK]" },
        { role: "ai", label: "REGEX_PARSER", text: "Extracted Ref #IPS7887651859 • Auto-categorized 'Dining'" },
        { role: "bot", label: "TELEGRAM", text: "Google Sheets appended & interactive card dispatched" },
      ],
      previewCard: {
        header: "DBS PayLah! Expense Synced",
        lines: [
          { label: "Amount", value: "SGD 8.60" },
          { label: "Merchant", value: "FOMO PAY PTE. LTD." },
          { label: "Category", value: interactiveCategory },
          { label: "Reference", value: "IPS78876518592130786" },
          { label: "Sync Engine", value: "Event-Driven Push (< 3s)" },
        ],
      },
      sheetRow: {
        timestamp: "07 Sep 2026 @ 3:13 PM",
        type: "expense",
        amount: "SGD 8.60",
        category: interactiveCategory,
        description: "FOMO PAY PTE. LTD. (DBS PayLah)",
        status: "active",
      },
    },
    voice: {
      title: "Multimodal Voice Memos",
      badge: "Gemini 3.6 Flash Audio",
      icon: <IconMicrophone className="w-4 h-4" />,
      description:
        "Speak naturally on Telegram while on the move. Spoken Opus voice memos are streamed in-memory with magic-byte validation and converted into structured actions.",
      terminal: [
        { role: "device", label: "AUDIO_STREAM", text: "Telegram Voice Memo (Opus/OGG 24KB stream)" },
        { role: "system", label: "IN_MEMORY", text: "Zero-disk RAM buffer conversion & MIME validation" },
        { role: "ai", label: "GEMINI_AUDIO", text: "Transcribed: 'Spent 45 dollars on petrol at Shell'" },
        { role: "bot", label: "TELEGRAM", text: "Committed SGD 45.00 • Transport • Shell to Sheets" },
      ],
      previewCard: {
        header: "Spoken Memo Processed",
        lines: [
          { label: "Transcription", value: "\"Spent 45 dollars on petrol at Shell\"" },
          { label: "Intent", value: "finance_add (Expense)" },
          { label: "Amount", value: "SGD 45.00" },
          { label: "Category", value: "Transport" },
        ],
      },
      sheetRow: {
        timestamp: "07 Sep 2026 @ 1:45 PM",
        type: "expense",
        amount: "SGD 45.00",
        category: "Transport",
        description: "Petrol @ Shell (Voice Memo)",
        status: "active",
      },
    },
    vision: {
      title: "Receipt Vision OCR",
      badge: "Gemini Vision OCR",
      icon: <IconCameraScan className="w-4 h-4" />,
      description:
        "Send photos of physical receipts, meal bills, or invoices. Extracts up to 30 line items with tax calculation and batch review before cloud commitment.",
      terminal: [
        { role: "device", label: "OPTICAL_INPUT", text: "User uploaded supermarket receipt photo" },
        { role: "system", label: "MULTIMODAL", text: "Streamed buffer to Gemini 3.6 Flash pipeline" },
        { role: "ai", label: "OCR_EXTRACTION", text: "Extracted 8 line items • Subtotal $42.10 • GST $3.79" },
        { role: "bot", label: "TELEGRAM", text: "Generated itemized batch transaction review card" },
      ],
      previewCard: {
        header: "Receipt Vision OCR Complete",
        lines: [
          { label: "Merchant", value: "FairPrice Finest (Junction 8)" },
          { label: "Parsed Items", value: "8 line items with unit prices" },
          { label: "Total Amount", value: "SGD 45.89 (inc. 9% GST)" },
          { label: "Category", value: "Groceries" },
        ],
      },
      sheetRow: {
        timestamp: "07 Sep 2026 @ 12:10 PM",
        type: "expense",
        amount: "SGD 45.89",
        category: "Groceries",
        description: "FairPrice Finest (Receipt OCR)",
        status: "active",
      },
    },
    calendar: {
      title: "Dual-Calendar Agenda",
      badge: "Google Calendar API v3",
      icon: <IconCalendar className="w-4 h-4" />,
      description:
        "Schedules across separate Personal and Work calendars with automated conflict detection, Singapore Timezone localization, and cryptographic confirmation safeguards.",
      terminal: [
        { role: "device", label: "USER_PROMPT", text: "Prompt: 'Schedule gym tomorrow 7:30pm to 9pm on personal'" },
        { role: "system", label: "CONFLICT_CHECK", text: "Cross-queried Personal & Work schedules [0 conflicts]" },
        { role: "ai", label: "TIMEZONE_RESOLVE", text: "Intent: calendar_schedule • SGT timezone conversion resolved" },
        { role: "bot", label: "TELEGRAM", text: "Dispatched cryptographic confirmation card (5 min TTL)" },
      ],
      previewCard: {
        header: "Event Confirmation Required",
        lines: [
          { label: "Event Title", value: "Gym Session" },
          { label: "Target Calendar", value: "Personal Calendar" },
          { label: "Time Window", value: "Tomorrow • 7:30 PM - 9:00 PM (SGT)" },
          { label: "Security", value: "Single-use HMAC confirmation token" },
        ],
      },
      sheetRow: {
        timestamp: "Tomorrow @ 7:30 PM",
        type: "calendar_event",
        amount: "1h 30m",
        category: "Health & Fitness",
        description: "Gym Session (Personal Calendar)",
        status: "confirmed",
      },
    },
  };

  const commands = [
    { cmd: "/agenda", desc: "View today's schedule across all connected Google calendars", category: "Calendar" },
    { cmd: "/calendar list", desc: "List all upcoming events for the next 7 days", category: "Calendar" },
    { cmd: "/finance summary", desc: "View spending breakdown by category with % analytics", category: "Finance" },
    { cmd: "/finance list", desc: "View recent active finance transactions in Google Sheets", category: "Finance" },
    { cmd: "/paylah", desc: "Run on-demand sync of recent DBS PayLah email receipts", category: "Fintech" },
    { cmd: "/setcommands", desc: "Register interactive quick-access command menu to Telegram", category: "System" },
    { cmd: "/help", desc: "Display assistant capabilities, syntax rules, and voice examples", category: "System" },
  ];

  const filteredCommands =
    selectedCategoryFilter === "All"
      ? commands
      : commands.filter((c) => c.category === selectedCategoryFilter);

  const accent = ACCENT[activeTab];

  return (
    <div className="min-h-screen bg-[#fdf6e9] text-[#0a0a0a] font-sans relative overflow-x-hidden">
      {/* Flat dotted texture */}
      <div className="fixed inset-0 pointer-events-none bg-tech-grid opacity-70 z-0" />

      {/* NAVBAR — flat, thick bottom border, no blur */}
      <header className="sticky top-0 z-50 bg-[#fdf6e9]/95 border-b-[3px] border-[#0a0a0a]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-3.5 flex items-center justify-between">
          {/* Brand Mark */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#ffd21f] border-[3px] border-[#0a0a0a] flex items-center justify-center shadow-[3px_3px_0_#0a0a0a]">
              <IconBolt className="w-4 h-4 text-[#0a0a0a] fill-current" />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-display text-sm tracking-tight text-[#0a0a0a]">
                PERSONAL ASSISTANT
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#3ecf6e] border-2 border-[#0a0a0a] text-[10px] font-mono font-bold text-[#0a0a0a]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a] animate-pulse" />
                ACTIVE NODE
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-bold uppercase tracking-wide text-[#0a0a0a]">
            <a href="#showcase" className="hover:bg-[#ffd21f] px-2 py-1 rounded-md border-2 border-transparent hover:border-[#0a0a0a] transition-all">
              Workbench
            </a>
            <a href="#features" className="hover:bg-[#ffd21f] px-2 py-1 rounded-md border-2 border-transparent hover:border-[#0a0a0a] transition-all">
              Capabilities
            </a>
            <a href="#architecture" className="hover:bg-[#ffd21f] px-2 py-1 rounded-md border-2 border-transparent hover:border-[#0a0a0a] transition-all">
              Pipeline
            </a>
            <a href="#commands" className="hover:bg-[#ffd21f] px-2 py-1 rounded-md border-2 border-transparent hover:border-[#0a0a0a] transition-all">
              Command Deck
            </a>
          </nav>

          {/* TOP RIGHT: Built-by badge */}
          <div className="flex items-center gap-2.5">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="nb-press hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border-[3px] border-[#0a0a0a] shadow-[3px_3px_0_#0a0a0a] text-xs font-bold text-[#0a0a0a]"
              title="Connect with Evan Yap on LinkedIn"
            >
              <div className="w-5 h-5 rounded bg-[#4d7cff] border-2 border-[#0a0a0a] flex items-center justify-center text-white">
                <IconLinkedIn className="w-3 h-3" />
              </div>
              <span>Built by Evan Yap</span>
              <IconExternalLink className="w-3 h-3" />
            </a>

            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="nb-press p-2 rounded-lg bg-white border-[3px] border-[#0a0a0a] shadow-[3px_3px_0_#0a0a0a] text-[#0a0a0a]"
              title="View Source on GitHub"
            >
              <IconGitHub className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pb-24">
        {/* HERO SECTION */}
        <section className="py-14 sm:py-20 text-center sm:text-left relative">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-white border-[3px] border-[#0a0a0a] shadow-[4px_4px_0_#0a0a0a] text-[#0a0a0a] text-xs font-mono font-bold mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf6e] border border-[#0a0a0a]" />
            v2.5 • Event-Driven Fintech &amp; Voice Processing Engine
          </div>

          <h1 className="font-display text-3xl sm:text-5xl md:text-6xl tracking-tight text-[#0a0a0a] max-w-4xl leading-[1.15]">
            Financial Telemetry &amp;{" "}
            <span className="relative inline-block">
              <span className="relative z-10">Multimodal Automation.</span>
              <span className="absolute left-0 right-0 bottom-1 h-3 sm:h-5 bg-[#ffd21f] -z-0" />
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-[#0a0a0a]/70 max-w-2xl leading-relaxed font-medium">
            A serverless assistant orchestrating Apple Pay NFC tap webhooks, DBS PayLah
            real-time push receipts, Opus voice buffers, and receipt vision OCR into
            Google Sheets &amp; Calendar in under 3 seconds.
          </p>

          {/* Quick Filter Switchers */}
          <div className="mt-8 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
            <span className="text-[#0a0a0a]/60 text-[11px] font-mono uppercase tracking-wider font-bold mr-1">
              Select Trigger:
            </span>
            {[
              { id: "apple-pay", label: "Apple Pay NFC", icon: <IconContactless className="w-3.5 h-3.5" /> },
              { id: "paylah", label: "DBS PayLah! Push", icon: <IconPubSub className="w-3.5 h-3.5" /> },
              { id: "voice", label: "Voice Memo", icon: <IconMicrophone className="w-3.5 h-3.5" /> },
              { id: "vision", label: "Receipt Vision", icon: <IconCameraScan className="w-3.5 h-3.5" /> },
              { id: "calendar", label: "Dual Calendar", icon: <IconCalendar className="w-3.5 h-3.5" /> },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  setActiveTab(chip.id as ShowcaseKey);
                  document.getElementById("showcase")?.scrollIntoView({ behavior: "smooth" });
                }}
                className={`nb-press px-3 py-1.5 rounded-lg border-[3px] border-[#0a0a0a] cursor-pointer flex items-center gap-1.5 font-bold ${
                  activeTab === chip.id
                    ? `${ACCENT[chip.id as ShowcaseKey].bg} ${ACCENT[chip.id as ShowcaseKey].text} shadow-[3px_3px_0_#0a0a0a]`
                    : "bg-white text-[#0a0a0a] shadow-[3px_3px_0_#0a0a0a]"
                }`}
              >
                {chip.icon}
                <span>{chip.label}</span>
              </button>
            ))}
          </div>

          {/* Technical Telemetry Grid */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl">
            {[
              { label: "Fintech Latency", value: "< 3s", sub: "NFC Tap & Pub/Sub Push", icon: <IconClock className="w-4 h-4" />, accent: "bg-[#ffd21f]" },
              { label: "Extraction Accuracy", value: "100%", sub: "Regex + LLM Fast-Path", icon: <IconCheck className="w-4 h-4" />, accent: "bg-[#3ecf6e]" },
              { label: "Dual-Calendar Engine", value: "2-Way", sub: "Personal & Work routing", icon: <IconCalendar className="w-4 h-4" />, accent: "bg-[#2bd4c7]" },
              { label: "Security Safeguards", value: "0-Trust", sub: "HMAC single-use tokens", icon: <IconShield className="w-4 h-4" />, accent: "bg-[#ff5c5c]" },
            ].map((metric) => (
              <div key={metric.label} className="nb-card p-4 rounded-xl text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-2xl sm:text-3xl font-bold text-[#0a0a0a] tracking-tight">
                    {metric.value}
                  </div>
                  <div className={`p-1.5 rounded-md border-2 border-[#0a0a0a] ${metric.accent}`}>
                    {metric.icon}
                  </div>
                </div>
                <div className="text-xs font-bold text-[#0a0a0a]">{metric.label}</div>
                <div className="text-[11px] text-[#0a0a0a]/60 mt-0.5">{metric.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* INTERACTIVE WORKBENCH */}
        <section id="showcase" className="my-12 sm:my-20 scroll-mt-24">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-[#0a0a0a] px-3 py-1 rounded-md bg-[#ffd21f] border-2 border-[#0a0a0a]">
              Interactive Workbench
            </span>
            <h2 className="font-display text-2xl sm:text-3xl text-[#0a0a0a] mt-4">
              Event Pipeline in Action
            </h2>
            <p className="text-sm text-[#0a0a0a]/70 mt-2 font-medium">
              Toggle between the simulated Telegram interactive card and the resulting Google Sheets row.
            </p>
          </div>

          {/* Workbench Tabs */}
          <div className="flex justify-center mb-6">
            <div className="p-1.5 rounded-xl bg-white border-[3px] border-[#0a0a0a] flex flex-wrap items-center justify-center gap-1.5 shadow-[5px_5px_0_#0a0a0a]">
              {(
                [
                  { id: "apple-pay", label: "Apple Pay Tap", tag: "iOS 17", icon: <IconContactless className="w-3.5 h-3.5" /> },
                  { id: "paylah", label: "DBS PayLah!", tag: "Pub/Sub", icon: <IconPubSub className="w-3.5 h-3.5" /> },
                  { id: "voice", label: "Voice Note", tag: "Opus RAM", icon: <IconMicrophone className="w-3.5 h-3.5" /> },
                  { id: "vision", label: "Receipt Vision", tag: "OCR", icon: <IconCameraScan className="w-3.5 h-3.5" /> },
                  { id: "calendar", label: "Dual Calendar", tag: "Agenda", icon: <IconCalendar className="w-3.5 h-3.5" /> },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors duration-150 flex items-center gap-2 cursor-pointer border-2 ${
                      isActive
                        ? `${ACCENT[tab.id].bg} ${ACCENT[tab.id].text} border-[#0a0a0a]`
                        : "border-transparent text-[#0a0a0a]/60 hover:bg-[#fdf6e9]"
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        isActive
                          ? "bg-white border-[#0a0a0a] text-[#0a0a0a]"
                          : "bg-[#fdf6e9] border-[#0a0a0a]/20 text-[#0a0a0a]/50"
                      }`}
                    >
                      {tab.tag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Workbench Display Console */}
          <div className="nb-panel rounded-2xl p-6 sm:p-8 relative">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b-[3px] border-[#0a0a0a]">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-lg text-[#0a0a0a]">
                    {showcaseData[activeTab].title}
                  </h3>
                  <span
                    className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-md border-2 border-[#0a0a0a] ${accent.badge}`}
                  >
                    {showcaseData[activeTab].badge}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 mt-1 max-w-xl font-medium">
                  {showcaseData[activeTab].description}
                </p>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#fdf6e9] border-2 border-[#0a0a0a] text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 font-bold ${
                    viewMode === "card"
                      ? "bg-[#0a0a0a] text-white"
                      : "text-[#0a0a0a]/60 hover:text-[#0a0a0a]"
                  }`}
                >
                  <IconTelegram className="w-3.5 h-3.5" />
                  <span>Telegram Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("sheet")}
                  className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 font-bold ${
                    viewMode === "sheet"
                      ? "bg-[#0a0a0a] text-white"
                      : "text-[#0a0a0a]/60 hover:text-[#0a0a0a]"
                  }`}
                >
                  <IconSheetTable className="w-3.5 h-3.5" />
                  <span>Google Sheets</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">
              {/* Left Column: Serverless Log Pipeline (inverted flat terminal) */}
              <div className="rounded-xl bg-[#0a0a0a] border-[3px] border-[#0a0a0a] p-5 font-mono text-xs flex flex-col justify-between min-h-[320px]">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/15 text-white/50 text-[11px] uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <IconTerminal className="w-3.5 h-3.5 text-white/70" />
                      Serverless Execution Trace
                    </span>
                    <span className="text-[#3ecf6e] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf6e] animate-pulse" />
                      FAST PATH
                    </span>
                  </div>

                  {activeTab === "voice" && (
                    <div className="mb-4 p-3 rounded-lg bg-[#ffd21f]/15 border border-[#ffd21f]/40 flex items-center justify-between">
                      <div className="text-[#ffd21f] text-xs font-sans font-bold flex items-center gap-2">
                        <IconMicrophone className="w-4 h-4" />
                        <span>Streaming Opus audio buffer</span>
                      </div>
                      <div className="flex items-center gap-1 h-6">
                        <span className="w-1 bg-[#ffd21f] rounded-full wave-bar-1" />
                        <span className="w-1 bg-[#ffd21f] rounded-full wave-bar-2" />
                        <span className="w-1 bg-[#ffd21f] rounded-full wave-bar-3" />
                        <span className="w-1 bg-[#ffd21f] rounded-full wave-bar-4" />
                        <span className="w-1 bg-[#ffd21f] rounded-full wave-bar-5" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {showcaseData[activeTab].terminal.map((step, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="text-white/30 select-none">0{i + 1}</span>
                        <div className="flex-1">
                          <span className="text-[10px] uppercase font-bold text-white/50 mr-2 px-1.5 py-0.5 rounded bg-white/10">
                            {step.label}
                          </span>
                          <span
                            className={`leading-relaxed ${
                              step.role === "system"
                                ? "text-[#2bd4c7]"
                                : step.role === "ai"
                                ? "text-[#9b6bff]"
                                : step.role === "bot"
                                ? "text-[#3ecf6e] font-semibold"
                                : "text-white/80"
                            }`}
                          >
                            {step.text}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-3 border-t border-white/15 flex items-center justify-between text-[11px] text-white/50">
                  <span className="flex items-center gap-1">
                    <IconClock className="w-3.5 h-3.5" />
                    Roundtrip Latency: ~380ms
                  </span>
                  <span className="flex items-center gap-1 text-[#3ecf6e]">
                    <IconShield className="w-3.5 h-3.5" />
                    HMAC Verified
                  </span>
                </div>
              </div>

              {/* Right Column: Dynamic View */}
              <div className="rounded-xl bg-[#fdf6e9] border-[3px] border-[#0a0a0a] p-6 flex flex-col justify-between min-h-[320px]">
                {viewMode === "card" ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-[#4d7cff] border-2 border-[#0a0a0a] flex items-center justify-center text-white text-xs">
                            <IconTelegram className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-[#0a0a0a]">
                              Telegram Bot Card
                            </div>
                            <div className="text-[10px] text-[#0a0a0a]/50">Delivered in Singapore (SGT)</div>
                          </div>
                        </div>
                        <span className="text-[10px] text-[#0a0a0a]/50 font-mono">Just Now</span>
                      </div>

                      <div className="p-4 rounded-lg bg-white border-2 border-[#0a0a0a] mb-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-[#0a0a0a] mb-3">
                          <span className="w-2 h-2 rounded-full bg-[#3ecf6e] border border-[#0a0a0a]" />
                          {showcaseData[activeTab].previewCard.header}
                        </div>

                        <div className="space-y-2.5 text-xs">
                          {showcaseData[activeTab].previewCard.lines.map((line, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-[#0a0a0a]/60">{line.label}:</span>
                              <span className="font-bold text-[#0a0a0a]">{line.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setInteractiveCategory((c) => (c === "Dining" ? "Groceries" : "Dining"))
                        }
                        className="nb-press py-2 px-3 rounded-lg bg-white text-[#0a0a0a] text-xs font-bold border-2 border-[#0a0a0a] text-center flex items-center justify-center gap-1.5"
                      >
                        <IconPencil className="w-3.5 h-3.5" />
                        <span>Change Category</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => alert("Simulation: Soft-delete undo triggered in Google Sheets.")}
                        className="nb-press py-2 px-3 rounded-lg bg-[#ff5c5c] text-white text-xs font-bold border-2 border-[#0a0a0a] text-center flex items-center justify-center gap-1.5"
                      >
                        <IconTrash className="w-3.5 h-3.5" />
                        <span>Undo / Delete</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-[#3ecf6e] border-2 border-[#0a0a0a] flex items-center justify-center text-[#0a0a0a] text-xs font-bold">
                          <IconSheetTable className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#0a0a0a]">
                            Google Sheets Live Data
                          </div>
                          <div className="text-[10px] text-[#0a0a0a]/50">Transactions Sheet • Row 25</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-[#0a0a0a] font-mono font-bold px-2 py-0.5 rounded bg-[#3ecf6e] border-2 border-[#0a0a0a]">
                        APPENDED
                      </span>
                    </div>

                    <div className="p-4 rounded-lg bg-white border-2 border-[#0a0a0a] font-mono text-xs space-y-2.5">
                      <div className="flex justify-between border-b border-[#0a0a0a]/15 pb-2">
                        <span className="text-[#0a0a0a]/50">Timestamp:</span>
                        <span className="text-[#0a0a0a]">{showcaseData[activeTab].sheetRow.timestamp}</span>
                      </div>
                      <div className="flex justify-between border-b border-[#0a0a0a]/15 pb-2">
                        <span className="text-[#0a0a0a]/50">Amount:</span>
                        <span className="text-[#0a0a0a] font-bold">{showcaseData[activeTab].sheetRow.amount}</span>
                      </div>
                      <div className="flex justify-between border-b border-[#0a0a0a]/15 pb-2">
                        <span className="text-[#0a0a0a]/50">Category:</span>
                        <span className="text-[#0a0a0a] px-1.5 py-0.5 rounded bg-[#9b6bff]/20 border border-[#9b6bff] text-[11px] font-bold">
                          {showcaseData[activeTab].sheetRow.category}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-[#0a0a0a]/15 pb-2">
                        <span className="text-[#0a0a0a]/50">Description:</span>
                        <span className="text-[#0a0a0a] truncate max-w-[200px]">{showcaseData[activeTab].sheetRow.description}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#0a0a0a]/50">Row Status:</span>
                        <span className="text-[#0a0a0a] font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf6e] border border-[#0a0a0a]" />
                          {showcaseData[activeTab].sheetRow.status}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SYSTEM CAPABILITIES BENTO MATRIX */}
        <section id="features" className="my-16 sm:my-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-[#0a0a0a] px-3 py-1 rounded-md bg-[#ffd21f] border-2 border-[#0a0a0a]">
              System Capabilities
            </span>
            <h2 className="font-display text-2xl sm:text-3xl text-[#0a0a0a] mt-4">
              Full-Stack Architecture
            </h2>
            <p className="text-sm text-[#0a0a0a]/70 mt-2 font-medium">
              Bespoke event handling, zero-trust confirmation loops, and multimodal intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Bento 1: Wide Fintech Hub */}
            <div className="md:col-span-2 nb-card p-7 rounded-2xl relative">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-xl bg-[#4d7cff] border-2 border-[#0a0a0a] text-white">
                  <IconContactless className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0a0a0a] px-2.5 py-1 rounded-md bg-[#fdf6e9] border-2 border-[#0a0a0a]">
                  Fintech Hub
                </span>
              </div>
              <h3 className="font-display text-lg text-[#0a0a0a] mb-2">
                Apple Pay Tap &amp; DBS PayLah Real-Time Push
              </h3>
              <p className="text-sm text-[#0a0a0a]/70 leading-relaxed max-w-xl font-medium">
                Couples iOS 17 Shortcuts webhooks with Google Cloud Pub/Sub push notifications.
                Receipts from NFC taps or DBS PayNow transfers are parsed deterministically and logged in under 3 seconds.
              </p>

              <div className="mt-6 pt-5 border-t-2 border-[#0a0a0a]/10 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-[#0a0a0a]/50 text-[11px] font-mono">NFC Response</div>
                  <div className="font-mono font-bold text-[#0a0a0a] mt-0.5">&lt; 1.2s</div>
                </div>
                <div>
                  <div className="text-[#0a0a0a]/50 text-[11px] font-mono">Pub/Sub Ingestion</div>
                  <div className="font-mono font-bold text-[#0a0a0a] mt-0.5">Push Driven</div>
                </div>
                <div>
                  <div className="text-[#0a0a0a]/50 text-[11px] font-mono">Regex Precision</div>
                  <div className="font-mono font-bold text-[#3ecf6e] mt-0.5">100% Deterministic</div>
                </div>
              </div>
            </div>

            {/* Bento 2: Voice Audio Buffer */}
            <div className="nb-card p-7 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-[#ffd21f] border-2 border-[#0a0a0a] text-[#0a0a0a]">
                    <IconMicrophone className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0a0a0a] px-2.5 py-1 rounded-md bg-[#fdf6e9] border-2 border-[#0a0a0a]">
                    Audio Buffer
                  </span>
                </div>
                <h3 className="font-display text-lg text-[#0a0a0a] mb-2">
                  Voice Notes &amp; Memos
                </h3>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 leading-relaxed font-medium">
                  In-memory audio pipeline validating magic-bytes and streaming Opus audio directly to Gemini 3.6 Flash.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t-2 border-[#0a0a0a]/10 flex items-center justify-between text-xs">
                <span className="text-[#0a0a0a]/50">Zero-Disk Overhead</span>
                <span className="font-mono font-bold text-[#0a0a0a]">RAM Stream</span>
              </div>
            </div>

            {/* Bento 3: Dual Calendar */}
            <div className="nb-card p-7 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-[#2bd4c7] border-2 border-[#0a0a0a] text-[#0a0a0a]">
                    <IconCalendar className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0a0a0a] px-2.5 py-1 rounded-md bg-[#fdf6e9] border-2 border-[#0a0a0a]">
                    Calendar Engine
                  </span>
                </div>
                <h3 className="font-display text-lg text-[#0a0a0a] mb-2">
                  Dual-Calendar Routing
                </h3>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 leading-relaxed font-medium">
                  Syncs across Personal and Work calendars with automated conflict checks and Singapore Time localization.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t-2 border-[#0a0a0a]/10 flex items-center justify-between text-xs">
                <span className="text-[#0a0a0a]/50">Calendar Routing</span>
                <span className="font-mono font-bold text-[#0a0a0a]">Personal & Work</span>
              </div>
            </div>

            {/* Bento 4: Receipt Vision */}
            <div className="nb-card p-7 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-[#3ecf6e] border-2 border-[#0a0a0a] text-[#0a0a0a]">
                    <IconCameraScan className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0a0a0a] px-2.5 py-1 rounded-md bg-[#fdf6e9] border-2 border-[#0a0a0a]">
                    Computer Vision
                  </span>
                </div>
                <h3 className="font-display text-lg text-[#0a0a0a] mb-2">
                  Vision &amp; Receipt OCR
                </h3>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 leading-relaxed font-medium">
                  Extracts up to 30 line items from bills, flyers, or timetable photos with subtotal and GST breakdown.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t-2 border-[#0a0a0a]/10 flex items-center justify-between text-xs">
                <span className="text-[#0a0a0a]/50">Batch Processing</span>
                <span className="font-mono font-bold text-[#0a0a0a]">Up to 30 Items</span>
              </div>
            </div>

            {/* Bento 5: Zero-Trust Security */}
            <div className="nb-card p-7 rounded-2xl flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-[#ff5c5c] border-2 border-[#0a0a0a] text-white">
                    <IconShield className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#0a0a0a] px-2.5 py-1 rounded-md bg-[#fdf6e9] border-2 border-[#0a0a0a]">
                    Zero-Trust
                  </span>
                </div>
                <h3 className="font-display text-lg text-[#0a0a0a] mb-2">
                  Security Safeguards
                </h3>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 leading-relaxed font-medium">
                  Single-use cryptographic tokens with 5-minute auto-expiry, user allowlisting, and stateful deduplication.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t-2 border-[#0a0a0a]/10 flex items-center justify-between text-xs">
                <span className="text-[#0a0a0a]/50">Action Expiration</span>
                <span className="font-mono font-bold text-[#0a0a0a]">5 Mins TTL</span>
              </div>
            </div>
          </div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section id="architecture" className="my-16 sm:my-24">
          <div className="nb-panel p-8 sm:p-10 rounded-2xl relative">
            <div className="max-w-3xl mb-8">
              <span className="text-xs font-mono font-bold tracking-wider uppercase text-[#0a0a0a] px-3 py-1 rounded-md bg-[#ffd21f] border-2 border-[#0a0a0a]">
                Data Flow
              </span>
              <h2 className="font-display text-xl sm:text-2xl text-[#0a0a0a] mt-4">
                Event-Driven Serverless Pipeline
              </h2>
              <p className="text-xs sm:text-sm text-[#0a0a0a]/70 mt-2 leading-relaxed font-medium">
                How incoming physical signals translate into structured cloud records in under 3 seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                {
                  step: "01",
                  title: "Signal Ingestion",
                  desc: "Apple Pay NFC Shortcut, Gmail Pub/Sub webhook, or Telegram bot payload.",
                  badge: "HTTPS / HMAC",
                  icon: <IconBolt className="w-4 h-4" />,
                  accent: "bg-[#ffd21f]",
                },
                {
                  step: "02",
                  title: "Auth & Validation",
                  desc: "Secret verification, user ID allowlist check, and stateful UpdateLog deduplication.",
                  badge: "Zero-Trust",
                  icon: <IconShield className="w-4 h-4" />,
                  accent: "bg-[#2bd4c7]",
                },
                {
                  step: "03",
                  title: "Intelligence Routing",
                  desc: "Gemini 3.6 Flash multimodal audio/vision & deterministic regex fast-path.",
                  badge: "AI SDK v4",
                  icon: <IconSparkles className="w-4 h-4" />,
                  accent: "bg-[#9b6bff]",
                },
                {
                  step: "04",
                  title: "Storage & Feedback",
                  desc: "Google Sheets / Calendar append & interactive Telegram callback dispatch.",
                  badge: "Workspace API",
                  icon: <IconDatabase className="w-4 h-4" />,
                  accent: "bg-[#3ecf6e]",
                },
              ].map((pipe) => (
                <div
                  key={pipe.step}
                  className="p-5 rounded-xl bg-[#fdf6e9] border-2 border-[#0a0a0a] flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className={`flex items-center gap-2 px-2 py-1 rounded-md border-2 border-[#0a0a0a] ${pipe.accent}`}>
                        {pipe.icon}
                        <span className="text-xs font-mono font-bold text-[#0a0a0a]">
                          {pipe.step}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white border border-[#0a0a0a]/30 text-[#0a0a0a]">
                        {pipe.badge}
                      </span>
                    </div>
                    <div className="font-display text-sm text-[#0a0a0a] mb-1.5">{pipe.title}</div>
                    <div className="text-xs text-[#0a0a0a]/70 leading-relaxed font-medium">{pipe.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* COMMAND REFERENCE */}
        <section id="commands" className="my-16 sm:my-24">
          <div className="nb-panel p-8 sm:p-10 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-display text-xl text-[#0a0a0a]">Bot Command Reference</h2>
                <p className="text-xs sm:text-sm text-[#0a0a0a]/70 mt-1 font-medium">
                  Click any command to copy it directly to your clipboard.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[#fdf6e9] border-2 border-[#0a0a0a] text-xs">
                {["All", "Calendar", "Finance", "Fintech", "System"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategoryFilter(cat)}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer font-bold ${
                      selectedCategoryFilter === cat
                        ? "bg-[#0a0a0a] text-white"
                        : "text-[#0a0a0a]/60 hover:text-[#0a0a0a]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y-2 divide-[#0a0a0a]/10 font-mono text-sm">
              {filteredCommands.map((c) => (
                <div
                  key={c.cmd}
                  onClick={() => handleCopy(c.cmd)}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#ffd21f]/15 px-2 rounded-lg transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <code className="text-[#0a0a0a] font-bold px-2.5 py-1 rounded-md bg-[#3ecf6e] border-2 border-[#0a0a0a] flex items-center gap-1.5">
                      <IconCodeBracket className="w-3.5 h-3.5" />
                      {c.cmd}
                    </code>
                    <span className="text-[#0a0a0a] font-sans text-xs sm:text-sm font-medium">{c.desc}</span>
                  </div>

                  <span className="text-xs text-[#0a0a0a]/60 group-hover:text-[#0a0a0a] transition-colors flex items-center gap-1.5 font-bold">
                    {copiedCmd === c.cmd ? (
                      <>
                        <IconCheck className="w-3.5 h-3.5" />
                        <span>Copied to clipboard</span>
                      </>
                    ) : (
                      <>
                        <IconCopy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CRAFTED FOOTER */}
        <footer className="mt-20 pt-8 border-t-[3px] border-[#0a0a0a] text-xs text-[#0a0a0a]/70 flex flex-col sm:flex-row items-center justify-between gap-4 font-bold">
          <div className="flex items-center gap-2">
            <span>Built with Next.js, Vercel AI SDK &amp; Gemini</span>
            <span>•</span>
            <span>Private Serverless Assistant</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#0a0a0a] hover:bg-[#ffd21f] px-2 py-1 rounded-md transition-colors flex items-center gap-1.5"
            >
              <span>Developed by</span>
              <strong>Evan Yap</strong>
            </a>
            <span>•</span>
            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-[#ffd21f] px-2 py-1 rounded-md transition-colors flex items-center gap-1"
            >
              <IconGitHub className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
