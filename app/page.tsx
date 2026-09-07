"use client";

import { useState } from "react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<
    "apple-pay" | "paylah" | "voice" | "vision" | "calendar"
  >("apple-pay");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "sheet">("card");
  const [interactiveCategory, setInteractiveCategory] = useState<string>("Dining");

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const showcaseData = {
    "apple-pay": {
      title: "Apple Pay Instant Tap-to-Log",
      badge: "iOS 17+ Shortcuts",
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
      description:
        "Tap your iPhone at any physical terminal. iOS Shortcuts fires a cryptographically signed HMAC webhook to log the expense and send an interactive Telegram card.",
      terminal: [
        { role: "device", text: "📱 Apple Pay NFC Tap detected: S$14.50 at 'Toast Box'" },
        { role: "system", text: "⚡ POST /api/apple-wallet [200 OK • 380ms]" },
        { role: "ai", text: "🤖 Gemini 3.6 Flash: 'Dining' • Item: 'Kaya Toast Set'" },
        { role: "bot", text: "🟢 Telegram Card delivered with [✏️ Change Category] [🗑️ Undo]" },
      ],
      previewCard: {
        header: "🍏 Apple Pay Expense Recorded!",
        lines: [
          { label: "Item", value: "Kaya Toast Set" },
          { label: "Amount", value: "SGD 14.50" },
          { label: "Merchant", value: "Toast Box (Marina Bay Sands)" },
          { label: "Category", value: interactiveCategory },
          { label: "Status", value: "Active • Row #34 in Google Sheets" },
        ],
        actions: ["✏️ Change Category", "🗑️ Undo / Delete"],
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
      title: "DBS PayLah! & PayNow Real-Time Push",
      badge: "Google Cloud Pub/Sub",
      badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
      description:
        "Zero-latency push architecture. Whenever DBS emails a transaction receipt, Google Cloud Pub/Sub pushes it directly to the serverless webhook for regex-LLM extraction.",
      terminal: [
        { role: "device", text: "✉️ Gmail Event: DBS Transaction Alert 'SGD 8.60 to FOMO PAY'" },
        { role: "system", text: "⚡ Google Cloud Pub/Sub push → /api/gmail-webhook [200 OK]" },
        { role: "ai", text: "🔍 Regex Engine extracted Ref #IPS7887651859 • Category: 'Dining'" },
        { role: "bot", text: "🟣 Google Sheets updated & Telegram interactive alert dispatched" },
      ],
      previewCard: {
        header: "🟣 DBS PayLah! Expense Synced!",
        lines: [
          { label: "Amount", value: "SGD 8.60" },
          { label: "Merchant", value: "FOMO PAY PTE. LTD." },
          { label: "Category", value: interactiveCategory },
          { label: "Ref", value: "IPS78876518592130786" },
          { label: "Sync Type", value: "Event-Driven Pub/Sub (< 3s)" },
        ],
        actions: ["✏️ Change Category", "🗑️ Undo / Delete"],
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
      title: "Voice Notes & Multimodal Audio Buffer",
      badge: "Gemini 3.6 Flash Audio",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      description:
        "Speak naturally on Telegram while on the move. Spoken Opus voice memos are streamed in-memory with magic-byte validation and converted into structured actions.",
      terminal: [
        { role: "device", text: "🎙️ Telegram Voice Memo (Opus/OGG 24KB stream)" },
        { role: "system", text: "🔄 In-memory buffer conversion & MIME validation" },
        { role: "ai", text: "🤖 Gemini Audio transcribed: 'Spent 45 dollars on petrol at Shell'" },
        { role: "bot", text: "✅ Logged SGD 45.00 • Transport • Shell into Google Sheets" },
      ],
      previewCard: {
        header: "🎙️ Spoken Memo Processed",
        lines: [
          { label: "Transcription", value: "\"Spent 45 dollars on petrol at Shell\"" },
          { label: "Detected Intent", value: "finance_add_expense" },
          { label: "Amount", value: "SGD 45.00" },
          { label: "Category", value: "Transport" },
        ],
        actions: ["📊 View Finance Summary", "💬 Reply to edit"],
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
      title: "Vision OCR & Receipt Processing",
      badge: "Gemini Vision OCR",
      badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
      description:
        "Send photos of physical receipts, meal bills, or event flyers. Extracts up to 30 line items with tax calculation and batch review before cloud commitment.",
      terminal: [
        { role: "device", text: "📸 User sent high-res supermarket receipt photo" },
        { role: "system", text: "🔄 Streamed to Gemini 3.6 Flash Multimodal pipeline" },
        { role: "ai", text: "🤖 Extracted 8 line items • Subtotal $42.10 • GST $3.79" },
        { role: "bot", text: "🟢 Prepared batch transaction review card with item breakdown" },
      ],
      previewCard: {
        header: "📸 Receipt Vision OCR Complete",
        lines: [
          { label: "Merchant", value: "FairPrice Finest (Junction 8)" },
          { label: "Items Extracted", value: "8 grocery items parsed" },
          { label: "Total Amount", value: "SGD 45.89 (inc. 9% GST)" },
          { label: "Category", value: "Groceries" },
        ],
        actions: ["✅ Confirm & Save to Sheets", "❌ Cancel"],
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
      title: "Dual-Calendar Agenda Management",
      badge: "Google Calendar API v3",
      badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
      description:
        "Schedules across separate Personal and Work calendars with automated conflict detection, Singapore Timezone localization, and cryptographic confirmation safeguards.",
      terminal: [
        { role: "device", text: "💬 User: 'Schedule gym tomorrow 7:30pm to 9pm on personal'" },
        { role: "system", text: "🔍 Queried Personal & Work calendars for conflicts [0 found]" },
        { role: "ai", text: "🤖 Intent: calendar_schedule • SGT timezone conversion resolved" },
        { role: "bot", text: "🟡 Interactive confirmation card sent (expires in 5 mins)" },
      ],
      previewCard: {
        header: "📅 Event Confirmation Required",
        lines: [
          { label: "Event", value: "Gym Session" },
          { label: "Target Calendar", value: "Personal Calendar" },
          { label: "Time Window", value: "Tomorrow • 7:30 PM - 9:00 PM (SGT)" },
          { label: "Security", value: "Single-use cryptographic confirmation token" },
        ],
        actions: ["✅ Confirm & Add to Calendar", "❌ Cancel"],
      },
      sheetRow: {
        timestamp: "Tomorrow @ 7:30 PM",
        type: "calendar_event",
        amount: "1 hr 30 mins",
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

  return (
    <div className="min-h-screen bg-[#070709] text-zinc-100 font-sans selection:bg-emerald-500 selection:text-black relative overflow-x-hidden">
      {/* Subtle technical grid overlay */}
      <div className="fixed inset-0 pointer-events-none bg-tech-grid opacity-60 z-0" />

      {/* Atmospheric ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-emerald-500/10 blur-[150px] rounded-full animate-glow" />
        <div className="absolute top-1/3 -left-48 w-[600px] h-[500px] bg-indigo-600/8 blur-[160px] rounded-full" />
        <div className="absolute top-2/3 -right-48 w-[600px] h-[500px] bg-purple-600/8 blur-[160px] rounded-full" />
      </div>

      {/* FLOATING FROSTED NAVBAR */}
      <div className="fixed top-5 inset-x-0 z-50 px-4 sm:px-8">
        <header className="max-w-6xl mx-auto glass-panel rounded-full px-5 py-2.5 flex items-center justify-between shadow-2xl shadow-black/70 border border-white/10">
          {/* Left Brand with live heartbeat */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-400 flex items-center justify-center text-zinc-950 font-black text-xs shadow-md shadow-emerald-500/25">
              ⚡
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-tight text-white">
                Personal Assistant
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </span>
            </div>
          </div>

          {/* Center Navigation */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400">
            <a href="#showcase" className="hover:text-emerald-400 transition-colors">
              Interactive Demo
            </a>
            <a href="#features" className="hover:text-emerald-400 transition-colors">
              Capabilities
            </a>
            <a href="#architecture" className="hover:text-emerald-400 transition-colors">
              Architecture
            </a>
            <a href="#commands" className="hover:text-emerald-400 transition-colors">
              Commands
            </a>
          </nav>

          {/* TOP RIGHT: Elevated 'Developed by Evan Yap' Badge */}
          <div className="flex items-center gap-2">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/70 hover:border-emerald-500/50 text-xs font-medium text-zinc-200 transition-all duration-200 shadow-lg hover:shadow-emerald-500/20"
              title="View Evan Yap's LinkedIn Profile"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 group-hover:bg-emerald-400 transition-colors shadow-sm shadow-blue-500/50" />
              <span className="text-zinc-400 group-hover:text-zinc-300">Developed by</span>
              <span className="font-semibold text-white group-hover:text-emerald-300 transition-colors">
                Evan Yap
              </span>
              <svg
                className="w-3.5 h-3.5 text-blue-400 group-hover:text-emerald-400 transition-transform group-hover:translate-x-0.5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.44a1.66 1.66 0 1 0 1.66 1.66 1.66 1.66 0 0 0-1.66-1.66Z" />
              </svg>
            </a>

            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-400 hover:text-white transition-colors"
              title="GitHub Repository"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
            </a>
          </div>
        </header>
      </div>

      {/* MAIN CONTENT WRAPPER */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-28 pb-24">
        {/* HERO SECTION */}
        <section className="py-12 sm:py-20 text-center sm:text-left relative">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-6 shadow-sm">
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            v2.5 • Apple Pay Tap & Real-Time DBS PayLah Push
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white max-w-4xl leading-[1.08]">
            Everyday Productivity.{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Automated in Real Time.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-2xl leading-relaxed font-normal">
            A serverless assistant connecting real-world actions — Apple Pay NFC taps,
            DBS PayLah QR transfers, spoken voice notes, and receipt scans — to Google Sheets & Calendar
            with zero manual logging.
          </p>

          {/* Quick-play chips */}
          <div className="mt-8 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
            <span className="text-zinc-500 text-[11px] uppercase tracking-wider font-semibold mr-1">
              Try In Simulator:
            </span>
            {[
              { id: "apple-pay", label: "💳 Apple Pay Tap" },
              { id: "paylah", label: "🟣 DBS PayLah!" },
              { id: "voice", label: "🎙️ Voice Note" },
              { id: "vision", label: "📸 Receipt Vision" },
              { id: "calendar", label: "📅 Dual Calendar" },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  setActiveTab(chip.id as any);
                  document.getElementById("showcase")?.scrollIntoView({ behavior: "smooth" });
                }}
                className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  activeTab === chip.id
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold"
                    : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Metric Bar */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl">
            {[
              { label: "Fintech Sync Latency", value: "< 3s", sub: "Apple Pay & DBS Webhooks" },
              { label: "Deterministic Accuracy", value: "100%", sub: "Regex + LLM hybrid engine" },
              { label: "Dual-Calendar Engine", value: "2-Way", sub: "Personal & Work routing" },
              { label: "Security Safeguards", value: "0-Trust", sub: "HMAC single-use tokens" },
            ].map((metric) => (
              <div
                key={metric.label}
                className="p-4 rounded-2xl glass-card text-center sm:text-left"
              >
                <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {metric.value}
                </div>
                <div className="text-xs font-semibold text-emerald-400 mt-1">{metric.label}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{metric.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* INTERACTIVE SHOWCASE SIMULATOR */}
        <section id="showcase" className="my-12 sm:my-20 scroll-mt-28">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              Interactive Showcase
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
              Event Pipeline in Action
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Toggle between the simulated Telegram interactive card and the resulting Google Sheets record.
            </p>
          </div>

          {/* Stable Tab Group */}
          <div className="flex justify-center mb-6">
            <div className="p-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex flex-wrap items-center justify-center gap-1 shadow-inner">
              {[
                { id: "apple-pay", label: "💳 Apple Pay Tap", tag: "iOS" },
                { id: "paylah", label: "🟣 DBS PayLah!", tag: "Pub/Sub" },
                { id: "voice", label: "🎙️ Voice Note", tag: "Audio" },
                { id: "vision", label: "📸 Receipt Vision", tag: "Vision" },
                { id: "calendar", label: "📅 Dual Calendar", tag: "Agenda" },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors duration-150 flex items-center gap-2 cursor-pointer border ${
                      isActive
                        ? "bg-zinc-800 border-zinc-700 text-white font-semibold shadow-sm"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                        isActive
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {tab.tag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Simulator Display Card */}
          <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold text-white">
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

              {/* View mode toggle: Telegram Card vs Google Sheet */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === "card"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Telegram Card View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("sheet")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    viewMode === "sheet"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Google Sheets Row
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">
              {/* Left Column: Serverless Log Pipeline */}
              <div className="rounded-2xl bg-zinc-950/90 border border-zinc-800/80 p-5 font-mono text-xs flex flex-col justify-between shadow-inner min-h-[310px]">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-900 text-zinc-500 text-[11px] uppercase tracking-wider">
                    <span>Serverless Execution Trace</span>
                    <span className="text-emerald-400 font-bold">● FAST PATH</span>
                  </div>

                  {activeTab === "voice" && (
                    <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                      <div className="text-amber-400 text-xs font-sans font-medium flex items-center gap-2">
                        <span>🎙️ Streaming Opus buffer</span>
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
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-3 border-t border-zinc-900/80 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Latency: ~380ms</span>
                  <span>Payload Verified: HMAC SHA256</span>
                </div>
              </div>

              {/* Right Column: Dynamic View (Card or Sheet) */}
              <div className="rounded-2xl bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 p-6 flex flex-col justify-between shadow-xl min-h-[310px]">
                {viewMode === "card" ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 text-xs">
                            ✈️
                          </div>
                          <span className="text-xs font-semibold text-zinc-300">
                            Telegram Bot Card
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">Just Now</span>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800/80 mb-4">
                        <div className="text-sm font-bold text-white mb-3">
                          {showcaseData[activeTab].previewCard.header}
                        </div>

                        <div className="space-y-2 text-xs">
                          {showcaseData[activeTab].previewCard.lines.map((line, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className="text-zinc-400">{line.label}:</span>
                              <span className="font-semibold text-zinc-200">{line.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Interactive Action Buttons with Live State */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setInteractiveCategory((c) => (c === "Dining" ? "Groceries" : "Dining"))
                        }
                        className="py-2 px-3 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/60 text-center transition-all hover:text-white cursor-pointer active:scale-95"
                      >
                        ✏️ Change Category
                      </button>
                      <button
                        type="button"
                        onClick={() => alert("Simulation: Undo soft-delete action triggered.")}
                        className="py-2 px-3 rounded-lg bg-zinc-800/90 hover:bg-rose-950/40 text-rose-300 text-xs font-medium border border-zinc-700/60 text-center transition-all cursor-pointer active:scale-95"
                      >
                        🗑️ Undo / Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 text-xs font-bold">
                          田
                        </div>
                        <span className="text-xs font-semibold text-zinc-300">
                          Google Sheets • Transactions Tab
                        </span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono">APPENDED</span>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 font-mono text-xs space-y-2">
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
                        <span className="text-purple-300">{showcaseData[activeTab].sheetRow.category}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-500">Description:</span>
                        <span className="text-zinc-300 truncate max-w-[200px]">{showcaseData[activeTab].sheetRow.description}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Row Status:</span>
                        <span className="text-emerald-400 font-bold">{showcaseData[activeTab].sheetRow.status}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ASYMMETRIC BENTO GRID */}
        <section id="features" className="my-16 sm:my-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              System Capabilities
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
              Full-Stack Architecture
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Bespoke event handling, zero-trust confirmation loops, and multimodal intelligence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Card 1: Wide Fintech Hub */}
            <div className="md:col-span-2 p-7 rounded-3xl glass-card relative overflow-hidden border border-white/10 hover:border-blue-500/40">
              <div className="flex items-start justify-between mb-4">
                <div className="text-3xl p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20">
                  💳
                </div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
                  Fintech Hub
                </span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Apple Pay Tap & DBS PayLah Real-Time Push
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Couples iOS 17 Shortcuts webhooks with Google Cloud Pub/Sub push notifications.
                Receipts from NFC taps or DBS PayNow transfers are parsed deterministically and logged in under 3 seconds.
              </p>

              <div className="mt-6 pt-5 border-t border-zinc-900 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-zinc-500 text-[11px]">NFC Tap Response</div>
                  <div className="font-mono font-bold text-white mt-0.5">&lt; 1.2s</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-[11px]">Gmail Pub/Sub Push</div>
                  <div className="font-mono font-bold text-white mt-0.5">Real-Time</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-[11px]">Regex Accuracy</div>
                  <div className="font-mono font-bold text-emerald-400 mt-0.5">100%</div>
                </div>
              </div>
            </div>

            {/* Card 2: Voice Audio Buffer */}
            <div className="p-7 rounded-3xl glass-card border border-white/10 hover:border-amber-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                    🎙️
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                    Audio Buffer
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
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

            {/* Card 3: Dual Calendar */}
            <div className="p-7 rounded-3xl glass-card border border-white/10 hover:border-cyan-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                    📅
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                    Calendar Engine
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
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

            {/* Card 4: Receipt Vision */}
            <div className="p-7 rounded-3xl glass-card border border-white/10 hover:border-emerald-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                    📸
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    Computer Vision
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
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

            {/* Card 5: Zero-Trust Security */}
            <div className="p-7 rounded-3xl glass-card border border-white/10 hover:border-rose-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                    🛡️
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20">
                    Zero-Trust
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  Security Safeguards
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  Single-use cryptographic tokens with 5-minute auto-expiry, user allowlisting, and stateful deduplication.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Action Expiration</span>
                <span className="font-mono font-bold text-rose-400">5 Mins</span>
              </div>
            </div>
          </div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section id="architecture" className="my-16 sm:my-24">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="max-w-3xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Data Flow
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-3">
                Event-Driven Serverless Architecture
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
                },
                {
                  step: "02",
                  title: "Auth & Validation",
                  desc: "Secret verification, user ID allowlist check, and stateful UpdateLog deduplication.",
                  badge: "Zero-Trust",
                },
                {
                  step: "03",
                  title: "Intelligence Routing",
                  desc: "Gemini 3.6 Flash multimodal audio/vision & deterministic regex parser.",
                  badge: "AI SDK v4",
                },
                {
                  step: "04",
                  title: "Storage & Feedback",
                  desc: "Google Sheets / Calendar append & interactive Telegram callback dispatch.",
                  badge: "Workspace API",
                },
              ].map((pipe) => (
                <div
                  key={pipe.step}
                  className="p-5 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-mono font-extrabold text-emerald-400">
                        {pipe.step}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        {pipe.badge}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-white mb-1.5">{pipe.title}</div>
                    <div className="text-xs text-zinc-400 leading-relaxed">{pipe.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* COMMAND REFERENCE */}
        <section id="commands" className="my-16 sm:my-24">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/10 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white">Bot Command Reference</h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Click any command to copy it directly to your clipboard.
                </p>
              </div>
              <div className="text-xs font-mono text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 w-fit">
                Run /setcommands in Telegram to sync
              </div>
            </div>

            <div className="divide-y divide-zinc-800/60 font-mono text-sm">
              {commands.map((c) => (
                <div
                  key={c.cmd}
                  onClick={() => handleCopy(c.cmd)}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-white/[0.02] px-2 rounded-lg transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <code className="text-emerald-400 font-semibold px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 group-hover:border-emerald-500/40 transition-colors">
                      {c.cmd}
                    </code>
                    <span className="text-zinc-300 font-sans text-xs sm:text-sm">{c.desc}</span>
                  </div>

                  <span className="text-xs text-zinc-500 group-hover:text-emerald-400 transition-colors flex items-center gap-1">
                    {copiedCmd === c.cmd ? "✓ Copied!" : "Click to copy"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FOOTER */}
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
              className="hover:text-zinc-300 transition-colors"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
