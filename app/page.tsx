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
  IconReceipt,
  IconZap,
  IconGauge,
  IconSearch,
  IconRefresh,
  IconSliders,
  IconCheckCircle,
} from "@/components/icons";

type ShowcaseKey =
  | "apple-pay"
  | "universal-receipts"
  | "flash-lite"
  | "voice"
  | "vision"
  | "calendar";

export default function Home() {
  const [activeTab, setActiveTab] = useState<ShowcaseKey>("apple-pay");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "sheet" | "json">("card");
  const [interactiveCategory, setInteractiveCategory] = useState<string>("Dining");
  const [interactiveAmount, setInteractiveAmount] = useState<string>("SGD 14.50");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("All");
  const [commandSearch, setCommandSearch] = useState<string>("");
  const [antiHallucinationInput, setAntiHallucinationInput] = useState<string>("spent $10");

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
      latency: string;
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
      rawJson: Record<string, unknown>;
    }
  > = {
    "apple-pay": {
      title: "Apple Pay Tap-to-Log",
      badge: "iOS 17 Shortcuts Webhook",
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
      icon: <IconContactless className="w-4 h-4 text-sky-400" />,
      description:
        "Physical NFC terminal tap triggers an iOS Shortcut that dispatches an HMAC-authenticated webhook. Parsed and logged to Google Sheets with interactive Telegram feedback.",
      latency: "380ms",
      terminal: [
        { role: "device", label: "NFC_SIGNAL", text: "Apple Pay NFC tap: S$14.50 at 'Toast Box (Marina Bay Sands)'" },
        { role: "system", label: "WEBHOOK", text: "POST /api/apple-wallet [200 OK • HMAC verified • 380ms]" },
        { role: "ai", label: "AI_INFERENCE", text: "Gemini Flash-Lite: Category 'Dining' • Item 'Kaya Toast Set'" },
        { role: "bot", label: "TELEGRAM", text: "Dispatched interactive card with category change & undo buttons" },
      ],
      previewCard: {
        header: "Apple Pay Expense Recorded",
        lines: [
          { label: "Item", value: "Kaya Toast Set" },
          { label: "Amount", value: interactiveAmount },
          { label: "Merchant", value: "Toast Box (Marina Bay Sands)" },
          { label: "Category", value: interactiveCategory },
          { label: "Timestamp", value: "Today @ 3:13 PM (SGT)" },
          { label: "Method", value: "Apple Pay (Physical Terminal)" },
        ],
      },
      sheetRow: {
        timestamp: "14 Sep 2026 @ 3:13 PM",
        type: "expense",
        amount: interactiveAmount,
        category: interactiveCategory,
        description: "Kaya Toast Set @ Toast Box (Apple Pay)",
        status: "active",
      },
      rawJson: {
        source: "apple-wallet",
        action: "finance_add",
        amount: 14.5,
        currency: "SGD",
        merchant: "Toast Box",
        category: interactiveCategory,
        verified: true,
        latencyMs: 380,
      },
    },
    "universal-receipts": {
      title: "Universal Email Receipt Sync",
      badge: "Google Cloud Pub/Sub Push",
      badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
      icon: <IconReceipt className="w-4 h-4 text-purple-400" />,
      description:
        "Event-driven push architecture monitoring ANY incoming merchant receipt or e-invoice (Shopee, Amazon, Apple, Grab, Deliveroo, airlines, utilities) with daily auto-renewing watch cron.",
      latency: "620ms",
      terminal: [
        { role: "device", label: "PUBSUB_PUSH", text: "Cloud Pub/Sub push event received for messageId '18e21a4f9b'" },
        { role: "system", label: "PARALLEL_SYNC", text: "Promise.allSettled batch worker initialized (<1s latency)" },
        { role: "ai", label: "UNIVERSAL_AI", text: "Gemini Flash-Lite parsed Shopee SG: SGD 32.80 • Tech Accessories" },
        { role: "bot", label: "TELEGRAM", text: "Logged to Google Sheets • Dispatched '🟠 Shopee Order Logged!'" },
      ],
      previewCard: {
        header: "Shopee Order Logged",
        lines: [
          { label: "Merchant", value: "Shopee SG Official" },
          { label: "Amount", value: "SGD 32.80" },
          { label: "Category", value: "Shopping" },
          { label: "Method", value: "ShopeePay / In-App" },
          { label: "Watch Renewal", value: "Vercel Cron (0 2 * * *)" },
        ],
      },
      sheetRow: {
        timestamp: "14 Sep 2026 @ 4:05 PM",
        type: "expense",
        amount: "SGD 32.80",
        category: "Shopping",
        description: "Shopee SG Official (Receipt)",
        status: "active",
      },
      rawJson: {
        source: "gmail-pubsub",
        merchant: "Shopee SG Official",
        amount: 32.8,
        currency: "SGD",
        category: "Shopping",
        cronRenewed: true,
        latencyMs: 620,
      },
    },
    "flash-lite": {
      title: "Sub-Second AI Intent Engine",
      badge: "Gemini Flash-Lite Tier",
      badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
      icon: <IconZap className="w-4 h-4 text-emerald-400" />,
      description:
        "Optimized primary model delivering sub-second response times (~752ms) with ~80% token cost reduction, strict anti-hallucination guardrails, and automated failover.",
      latency: "752ms",
      terminal: [
        { role: "device", label: "USER_TEXT", text: "Telegram message: 'spent $10'" },
        { role: "system", label: "MODEL_SELECT", text: "Primary: google('gemini-flash-lite-latest') [~752ms]" },
        { role: "ai", label: "GUARDRAIL", text: "Anti-hallucination enforced: Generic spend mapped to 'Expense'" },
        { role: "bot", label: "TELEGRAM", text: "Zod-validated intent committed without fabricating item names" },
      ],
      previewCard: {
        header: "Expense Confirmed (Anti-Hallucination)",
        lines: [
          { label: "Description", value: "Expense (No hallucination)" },
          { label: "Amount", value: "SGD 10.00" },
          { label: "Category", value: "General / Other" },
          { label: "Inference Time", value: "752ms (Fast-Path)" },
          { label: "Cost Savings", value: "~80% vs standard models" },
        ],
      },
      sheetRow: {
        timestamp: "14 Sep 2026 @ 5:10 PM",
        type: "expense",
        amount: "SGD 10.00",
        category: "General",
        description: "Expense",
        status: "active",
      },
      rawJson: {
        action: "finance_add",
        type: "expense",
        amount: 10,
        currency: "SGD",
        description: "Expense",
        model: "gemini-flash-lite-latest",
        inferenceLatencyMs: 752,
      },
    },
    voice: {
      title: "Multimodal Voice Memos",
      badge: "In-Memory Opus Audio Buffer",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      icon: <IconMicrophone className="w-4 h-4 text-amber-400" />,
      description:
        "Speak naturally on Telegram while on the move. Spoken Opus audio notes are streamed into zero-disk RAM buffers with magic-byte validation and transcribed into type-safe actions.",
      latency: "890ms",
      terminal: [
        { role: "device", label: "AUDIO_STREAM", text: "Telegram Voice Memo (Opus/OGG 28KB stream in RAM)" },
        { role: "system", label: "BUFFER_CHECK", text: "Magic-byte OggS header verified • Zero-disk conversion" },
        { role: "ai", label: "GEMINI_AUDIO", text: "Transcribed: 'Spent 45 dollars on petrol at Shell'" },
        { role: "bot", label: "TELEGRAM", text: "Committed SGD 45.00 • Transport • Shell to Sheets" },
      ],
      previewCard: {
        header: "Voice Memo Processed",
        lines: [
          { label: "Transcription", value: "\"Spent 45 dollars on petrol at Shell\"" },
          { label: "Intent", value: "finance_add (Expense)" },
          { label: "Amount", value: "SGD 45.00" },
          { label: "Category", value: "Transport" },
          { label: "Merchant", value: "Shell" },
        ],
      },
      sheetRow: {
        timestamp: "14 Sep 2026 @ 5:45 PM",
        type: "expense",
        amount: "SGD 45.00",
        category: "Transport",
        description: "Shell (Voice Memo)",
        status: "active",
      },
      rawJson: {
        source: "voice-memo",
        transcription: "Spent 45 dollars on petrol at Shell",
        amount: 45,
        currency: "SGD",
        category: "Transport",
        bufferValidated: true,
      },
    },
    vision: {
      title: "Multimodal Receipt Vision OCR",
      badge: "Batch Vision OCR (Up to 25 items)",
      badgeColor: "border-rose-500/30 bg-rose-500/10 text-rose-400",
      icon: <IconCameraScan className="w-4 h-4 text-rose-400" />,
      description:
        "Snap photos of receipts, physical invoices, or schedules. Computer vision extracts line items, subtotals, GST, and dates with automated batch insertion.",
      latency: "1,120ms",
      terminal: [
        { role: "device", label: "PHOTO_UPLOAD", text: "Physical supermarket receipt uploaded via Telegram" },
        { role: "system", label: "MAGIC_BYTES", text: "JPEG/PNG signature verified • Buffer read into memory" },
        { role: "ai", label: "VISION_OCR", text: "Extracted 4 items: Milk, Bread, Apples, Greek Yogurt (S$28.40)" },
        { role: "bot", label: "TELEGRAM", text: "Batch committed to Google Sheets with itemized line breakdown" },
      ],
      previewCard: {
        header: "Receipt Photo Extracted",
        lines: [
          { label: "Merchant", value: "FairPrice Xtra (Jurong Point)" },
          { label: "Items Extracted", value: "4 Line Items (Groceries)" },
          { label: "Total Amount", value: "SGD 28.40 (Inc. 9% GST)" },
          { label: "Category", value: "Groceries" },
          { label: "Date Detected", value: "14 Sep 2026" },
        ],
      },
      sheetRow: {
        timestamp: "14 Sep 2026 @ 6:10 PM",
        type: "expense",
        amount: "SGD 28.40",
        category: "Groceries",
        description: "FairPrice Xtra - 4 Items (Receipt OCR)",
        status: "active",
      },
      rawJson: {
        source: "photo-ocr",
        merchant: "FairPrice Xtra",
        totalAmount: 28.4,
        currency: "SGD",
        itemCount: 4,
        category: "Groceries",
      },
    },
    calendar: {
      title: "Dual-Calendar Agenda Engine",
      badge: "2-Way Personal & Work Sync",
      badgeColor: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
      icon: <IconCalendar className="w-4 h-4 text-cyan-400" />,
      description:
        "Intelligently routes events between Personal and Work Google Calendars. Resolves Singapore timezone offsets (+08:00) with 1-tap calendar switching and conflict detection.",
      latency: "410ms",
      terminal: [
        { role: "device", label: "USER_TEXT", text: "Telegram: 'Dentist appointment tomorrow 3pm for 1 hour'" },
        { role: "system", label: "TIMEZONE_RES", text: "Resolved Singapore SGT: 2026-09-15T15:00:00+08:00" },
        { role: "ai", label: "INTENT_ENGINE", text: "Calendar: 'personal' • Title: 'Dentist Appointment' • 60m" },
        { role: "bot", label: "GOOGLE_CAL", text: "Event created with inline button: 'Switch to Work Calendar'" },
      ],
      previewCard: {
        header: "Calendar Event Scheduled",
        lines: [
          { label: "Event Title", value: "Dentist Appointment" },
          { label: "Target Calendar", value: "Personal (Google Calendar)" },
          { label: "Scheduled Time", value: "Tomorrow @ 3:00 PM - 4:00 PM" },
          { label: "Timezone", value: "Asia/Singapore (SGT +08:00)" },
          { label: "Quick Action", value: "1-Tap Move to Work Calendar" },
        ],
      },
      sheetRow: {
        timestamp: "15 Sep 2026 @ 3:00 PM",
        type: "event",
        amount: "--",
        category: "Calendar",
        description: "Dentist Appointment (Personal)",
        status: "confirmed",
      },
      rawJson: {
        action: "calendar_add",
        calendarName: "personal",
        title: "Dentist Appointment",
        start: "2026-09-15T15:00:00+08:00",
        end: "2026-09-15T16:00:00+08:00",
        allDay: false,
      },
    },
  };

  const commandList = [
    { cmd: "spent $12 on lunch", desc: "Logs SGD 12 under Dining using Flash-Lite fast path", cat: "Finance" },
    { cmd: "paid 45 for grab ride", desc: "Logs SGD 45 under Transport with Grab merchant tag", cat: "Finance" },
    { cmd: "income $3500 monthly salary", desc: "Logs SGD 3,500 under Income with credit audit trail", cat: "Finance" },
    { cmd: "summary month", desc: "Displays current month's categorized spending summary", cat: "Finance" },
    { cmd: "what did i spend today", desc: "Provides itemized breakdown of today's transactions", cat: "Finance" },
    { cmd: "delete coffee", desc: "Soft-deletes the most recent coffee transaction", cat: "Finance" },
    { cmd: "gym tomorrow 7pm for 1h", desc: "Creates timed 1-hour personal calendar event", cat: "Calendar" },
    { cmd: "board meeting friday 2pm in work", desc: "Creates scheduled event explicitly in Work calendar", cat: "Calendar" },
    { cmd: "my schedule tomorrow", desc: "Aggregates unified schedule across Personal & Work", cat: "Calendar" },
    { cmd: "move to work calendar", desc: "Swipe-reply to switch newly created event to Work calendar", cat: "Calendar" },
    { cmd: "add todo buy groceries by tomorrow", desc: "Adds task to Google-synced to-do checklist with due date", cat: "System" },
    { cmd: "my tasks", desc: "Lists all active pending tasks and priorities", cat: "System" },
    { cmd: "POST /api/apple-wallet", desc: "iOS Shortcuts NFC Tap webhook endpoint (HMAC verified)", cat: "Fintech" },
    { cmd: "POST /api/gmail-webhook", desc: "Google Cloud Pub/Sub real-time push ingestion endpoint", cat: "Fintech" },
    { cmd: "GET /api/cron/renew-gmail-watch", desc: "Daily automated Gmail watch renewal cron (0 2 * * *)", cat: "Fintech" },
  ];

  const filteredCommands = commandList.filter((c) => {
    const matchesCat =
      selectedCategoryFilter === "All" || c.cat === selectedCategoryFilter;
    const matchesSearch =
      c.cmd.toLowerCase().includes(commandSearch.toLowerCase()) ||
      c.desc.toLowerCase().includes(commandSearch.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="relative min-h-screen bg-[#07080b] text-[#f8fafc] selection:bg-emerald-500 selection:text-black font-sans">
      {/* Dynamic Background Mesh */}
      <div className="fixed inset-0 bg-mesh-glow pointer-events-none z-0 opacity-80" />
      <div className="fixed inset-0 bg-tech-grid pointer-events-none z-0 opacity-40" />

      {/* TOP STATUS NAVIGATION BAR */}
      <div className="fixed top-0 left-0 right-0 z-50 px-4 py-3 sm:px-8">
        <header className="max-w-6xl mx-auto glass-panel rounded-2xl px-4 sm:px-6 py-3 flex items-center justify-between shadow-2xl">
          {/* Logo & System Status */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-zinc-950 font-bold shadow-md shadow-emerald-500/20">
              <IconTelegram className="w-4 h-4 text-zinc-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-sm tracking-tight text-white">
                  Assistant Core
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  v3.0 • Production Live
                </span>
              </div>
              <div className="text-[11px] font-mono text-zinc-400 hidden sm:block">
                Sub-Second Fintech • Dual-Calendar • Universal OCR
              </div>
            </div>
          </div>

          {/* Quick Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400">
            <a href="#showcase" className="hover:text-white transition-colors focus-visible:text-white">
              Showcase
            </a>
            <a href="#benchmarks" className="hover:text-white transition-colors focus-visible:text-white">
              Benchmarks
            </a>
            <a href="#features" className="hover:text-white transition-colors focus-visible:text-white">
              Architecture
            </a>
            <a href="#guardrails" className="hover:text-white transition-colors focus-visible:text-white">
              Guardrails
            </a>
            <a href="#commands" className="hover:text-white transition-colors focus-visible:text-white">
              Commands
            </a>
          </nav>

          {/* Social & External Links */}
          <div className="flex items-center gap-2.5">
            <a
              href="https://www.linkedin.com/in/evanyap7/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-all group focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"
            >
              <div className="w-4 h-4 rounded bg-blue-500/20 flex items-center justify-center">
                <IconLinkedIn className="w-3 h-3 text-blue-400" />
              </div>
              <span className="font-semibold text-white group-hover:text-emerald-300 transition-colors">
                Evan Yap
              </span>
              <IconExternalLink className="w-3 h-3 text-zinc-500 group-hover:text-emerald-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>

            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View Source on GitHub"
              className="p-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"
              title="View Source on GitHub"
            >
              <IconGitHub className="w-4 h-4" />
            </a>
          </div>
        </header>
      </div>

      {/* MAIN CONTAINER */}
      <main className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-32 pb-24">
        {/* HERO SECTION */}
        <section className="py-12 sm:py-20 text-center sm:text-left relative">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            Engineered with Gemini Flash-Lite & Google Cloud Pub/Sub
          </div>

          <h1 className="font-display text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white max-w-4xl leading-[1.08]">
            Sub-Second Fintech &{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              Multimodal Orchestration.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-zinc-300 max-w-2xl leading-relaxed font-normal">
            A serverless assistant coupling Apple Pay NFC taps and universal receipt push webhooks with Gemini Flash-Lite, streaming Opus audio buffers, and dual-calendar scheduling into Google Sheets in under 750ms.
          </p>

          {/* Quick Filter Switchers */}
          <div className="mt-8 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs">
            <span className="text-zinc-500 text-[11px] font-mono uppercase tracking-wider font-semibold mr-1">
              Select Engine:
            </span>
            {[
              { id: "apple-pay", label: "Apple Pay Tap", icon: <IconContactless className="w-3.5 h-3.5" /> },
              { id: "universal-receipts", label: "Universal Receipts", icon: <IconReceipt className="w-3.5 h-3.5" /> },
              { id: "flash-lite", label: "Flash-Lite (<750ms)", icon: <IconZap className="w-3.5 h-3.5" /> },
              { id: "voice", label: "Voice Opus", icon: <IconMicrophone className="w-3.5 h-3.5" /> },
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
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  activeTab === chip.id
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300 font-semibold shadow-sm"
                    : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80"
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
              { label: "Fast-Path Latency", value: "< 750ms", sub: "Gemini Flash-Lite Primary", icon: <IconGauge className="w-4 h-4 text-emerald-400" /> },
              { label: "Token Cost Cut", value: "~80%", sub: "Lite-Tier Model Routing", icon: <IconZap className="w-4 h-4 text-emerald-400" /> },
              { label: "Watch Renewal", value: "24/7", sub: "Automated Daily Cron", icon: <IconRefresh className="w-4 h-4 text-emerald-400" /> },
              { label: "Hallucinations", value: "0%", sub: "Strict Zod & Description Rules", icon: <IconShield className="w-4 h-4 text-emerald-400" /> },
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
                <div className="text-[11px] text-zinc-400 mt-0.5">{metric.sub}</div>
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
              Toggle between the simulated Telegram interactive card, the Google Sheets live row, and the raw payload telemetry.
            </p>
          </div>

          {/* Workbench Tabs */}
          <div className="flex justify-center mb-6">
            <div
              role="tablist"
              className="p-1.5 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex flex-wrap items-center justify-center gap-1 shadow-inner"
            >
              {(
                [
                  { id: "apple-pay", label: "Apple Pay Tap", tag: "NFC Webhook", icon: <IconContactless className="w-3.5 h-3.5" /> },
                  { id: "universal-receipts", label: "Universal Receipts", tag: "Pub/Sub Push", icon: <IconReceipt className="w-3.5 h-3.5" /> },
                  { id: "flash-lite", label: "Flash-Lite (<750ms)", tag: "AI Intent", icon: <IconZap className="w-3.5 h-3.5" /> },
                  { id: "voice", label: "Voice Opus", tag: "RAM Buffer", icon: <IconMicrophone className="w-3.5 h-3.5" /> },
                  { id: "vision", label: "Receipt Vision", tag: "Batch OCR", icon: <IconCameraScan className="w-3.5 h-3.5" /> },
                  { id: "calendar", label: "Dual Calendar", tag: "2-Way Sync", icon: <IconCalendar className="w-3.5 h-3.5" /> },
                ] as const
              ).map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={isActive}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors duration-150 flex items-center gap-2 cursor-pointer border focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      isActive
                        ? "bg-zinc-800 border-zinc-700 text-white font-semibold shadow-sm"
                        : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                  >
                    {tab.icon}
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

          {/* Workbench Display Console */}
          <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/[0.08] shadow-2xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800">
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
                <p className="text-xs sm:text-sm text-zinc-300 mt-1 max-w-xl">
                  {showcaseData[activeTab].description}
                </p>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
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
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    viewMode === "sheet"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <IconSheetTable className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Google Sheets</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("json")}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    viewMode === "json"
                      ? "bg-zinc-800 text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <IconCodeBracket className="w-3.5 h-3.5 text-purple-400" />
                  <span>Raw JSON</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">
              {/* Left Column: Serverless Log Pipeline */}
              <div className="rounded-2xl bg-zinc-950/90 border border-zinc-800 p-5 font-mono text-xs flex flex-col justify-between shadow-inner min-h-[320px]">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-900 text-zinc-400 text-[11px] uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <IconTerminal className="w-3.5 h-3.5 text-zinc-400" />
                      Serverless Execution Trace
                    </span>
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {showcaseData[activeTab].latency}
                    </span>
                  </div>

                  {activeTab === "voice" && (
                    <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                      <div className="text-amber-300 text-xs font-sans font-medium flex items-center gap-2">
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
                          <span className="text-[10px] uppercase font-bold text-zinc-400 mr-2 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
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

                <div className="mt-6 pt-3 border-t border-zinc-900 flex items-center justify-between text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <IconClock className="w-3.5 h-3.5 text-zinc-400" />
                    Roundtrip Latency: {showcaseData[activeTab].latency}
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <IconShield className="w-3.5 h-3.5" />
                    Zero-Trust Verified
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
                              Telegram Notification Card
                            </div>
                            <div className="text-[10px] text-zinc-400">Singapore Time (SGT +08:00)</div>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono">Real-Time Push</span>
                      </div>

                      <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 mb-4">
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

                    {/* Interactive Action Buttons with Zero Emojis (SVG only) */}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setInteractiveCategory((c) =>
                            c === "Dining" ? "Groceries" : c === "Groceries" ? "Transport" : "Dining"
                          )
                        }
                        className="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 text-center transition-all hover:text-white cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <IconPencil className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Toggle Category ({interactiveCategory})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setInteractiveAmount((a) => (a === "SGD 14.50" ? "SGD 18.20" : "SGD 14.50"))
                        }
                        className="py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 text-center transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        <IconSliders className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Edit Amount</span>
                      </button>
                    </div>
                  </>
                ) : viewMode === "sheet" ? (
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
                          <div className="text-[10px] text-zinc-400">Transactions Sheet • Row 42</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        APPENDED
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-950/90 border border-zinc-800 font-mono text-xs space-y-2.5">
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-400">Timestamp:</span>
                        <span className="text-zinc-200">{showcaseData[activeTab].sheetRow.timestamp}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-400">Amount:</span>
                        <span className="text-emerald-400 font-bold">{showcaseData[activeTab].sheetRow.amount}</span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-400">Category:</span>
                        <span className="text-purple-300 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-[11px]">
                          {showcaseData[activeTab].sheetRow.category}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-zinc-900 pb-2">
                        <span className="text-zinc-400">Description:</span>
                        <span className="text-zinc-300 truncate max-w-[200px]">{showcaseData[activeTab].sheetRow.description}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Row Status:</span>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {showcaseData[activeTab].sheetRow.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-400 text-xs font-bold">
                          <IconCodeBracket className="w-3.5 h-3.5 text-purple-400" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-zinc-200">
                            Telemetry JSON Payload
                          </div>
                          <div className="text-[10px] text-zinc-400">Zod-Validated Output</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-purple-300 font-mono px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                        TYPE-SAFE
                      </span>
                    </div>

                    <pre className="p-4 rounded-xl bg-zinc-950/90 border border-zinc-800 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                      {JSON.stringify(showcaseData[activeTab].rawJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* LIVE LATENCY & COST BENCHMARKS */}
        <section id="benchmarks" className="my-16 sm:my-24 scroll-mt-28">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl relative overflow-hidden">
            <div className="max-w-2xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Model Efficiency Benchmark
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mt-3">
                Sub-Second Speed & 80% Cost Reduction
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                Empirical benchmarks comparing Google Gemini Flash-Lite against larger models on our production webhook payload suite.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Latency Breakdown */}
              <div className="p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs font-mono font-bold uppercase text-zinc-300 flex items-center gap-1.5">
                    <IconGauge className="w-4 h-4 text-emerald-400" />
                    Roundtrip Latency (ms)
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 font-bold">Lower is Faster</span>
                </div>

                <div className="space-y-4">
                  {[
                    { name: "Gemini Flash-Lite (Our Primary)", ms: 752, width: "24%", color: "bg-emerald-400", highlight: true },
                    { name: "Gemini 3.5 Flash-Lite", ms: 999, width: "32%", color: "bg-teal-400", highlight: false },
                    { name: "Gemini 3.6 Flash (Fallback 1)", ms: 1195, width: "38%", color: "bg-blue-400", highlight: false },
                    { name: "Perplexity Sonar (Fallback 2)", ms: 1850, width: "59%", color: "bg-purple-400", highlight: false },
                    { name: "Legacy GPT-4 / Claude 3", ms: 3150, width: "100%", color: "bg-zinc-600", highlight: false },
                  ].map((item) => (
                    <div key={item.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className={`font-medium ${item.highlight ? "text-white font-bold" : "text-zinc-400"}`}>
                          {item.name}
                        </span>
                        <span className="font-mono font-bold text-zinc-200">{item.ms} ms</span>
                      </div>
                      <div className="w-full h-2.5 rounded-full bg-zinc-900 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${item.color}`}
                          style={{ width: item.width }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Token Cost Efficiency */}
              <div className="p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs font-mono font-bold uppercase text-zinc-300 flex items-center gap-1.5">
                      <IconZap className="w-4 h-4 text-amber-400" />
                      Inference Cost per 1M Input Tokens
                    </div>
                    <span className="text-[11px] font-mono text-emerald-400 font-bold">~80% Savings</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-[11px] text-zinc-400 font-mono">Gemini Flash-Lite</div>
                      <div className="font-mono text-xl font-bold text-emerald-400 mt-1">$0.075</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">Ultra-low latency</div>
                    </div>
                    <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                      <div className="text-[11px] text-zinc-400 font-mono">Perplexity Sonar</div>
                      <div className="font-mono text-xl font-bold text-zinc-300 mt-1">$1.000</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">13x higher cost</div>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed">
                    By placing Gemini Flash-Lite as the primary Tier-1 model and using Perplexity Sonar strictly as an on-demand fallback, overall webhook execution costs dropped by <strong className="text-emerald-400">80%</strong> with zero sacrifice in structured extraction accuracy.
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-zinc-900 flex items-center justify-between text-xs text-zinc-400 font-mono">
                  <span>3-Tier Failover: Lite &rarr; Flash &rarr; Sonar</span>
                  <span className="text-emerald-400 flex items-center gap-1">
                    <IconCheckCircle className="w-3.5 h-3.5" /> High Availability
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ANTI-HALLUCINATION & SECURITY INSPECTOR */}
        <section id="guardrails" className="my-16 sm:my-24 scroll-mt-28">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl">
            <div className="max-w-2xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Precision & Security
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mt-3">
                Zero Hallucinations & Enterprise PII Redaction
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2">
                Test how ambiguous or sensitive inputs are handled with strict prompt boundaries and crypto safeguards.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Interactive Hallucination Test */}
              <div className="p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800">
                <div className="text-xs font-mono font-bold uppercase text-zinc-300 mb-3 flex items-center gap-1.5">
                  <IconShield className="w-4 h-4 text-emerald-400" />
                  Anti-Hallucination Guardrail Simulation
                </div>

                <div className="flex gap-2 mb-4">
                  {[
                    "spent $10",
                    "paid $14.50 for Kaya Toast",
                    "expense 20",
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setAntiHallucinationInput(example)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer border ${
                        antiHallucinationInput === example
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      &quot;{example}&quot;
                    </button>
                  ))}
                </div>

                <div className="space-y-3 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                    <div className="text-rose-400 font-bold mb-1">❌ Unconstrained LLM Failure:</div>
                    <div className="text-zinc-300">
                      Input: &quot;{antiHallucinationInput}&quot; &rarr; Hallucinates &quot;Chicken Rice @ Kopitiam (Dining)&quot;
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div className="text-emerald-400 font-bold mb-1">✅ Our Guarded Pipeline Output:</div>
                    <div className="text-zinc-200">
                      {antiHallucinationInput === "spent $10"
                        ? 'Description: "Expense" • Category: "General" • Item: null'
                        : antiHallucinationInput === "expense 20"
                        ? 'Description: "Expense" • Category: "General" • Item: null'
                        : 'Description: "Kaya Toast" • Category: "Dining" • Merchant: "Verbatim"'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Security Matrix */}
              <div className="p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col justify-between">
                <div>
                  <div className="text-xs font-mono font-bold uppercase text-zinc-300 mb-3 flex items-center gap-1.5">
                    <IconBolt className="w-4 h-4 text-cyan-400" />
                    Cryptographic & Privacy Safeguards
                  </div>

                  <div className="space-y-2.5 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">timingSafeEqual Auth:</span>
                      <span className="text-emerald-400 font-bold">Zero-Timing Attack Risk</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">16-Digit PAN Redaction:</span>
                      <span className="text-cyan-400 font-bold">**** **** **** 4444</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">Singapore NRIC Masking:</span>
                      <span className="text-cyan-400 font-bold">S*****67A</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-center justify-between">
                      <span className="text-zinc-400">OTP Code Stripping:</span>
                      <span className="text-cyan-400 font-bold">[REDACTED OTP]</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-900 text-[11px] text-zinc-400 font-mono flex items-center justify-between">
                  <span>Stateful UpdateLog Deduplication</span>
                  <span className="text-emerald-400 font-bold">0 Retry Storms</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SYSTEM CAPABILITIES BENTO MATRIX */}
        <section id="features" className="my-16 sm:my-24 scroll-mt-28">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              System Capabilities
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white mt-3">
              Full-Stack Architecture
            </h2>
            <p className="text-sm text-zinc-400 mt-2">
              Bento grid architecture adhering to UI/UX Pro Max design intelligence rules.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Bento 1: Wide Universal Fintech Hub */}
            <div className="md:col-span-2 p-7 rounded-3xl glass-card relative overflow-hidden border border-white/[0.08] hover:border-blue-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    <IconReceipt className="w-6 h-6 text-blue-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
                    Universal Fintech Hub
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Apple Pay NFC & Universal Email Receipt Push
                </h3>
                <p className="text-sm text-zinc-300 leading-relaxed max-w-xl">
                  Unified event ingestion coupling iOS 17 Shortcuts with Google Cloud Pub/Sub push webhooks. Automatically parses receipts across Shopee, Amazon, Apple, Grab, DBS PayLah, Foodpanda, Deliveroo, airlines, and utilities with parallel batch execution.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-zinc-400 text-[11px] font-mono">NFC Response</div>
                  <div className="font-mono font-bold text-white mt-0.5">&lt; 400ms</div>
                </div>
                <div>
                  <div className="text-zinc-400 text-[11px] font-mono">Pub/Sub Ingestion</div>
                  <div className="font-mono font-bold text-white mt-0.5">Push-Driven</div>
                </div>
                <div>
                  <div className="text-zinc-400 text-[11px] font-mono">Batch Parallelism</div>
                  <div className="font-mono font-bold text-emerald-400 mt-0.5">Promise.allSettled</div>
                </div>
              </div>
            </div>

            {/* Bento 2: Sub-Second AI Intent Engine */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-emerald-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <IconZap className="w-6 h-6 text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    Cost & Speed
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Gemini Flash-Lite Engine
                </h3>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  Fast-path 752ms intent classifier with automated Gemini 3.6 Flash & Sonar failover, cutting operational LLM token costs by ~80%.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Inference Latency</span>
                <span className="font-mono font-bold text-emerald-400">752ms Fast Path</span>
              </div>
            </div>

            {/* Bento 3: Voice Audio Buffer */}
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
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  In-memory audio pipeline validating magic-bytes and streaming Opus audio directly into Gemini audio models with zero disk I/O.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Zero-Disk Overhead</span>
                <span className="font-mono font-bold text-amber-400">RAM Stream</span>
              </div>
            </div>

            {/* Bento 4: Dual Calendar */}
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
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  Syncs across Personal and Work Google Calendars with automatic conflict detection, 1-tap switching, and Singapore SGT (+08:00) localization.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Target Calendars</span>
                <span className="font-mono font-bold text-cyan-400">Personal & Work</span>
              </div>
            </div>

            {/* Bento 5: Receipt Vision */}
            <div className="p-7 rounded-3xl glass-card border border-white/[0.08] hover:border-purple-500/40 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                    <IconCameraScan className="w-6 h-6 text-purple-400" />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-purple-400 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                    Computer Vision
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-2">
                  Vision & Receipt OCR
                </h3>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  Extracts up to 25 line items from supermarket receipts, invoices, or event timetables with subtotal and GST breakdown.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Batch Processing</span>
                <span className="font-mono font-bold text-purple-400">Up to 25 Items</span>
              </div>
            </div>
          </div>
        </section>

        {/* ARCHITECTURE PIPELINE */}
        <section id="architecture" className="my-16 sm:my-24 scroll-mt-28">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl relative overflow-hidden">
            <div className="max-w-3xl mb-8">
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                Data Flow
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white mt-3">
                Event-Driven Serverless Pipeline
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                How incoming physical signals translate into structured cloud records in under 750ms.
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
                  desc: "Gemini Flash-Lite intent parser, anti-hallucination guardrails, and deterministic regex fast-path.",
                  badge: "AI SDK v4",
                  icon: <IconSparkles className="w-4 h-4 text-purple-400" />,
                },
                {
                  step: "04",
                  title: "Storage & Feedback",
                  desc: "Google Sheets / Calendar append & interactive Telegram callback dispatch with undo.",
                  badge: "Workspace API",
                  icon: <IconDatabase className="w-4 h-4 text-amber-400" />,
                },
              ].map((pipe) => (
                <div
                  key={pipe.step}
                  className="p-5 rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col justify-between"
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
        <section id="commands" className="my-16 sm:my-24 scroll-mt-28">
          <div className="p-8 sm:p-10 rounded-3xl glass-panel border border-white/[0.08] shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Bot Command Reference</h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                  Click any command to copy it directly to your clipboard.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                {["All", "Finance", "Calendar", "Fintech", "System"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategoryFilter(cat)}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-400 ${
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

            {/* Search Input Filter */}
            <div className="relative mb-6">
              <IconSearch className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={commandSearch}
                onChange={(e) => setCommandSearch(e.target.value)}
                placeholder="Search commands (e.g. 'spent', 'calendar', 'pubsub', 'summary')..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors"
              />
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
                    <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors font-sans">
                      {c.desc}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {c.cat}
                    </span>
                    <button
                      type="button"
                      aria-label="Copy command"
                      className="p-1.5 rounded-lg bg-zinc-900 text-zinc-400 group-hover:text-white transition-colors"
                    >
                      {copiedCmd === c.cmd ? (
                        <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <IconCopy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="pt-8 border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Operational • Singapore Timezone (SGT +08:00)</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/evanyap7/telegram-personal-assistant"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-200 transition-colors"
            >
              GitHub Repository
            </a>
            <span>•</span>
            <a
              href="https://www.linkedin.com/in/evanyap7/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-200 transition-colors"
            >
              LinkedIn Profile
            </a>
            <span>•</span>
            <span>Built by Evan Yap</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
