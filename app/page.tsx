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
      badgeColor: string;
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
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
      icon: <IconContactless className="w-4 h-4 text-sky-400" />,
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
      badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
      icon: <IconPubSub className="w-4 h-4 text-purple-400" />,
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
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      icon: <IconMicrophone className="w-4 h-4 text-amber-400" />,
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
      badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
      icon: <IconCameraScan className="w-4 h-4 text-emerald-400" />,
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
      badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
      icon: <IconCalendar className="w-4 h-4 text-cyan-400" />,
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

  return (
    <div className="min-h-screen bg-[#07080b] text-zinc-100 font-sans selection:bg-emerald-500 selection:text-black relative overflow-x-hidden">
      {/* Background Architectural Canvas Grid */}
      <div className="fixed inset-0 pointer-events-none bg-tech-grid opacity-50 z-0" />

      {/* Atmospheric Ambient Depth */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[1100px] h-[520px] bg-gradient-to-b from-emerald-500/10 via-teal-500/5 to-transparent blur-[160px] rounded-full animate-glow" />
        <div className="absolute top-1/3 -left-64 w-[650px] h-[550px] bg-indigo-600/5 blur-[180px] rounded-full" />
        <div className="absolute top-2/3 -right-64 w-[650px] h-[550px] bg-purple-600/5 blur-[180px] rounded-full" />
      </div>

      {/* FLOATING FROSTED NAVBAR */}
      <div className="fixed top-5 inset-x-0 z-50 px-4 sm:px-8">
        <header className="max-w-6xl mx-auto glass-panel rounded-2xl px-5 py-3 flex items-center justify-between shadow-2xl shadow-black/80 border border-white/[0.08]">
          {/* Brand Mark */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-zinc-950 shadow-md shadow-emerald-500/20 border border-emerald-400/30">
              <IconBolt className="w-4 h-4 text-zinc-950 fill-current" />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="font-display text-sm font-bold tracking-tight text-white">
                Personal Assistant
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-mono font-medium text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ACTIVE NODE
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-zinc-400">
            <a href="#showcase" className="hover:text-emerald-400 transition-colors">
              Interactive Workbench
            </a>
            <a href="#features" className="hover:text-emerald-400 transition-colors">
              Capabilities
            </a>
            <a href="#architecture" className="hover:text-emerald-400 transition-colors">
              Pipeline
            </a>
            <a href="#commands" className="hover:text-emerald-400 transition-colors">
              Command Deck
            </a>
          </nav>

          {/* TOP RIGHT: Elevated 'Developed by Evan Yap' Badge */}
          <div className="flex items-center gap-2.5">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-700/60 hover:border-emerald-500/40 text-xs font-medium text-zinc-300 transition-all duration-200 shadow-lg hover:shadow-emerald-500/15"
              title="Connect with Evan Yap on LinkedIn"
            >
              <div className="w-5 h-5 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 transition-colors">
                <IconLinkedIn className="w-3 h-3 text-blue-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400 text-[11px] hidden sm:inline">Built by</span>
                <span className="font-semibold text-white group-hover:text-emerald-300 transition-colors">
                  Evan Yap
                </span>
              </div>
              <IconExternalLink className="w-3 h-3 text-zinc-500 group-hover:text-emerald-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>

            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-400 hover:text-white transition-colors"
              title="View Source on GitHub"
            >
              <IconGitHub className="w-4 h-4" />
            </a>
          </div>
        </header>
      </div>

      {/* MAIN CONTAINER */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-32 pb-24">
        {/* HERO SECTION */}
        <section className="py-12 sm:py-20 text-center sm:text-left relative">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            v2.5 • Event-Driven Fintech & Voice Processing Engine
          </div>

          <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white max-w-4xl leading-[1.08]">
            Financial Telemetry &{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Multimodal Automation.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-2xl leading-relaxed font-normal">
            A serverless assistant orchestrating Apple Pay NFC tap webhooks, DBS PayLah
            real-time push receipts, Opus voice buffers, and receipt vision OCR into
            Google Sheets & Calendar in under 3 seconds.
          </p>

          {/* Quick Filter Switchers */}
          <div className="mt-8 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
            <span className="text-zinc-500 text-[11px] font-mono uppercase tracking-wider font-semibold mr-1">
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
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === chip.id
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold shadow-sm"
                    : "bg-zinc-900/80 border-zinc-800/90 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80"
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
              { label: "Fintech Latency", value: "< 3s", sub: "NFC Tap & Pub/Sub Push", icon: <IconClock className="w-4 h-4 text-emerald-400" /> },
              { label: "Extraction Accuracy", value: "100%", sub: "Regex + LLM Fast-Path", icon: <IconCheck className="w-4 h-4 text-emerald-400" /> },
              { label: "Dual-Calendar Engine", value: "2-Way", sub: "Personal & Work routing", icon: <IconCalendar className="w-4 h-4 text-emerald-400" /> },
              { label: "Security Safeguards", value: "0-Trust", sub: "HMAC single-use tokens", icon: <IconShield className="w-4 h-4 text-emerald-400" /> },
            ].map((metric) => (
              <div
                key={metric.label}
                className="p-4 rounded-2xl glass-card text-left relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    {metric.value}
                  </div>
                  <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                    {metric.icon}
                  </div>
                </div>
                <div className="text-xs font-semibold text-emerald-400">{metric.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{metric.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* INTERACTIVE WORKBENCH */}
        <section id="showcase" className="my-12 sm:my-20 scroll-mt-28">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              Interactive Workbench
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mt-3">
              Event Pipeline in Action
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Toggle between the simulated Telegram interactive card and the resulting Google Sheets row.
            </p>
          </div>

          {/* Workbench Tabs */}
          <div className="flex justify-center mb-6">
            <div className="p-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800/90 flex flex-wrap items-center justify-center gap-1 shadow-inner">
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
                    className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors duration-150 flex items-center gap-2 cursor-pointer border ${
                      isActive
                        ? "bg-zinc-800 border-zinc-700/80 text-white font-semibold shadow-sm"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                        isActive
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-zinc-800/80 text-zinc-500"
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
          <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/[0.08] shadow-2xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl font-bold text-white">
                    {showcaseData[activeTab].title}
                  </h3>
                  <span
                    className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${showcaseData[activeTab].badgeColor}`}
                  >
                    {showcaseData[activeTab].badge}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-xl">
                  {showcaseData[activeTab].description}
                </p>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "card"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <IconTelegram className="w-3.5 h-3.5 text-blue-400" />
                  <span>Telegram Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("sheet")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                    viewMode === "sheet"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <IconSheetTable className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Google Sheets</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">
              {/* Left Column: Serverless Log Pipeline */}
              <div className="rounded-2xl bg-zinc-950/90 border border-zinc-800/80 p-5 font-mono text-xs flex flex-col justify-between shadow-inner min-h-[320px]">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-900 text-zinc-500 text-[11px] uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <IconTerminal className="w-3.5 h-3.5 text-zinc-400" />
                      Serverless Execution Trace
                    </span>
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      FAST PATH
                    </span>
                  </div>

                  {activeTab === "voice" && (
                    <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                      <div className="text-amber-400 text-xs font-sans font-medium flex items-center gap-2">
                        <IconMicrophone className="w-4 h-4 text-amber-400" />
                        <span>Streaming Opus audio buffer</span>
                      </div>
                      <div className="flex items-center gap-1 h-6">
                        <span className="w-1 bg-amber-400 rounded-full wave-bar-1" />
                        <span className="w-1 bg-amber-400 rounded-full wave-bar-2" />
                        <span className="w-1 bg-amber-400 rounded-full wave-bar-3" />
                        <span className="w-1 bg-amber-400 rounded-full wave-bar-4" />
                        <span className="w-1 bg-amber-400 rounded-full wave-bar-5" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {showcaseData[activeTab].terminal.map((step, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="text-zinc-600 select-none">0{i + 1}</span>
                        <div className="flex-1">
                          <span className="text-[10px] uppercase font-bold text-zinc-500 mr-2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                            {step.label}
                          </span>
                          <span
                            className={`leading-relaxed ${
                              step.role === "system"
                                ? "text-cyan-400"
                                : step.role === "ai"
                                ? "text-purple-300"
                                : step.role === "bot"
                                ? "text-emerald-400 font-semibold"
                                : "text-zinc-300"
                            }`}
                          >
                            {step.text}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-3 border-t border-zinc-900/80 flex items-center justify-between text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1">
                    <IconClock className="w-3.5 h-3.5 text-zinc-500" />
                    Roundtrip Latency: ~380ms
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <IconShield className="w-3.5 h-3.5" />
                    HMAC Verified
                  </span>
                </div>
              </div>

              {/* Right Column: Dynamic View */}
              <div className="rounded-2xl bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 p-6 flex flex-col justify-between shadow-xl min-h-[320px]">
                {viewMode === "card" ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 text-xs">
                            <IconTelegram className="w-3.5 h-3.5 text-blue-400" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-zinc-200">
                              Telegram Bot Card
                            </div>
                            <div className="text-[10px] text-zinc-500">Delivered in Singapore (SGT)</div>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">Just Now</span>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/90 mb-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-white mb-3">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          {showcaseData[activeTab].previewCard.header}
                        </div>

                        <div className="space-y-2.5 text-xs">
                          {showcaseData[activeTab].previewCard.lines.map((line, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-zinc-400">{line.label}:</span>
                              <span className="font-semibold text-zinc-200">{line.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Action Buttons with Zero Emojis */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setInteractiveCategory((c) => (c === "Dining" ? "Groceries" : "Dining"))
                        }
                        className="py-2 px-3 rounded-xl bg-zinc-800/90 hover:bg-zinc-750 text-zinc-200 text-xs font-medium border border-zinc-700/60 text-center transition-all hover:text-white cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <IconPencil className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Change Category</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => alert("Simulation: Soft-delete undo triggered in Google Sheets.")}
                        className="py-2 px-3 rounded-xl bg-zinc-800/90 hover:bg-rose-950/40 text-rose-300 text-xs font-medium border border-zinc-700/60 text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5"
                      >
                        <IconTrash className="w-3.5 h-3.5 text-rose-400" />
                        <span>Undo / Delete</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 text-xs font-bold">
                          <IconSheetTable className="w-3.5 h-3.5 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-zinc-200">
                            Google Sheets Live Data
                          </div>
                          <div className="text-[10px] text-zinc-500">Transactions Sheet • Row 25</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        APPENDED
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-950/90 border border-zinc-800/90 font-mono text-xs space-y-2.5">
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500">Timestamp:</span>
                        <span className="text-zinc-200">{showcaseData[activeTab].sheetRow.timestamp}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500">Amount:</span>
                        <span className="text-emerald-400 font-bold">{showcaseData[activeTab].sheetRow.amount}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500">Category:</span>
                        <span className="text-purple-300 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-[11px]">
                          {showcaseData[activeTab].sheetRow.category}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500">Description:</span>
                        <span className="text-zinc-300 truncate max-w-[200px]">{showcaseData[activeTab].sheetRow.description}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Row Status:</span>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
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
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              System Capabilities
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mt-3">
              Full-Stack Architecture
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Bespoke event handling, zero-trust confirmation loops, and multimodal intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Bento 1: Wide Fintech Hub */}
            <div className="md:col-span-2 p-7 rounded-3xl glass-card relative overflow-hidden border border-white/[0.08] hover:border-blue-500/40">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <IconContactless className="w-6 h-6 text-blue-400" />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
                  Fintech Hub
                </span>
              </div>
              <h3 className="font-display text-xl font-bold text-white mb-2">
                Apple Pay Tap & DBS PayLah Real-Time Push
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Couples iOS 17 Shortcuts webhooks with Google Cloud Pub/Sub push notifications.
                Receipts from NFC taps or DBS PayNow transfers are parsed deterministically and logged in under 3 seconds.
              </p>

              <div className="mt-6 pt-5 border-t border-zinc-900 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-zinc-500 text-[11px] font-mono">NFC Response</div>
                  <div className="font-mono font-bold text-white mt-0.5">&lt; 1.2s</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-[11px] font-mono">Pub/Sub Ingestion</div>
                  <div className="font-mono font-bold text-white mt-0.5">Push Driven</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-[11px] font-mono">Regex Precision</div>
                  <div className="font-mono font-bold text-emerald-400 mt-0.5">100% Deterministic</div>
                </div>
              </div>
            </div>

            {/* Bento 2: Voice Audio Buffer */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-amber-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <IconMicrophone className="w-6 h-6 text-amber-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                    Audio Buffer
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Voice Notes & Memos
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  In-memory audio pipeline validating magic-bytes and streaming Opus audio directly to Gemini 3.6 Flash.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Zero-Disk Overhead</span>
                <span className="font-mono font-bold text-amber-400">RAM Stream</span>
              </div>
            </div>

            {/* Bento 3: Dual Calendar */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-cyan-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                    <IconCalendar className="w-6 h-6 text-cyan-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                    Calendar Engine
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Dual-Calendar Routing
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Syncs across Personal and Work calendars with automated conflict checks and Singapore Time localization.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Calendar Routing</span>
                <span className="font-mono font-bold text-cyan-400">Personal & Work</span>
              </div>
            </div>

            {/* Bento 4: Receipt Vision */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-emerald-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <IconCameraScan className="w-6 h-6 text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    Computer Vision
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Vision & Receipt OCR
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Extracts up to 30 line items from bills, flyers, or timetable photos with subtotal and GST breakdown.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Batch Processing</span>
                <span className="font-mono font-bold text-emerald-400">Up to 30 Items</span>
              </div>
            </div>

            {/* Bento 5: Zero-Trust Security */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-rose-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                    <IconShield className="w-6 h-6 text-rose-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20">
                    Zero-Trust
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Security Safeguards
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Single-use cryptographic tokens with 5-minute auto-expiry, user allowlisting, and stateful deduplication.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Action Expiration</span>
                <span className="font-mono font-bold text-rose-400">5 Mins TTL</span>
              </div>
            </div>
          </div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section id="architecture" className="my-16 sm:my-24">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl relative overflow-hidden">
            <div className="max-w-3xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Data Flow
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mt-3">
                Event-Driven Serverless Pipeline
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
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
                  icon: <IconBolt className="w-4 h-4 text-emerald-400" />,
                },
                {
                  step: "02",
                  title: "Auth & Validation",
                  desc: "Secret verification, user ID allowlist check, and stateful UpdateLog deduplication.",
                  badge: "Zero-Trust",
                  icon: <IconShield className="w-4 h-4 text-cyan-400" />,
                },
                {
                  step: "03",
                  title: "Intelligence Routing",
                  desc: "Gemini 3.6 Flash multimodal audio/vision & deterministic regex fast-path.",
                  badge: "AI SDK v4",
                  icon: <IconSparkles className="w-4 h-4 text-purple-400" />,
                },
                {
                  step: "04",
                  title: "Storage & Feedback",
                  desc: "Google Sheets / Calendar append & interactive Telegram callback dispatch.",
                  badge: "Workspace API",
                  icon: <IconDatabase className="w-4 h-4 text-amber-400" />,
                },
              ].map((pipe) => (
                <div
                  key={pipe.step}
                  className="p-5 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {pipe.icon}
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          {pipe.step}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {pipe.badge}
                      </span>
                    </div>
                    <div className="font-display text-sm font-bold text-white mb-1.5">{pipe.title}</div>
                    <div className="text-xs text-zinc-400 leading-relaxed">{pipe.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* COMMAND REFERENCE */}
        <section id="commands" className="my-16 sm:my-24">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Bot Command Reference</h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Click any command to copy it directly to your clipboard.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                {["All", "Calendar", "Finance", "Fintech", "System"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategoryFilter(cat)}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                      selectedCategoryFilter === cat
                        ? "bg-zinc-800 text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-zinc-800/60 font-mono text-sm">
              {filteredCommands.map((c) => (
                <div
                  key={c.cmd}
                  onClick={() => handleCopy(c.cmd)}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.02] px-2 rounded-xl transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <code className="text-emerald-400 font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 group-hover:border-emerald-500/40 transition-colors flex items-center gap-1.5">
                      <IconCodeBracket className="w-3.5 h-3.5 text-emerald-400" />
                      {c.cmd}
                    </code>
                    <span className="text-zinc-300 font-sans text-xs sm:text-sm">{c.desc}</span>
                  </div>

                  <span className="text-xs text-zinc-500 group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                    {copiedCmd === c.cmd ? (
                      <>
                        <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">Copied to clipboard</span>
                      </>
                    ) : (
                      <>
                        <IconCopy className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400" />
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
        <footer className="mt-20 pt-10 border-t border-zinc-900 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span>Built with Next.js, Vercel AI SDK & Gemini</span>
            <span>•</span>
            <span>Private Serverless Assistant</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-emerald-400 transition-colors font-medium flex items-center gap-1.5"
            >
              <span>Developed by</span>
              <strong className="text-white hover:text-emerald-300">Evan Yap</strong>
            </a>
            <span>•</span>
            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 transition-colors flex items-center gap-1"
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
