"use client";

import { useState } from "react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<
    "apple-pay" | "paylah" | "voice" | "vision" | "calendar"
  >("apple-pay");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const showcaseData = {
    "apple-pay": {
      title: "Apple Pay Instant Tap-to-Log",
      badge: "iOS Shortcuts Webhook",
      badgeColor: "border-blue-500/30 bg-blue-500/10 text-blue-400",
      description:
        "Tap your iPhone at any payment terminal. iOS Shortcuts catches the transaction and fires a secure HMAC-verified webhook to auto-log the purchase and trigger an interactive Telegram card.",
      terminal: [
        { role: "device", text: "📱 Apple Pay NFC Tap detected: S$14.50 at 'Toast Box'" },
        { role: "system", text: "⚡ POST /api/apple-wallet [200 OK in 410ms]" },
        { role: "ai", text: "🤖 Gemini 3.6 Flash classified: 'Dining' • Item: 'Kaya Toast Set'" },
        { role: "bot", text: "🟢 Telegram Card delivered with [✏️ Change Category] [🗑️ Undo]" },
      ],
      previewCard: {
        header: "🍏 Apple Pay Expense Recorded!",
        lines: [
          { label: "Item", value: "Kaya Toast Set" },
          { label: "Amount", value: "SGD 14.50" },
          { label: "Merchant", value: "Toast Box (Marina Bay Sands)" },
          { label: "Category", value: "Dining" },
          { label: "Status", value: "Active • Google Sheets Row #34" },
        ],
        actions: ["✏️ Change Category", "🗑️ Undo / Delete"],
      },
    },
    paylah: {
      title: "DBS PayLah! & PayNow Real-Time Push",
      badge: "Google Cloud Pub/Sub",
      badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
      description:
        "Zero-latency push architecture. Whenever DBS sends an email receipt, Google Cloud Pub/Sub pushes it directly to the serverless webhook for regex-LLM extraction and Google Sheets sync.",
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
          { label: "Category", value: "Dining" },
          { label: "Ref", value: "IPS78876518592130786" },
          { label: "Sync Type", value: "Event-Driven Pub/Sub (< 3s)" },
        ],
        actions: ["✏️ Change Category", "🗑️ Undo / Delete"],
      },
    },
    voice: {
      title: "Voice Notes & Multimodal Audio Buffer",
      badge: "Gemini 3.6 Flash Audio",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      description:
        "Speak naturally on Telegram while on the move. Spoken Opus voice memos are streamed in-memory with magic-byte validation and converted directly into structured financial or calendar intents.",
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
    },
    vision: {
      title: "Vision OCR & Receipt Processing",
      badge: "Gemini Multimodal Vision",
      badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
      description:
        "Send photos of receipts, physical invoices, or timetable screenshots. Extracts items, totals, dates, or multiple schedule events with two-step confirmation safeguards.",
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
    },
    calendar: {
      title: "Dual-Calendar Agenda Management",
      badge: "Google Calendar API v3",
      badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
      description:
        "Schedules and manages appointments across separate Personal and Work calendars. Automatically detects conflicts, resolves time windows in Singapore Time, and requires one-tap confirmation.",
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
    },
  };

  const capabilities = [
    {
      icon: "💳",
      tag: "Fintech Webhooks",
      title: "Apple Pay & NFC Tap-to-Log",
      desc: "Sub-second expense capture via iOS 17+ Shortcuts automations. Tapping Apple Pay instantly categorizes purchases with interactive Telegram actions.",
      stat: "< 1.2s",
      statLabel: "webhook execution",
      accent: "from-blue-500/20 to-cyan-500/10",
      border: "hover:border-blue-500/40",
    },
    {
      icon: "🟣",
      tag: "Push Webhook",
      title: "DBS PayLah! & PayNow Sync",
      desc: "Event-driven receipt parser powered by Google Cloud Pub/Sub and Gmail users.watch. Extracts merchant, amount, item, and ref numbers in real-time.",
      stat: "100%",
      statLabel: "deterministic extraction",
      accent: "from-purple-500/20 to-pink-500/10",
      border: "hover:border-purple-500/40",
    },
    {
      icon: "🎙️",
      tag: "Multimodal Audio",
      title: "Voice Notes & Audio Buffer",
      desc: "In-memory audio pipeline validating magic-bytes and parsing Opus voice notes directly into structured Google Sheets or Calendar actions.",
      stat: "Gemini 3.6",
      statLabel: "audio intelligence",
      accent: "from-amber-500/20 to-orange-500/10",
      border: "hover:border-amber-500/40",
    },
    {
      icon: "📸",
      tag: "Computer Vision",
      title: "Vision & Receipt OCR",
      desc: "Extracts up to 30 line items from receipts, timetable photos, or event screenshots with batch confirmation before committing to cloud storage.",
      stat: "30 Items",
      statLabel: "max batch extraction",
      accent: "from-emerald-500/20 to-teal-500/10",
      border: "hover:border-emerald-500/40",
    },
    {
      icon: "📅",
      tag: "Calendar Engine",
      title: "Dual-Calendar Management",
      desc: "Syncs Personal and Work schedules with conflict checks, Singapore Timezone localization, keyword event deletions, and 7-day agenda rollups.",
      stat: "2 Calendars",
      statLabel: "personal & work routing",
      accent: "from-cyan-500/20 to-blue-500/10",
      border: "hover:border-cyan-500/40",
    },
    {
      icon: "🛡️",
      tag: "Zero-Trust",
      title: "Security & Idempotency",
      desc: "Single-use HMAC tokens with 5-minute expiry, user allowlisting, webhook secret validation, and stateful deduplication to eliminate duplicate logging.",
      stat: "5 Mins",
      statLabel: "token auto-expiration",
      accent: "from-rose-500/20 to-red-500/10",
      border: "hover:border-rose-500/40",
    },
  ];

  const commands = [
    { cmd: "/agenda", desc: "View today's schedule across all connected Google calendars" },
    { cmd: "/calendar list", desc: "List all upcoming events for the next 7 days" },
    { cmd: "/finance summary", desc: "View spending breakdown by category with % analytics" },
    { cmd: "/finance list", desc: "View recent active finance transactions in Google Sheets" },
    { cmd: "/paylah", desc: "Run manual on-demand sync of recent DBS PayLah receipts" },
    { cmd: "/setcommands", desc: "Register interactive quick-access command menu to Telegram" },
    { cmd: "/help", desc: "Display assistant capabilities, syntax rules, and voice examples" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500 selection:text-black relative overflow-x-hidden">
      {/* Dynamic ambient mesh gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[1100px] h-[550px] bg-emerald-500/12 blur-[140px] rounded-full animate-glow" />
        <div className="absolute top-1/4 -left-48 w-[650px] h-[550px] bg-blue-600/10 blur-[160px] rounded-full" />
        <div className="absolute top-1/2 -right-48 w-[700px] h-[600px] bg-purple-600/10 blur-[160px] rounded-full" />
        <div className="absolute bottom-10 left-1/3 w-[600px] h-[450px] bg-teal-500/10 blur-[150px] rounded-full" />
      </div>

      {/* Modern Floating Header Bar */}
      <div className="fixed top-5 inset-x-0 z-50 px-4 sm:px-8">
        <header className="max-w-6xl mx-auto glass-panel rounded-full px-5 py-3 flex items-center justify-between shadow-2xl shadow-black/50 border border-white/10">
          {/* Left Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-400 flex items-center justify-center text-zinc-950 font-black text-sm shadow-md shadow-emerald-500/30">
              ⚡
            </div>
            <div>
              <div className="text-xs font-bold tracking-wider uppercase text-white flex items-center gap-2">
                NEXUS BOT
                <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-400 font-normal">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ONLINE
                </span>
              </div>
            </div>
          </div>

          {/* Center navigation links */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-zinc-400">
            <a href="#features" className="hover:text-emerald-400 transition-colors">
              Capabilities
            </a>
            <a href="#showcase" className="hover:text-emerald-400 transition-colors">
              Interactive Simulator
            </a>
            <a href="#architecture" className="hover:text-emerald-400 transition-colors">
              Architecture
            </a>
            <a href="#commands" className="hover:text-emerald-400 transition-colors">
              Commands
            </a>
          </nav>

          {/* TOP RIGHT: Developed by Evan Yap with LinkedIn Link */}
          <div className="flex items-center gap-2.5">
            <a
              href="https://www.linkedin.com/in/evanyapzhikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 hover:border-emerald-500/50 text-xs font-medium text-zinc-200 transition-all duration-200 shadow-md hover:shadow-emerald-500/20"
              title="View Evan Yap's LinkedIn Profile"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 group-hover:bg-emerald-400 transition-colors" />
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
              className="hidden sm:inline-flex p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-400 hover:text-white transition-colors"
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

      {/* Main Container */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-32 pb-24">
        {/* HERO SECTION */}
        <section className="py-12 sm:py-20 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-6 shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            v2.5 Live • Apple Pay Tap & Real-Time DBS PayLah Push
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white max-w-4xl leading-[1.1]">
            Intelligent Personal Assistant{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              For Telegram & iOS
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-xl text-zinc-400 max-w-2xl leading-relaxed">
            Autonomous serverless engine orchestrating Gemini 3.6 Flash & Perplexity Sonar.
            Automates multi-calendar scheduling, multimodal receipt OCR, and sub-3-second
            fintech pipelines with strict two-step confirmation safeguards.
          </p>

          {/* CTA Buttons */}
          <div className="mt-9 flex flex-wrap items-center justify-center sm:justify-start gap-4">
            <a
              href="https://t.me/your_telegram_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-500 text-zinc-950 font-bold text-sm flex items-center gap-2.5 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] transition-all"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.19-.08-.05-.19-.02-.27 0-.12.03-1.97 1.25-5.55 3.69-.53.36-1 .54-1.43.53-.47-.01-1.37-.26-2.04-.48-.82-.27-1.47-.42-1.42-.88.03-.24.37-.49 1.02-.75 3.99-1.74 6.66-2.88 8.01-3.44 3.82-1.58 4.61-1.86 5.13-1.87.12 0 .37.03.54.17.14.12.18.28.2.45-.02.07-.02.21-.04.34z" />
              </svg>
              Open Telegram Assistant
            </a>

            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 hover:border-zinc-600 text-zinc-200 font-semibold text-sm flex items-center gap-2 transition-all hover:scale-[1.02]"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              View Source on GitHub
            </a>
          </div>

          {/* Live Metrics Row */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-4xl">
            {[
              { label: "Fintech Sync Latency", value: "< 3s", sub: "Apple Pay & DBS Webhooks" },
              { label: "Deterministic Extraction", value: "100%", sub: "Regex + LLM hybrid" },
              { label: "Calendar Sync", value: "2-Way", sub: "Personal & Work routing" },
              { label: "Security Safeguards", value: "0-Trust", sub: "Cryptographic confirmation" },
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
        <section id="showcase" className="my-16 sm:my-24">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              Interactive Showcase
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
              See the Assistant in Action
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 mt-2">
              Select an event to simulate live webhook ingestion, AI categorization, and interactive Telegram response cards.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {[
              { id: "apple-pay", label: "💳 Apple Pay Tap", tag: "iOS 17+" },
              { id: "paylah", label: "🟣 DBS PayLah!", tag: "Pub/Sub" },
              { id: "voice", label: "🎙️ Voice Note", tag: "Opus Audio" },
              { id: "vision", label: "📸 Receipt Vision", tag: "Gemini Vision" },
              { id: "calendar", label: "📅 Dual Calendar", tag: "Smart Scheduling" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-zinc-100 text-zinc-950 shadow-lg shadow-white/10 scale-105"
                    : "bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    activeTab === tab.id ? "bg-zinc-300 text-zinc-900" : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {tab.tag}
                </span>
              </button>
            ))}
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

              <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Ingestion Ready
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              {/* Left Column: Serverless Log Pipeline */}
              <div className="rounded-2xl bg-zinc-950/90 border border-zinc-800/80 p-5 font-mono text-xs flex flex-col justify-between shadow-inner">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-900 text-zinc-500 text-[11px] uppercase tracking-wider">
                    <span>Serverless Execution Trace</span>
                    <span className="text-emerald-400 font-bold">● FAST PATH</span>
                  </div>

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

              {/* Right Column: Telegram Mock Card */}
              <div className="rounded-2xl bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 p-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 text-xs">
                        ✈️
                      </div>
                      <span className="text-xs font-semibold text-zinc-300">
                        Telegram Bot Interactive Card
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

                {/* Interactive Action Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {showcaseData[activeTab].previewCard.actions.map((act) => (
                    <button
                      key={act}
                      className="py-2 px-3 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/60 transition-colors text-center hover:text-white"
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CORE CAPABILITIES BENTO GRID */}
        <section id="features" className="my-16 sm:my-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              System Capabilities
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mt-3">
              Full-Stack Autonomous Features
            </h2>
            <p className="text-sm sm:text-base text-zinc-400 mt-2">
              Engineered with zero-trust security, dual-calendar resolution, and multi-model AI routing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.map((cap) => (
              <div
                key={cap.title}
                className={`group p-6 rounded-2xl glass-card relative overflow-hidden transition-all duration-300 ${cap.border}`}
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="text-2xl p-2.5 rounded-xl bg-zinc-900 border border-zinc-800">
                    {cap.icon}
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    {cap.tag}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-emerald-300 transition-colors">
                  {cap.title}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mb-6">
                  {cap.desc}
                </p>

                <div className="pt-4 border-t border-zinc-900 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{cap.statLabel}</span>
                  <span className="font-mono font-bold text-white group-hover:text-emerald-400 transition-colors">
                    {cap.stat}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section id="architecture" className="my-16 sm:my-24">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="max-w-3xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Data Architecture
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-3">
                Event-Driven Serverless Pipeline
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                How incoming signals (iOS Apple Pay taps, Gmail push receipts, or Telegram voice notes) flow through Vercel edge handlers to Google Workspace APIs in sub-3 seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                {
                  step: "01",
                  title: "Trigger Ingestion",
                  desc: "iOS Shortcuts Webhook, Google Cloud Pub/Sub, or Telegram webhook payload.",
                  badge: "HTTPS / HMAC",
                },
                {
                  step: "02",
                  title: "Auth & Validation",
                  desc: "Secret verification, user ID allowlisting, and stateful deduplication checks.",
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
                  Click any command to copy it directly to your clipboard for use in Telegram.
                </p>
              </div>
              <div className="text-xs font-mono text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 w-fit">
                Run /setcommands to sync menu
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
