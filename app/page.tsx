export default function Home() {
  const capabilities = [
    {
      icon: "💰",
      title: "Finance Tracking & Analytics",
      description:
        "Natural-language income and expense logging directly to Google Sheets with automated category classification, backdated transaction preservation, and period summaries.",
      examples: [
        "spent $6.20 for lunch",
        "earned $120 from freelance design",
        "how much did I spend this month?",
        "delete my coffee expense",
      ],
      badge: "Google Sheets",
      badgeColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    },
    {
      icon: "📅",
      title: "Calendar & Agenda Management",
      description:
        "Dual-calendar routing (Personal & Work), timed and all-day event scheduling with confirmation safeguards, upcoming agenda lookups, and keyword event deletion.",
      examples: [
        "schedule floorball tomorrow from 8 pm to 9:30 pm",
        "add gym tomorrow",
        "what's on my calendar today?",
        "delete gym tomorrow from personal",
      ],
      badge: "Google Calendar",
      badgeColor: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    },
    {
      icon: "🎙️",
      title: "Voice Notes & Spoken Memos",
      description:
        "Speak naturally on Telegram while on the move. Spoken audio is transcribed with Google Gemini multimodal intelligence and seamlessly routed to finance or calendar pipelines.",
      examples: [
        "🎤 \"Spent $14 on dinner at Hawker Centre\"",
        "🎤 \"Schedule project sync tomorrow 3 to 4 pm\"",
        "🎤 \"What do I have today?\"",
      ],
      badge: "Gemini 3.6 Flash",
      badgeColor: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    },
    {
      icon: "📸",
      title: "Vision & Receipt Scanning",
      description:
        "Send photos of receipts, meal bills, timetable screenshots, or event flyers. Automatically extracts items, totals, dates, or multiple schedule events with batch review.",
      examples: [
        "[Receipt Photo] Log this receipt as an expense",
        "[Calendar Screenshot] Add these dates to my personal calendar",
      ],
      badge: "Multimodal Vision",
      badgeColor: "border-purple-500/30 bg-purple-500/10 text-purple-400",
    },
  ];

  const commands = [
    {
      cmd: "/agenda",
      desc: "View today's schedule across all connected calendars",
    },
    {
      cmd: "/calendar list",
      desc: "List upcoming events for the next 7 days",
    },
    {
      cmd: "/finance summary",
      desc: "View monthly spending breakdown by category with percentages",
    },
    {
      cmd: "/finance list",
      desc: "View recent active finance transactions",
    },
    {
      cmd: "/setcommands",
      desc: "Sync interactive quick-access command menu to Telegram",
    },
    {
      cmd: "/help",
      desc: "Display assistant capabilities and usage examples",
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Background radial glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-emerald-500/10 blur-[130px] rounded-full" />
        <div className="absolute top-1/3 -left-40 w-[600px] h-[400px] bg-blue-500/10 blur-[140px] rounded-full" />
        <div className="absolute bottom-10 right-0 w-[500px] h-[500px] bg-purple-500/10 blur-[140px] rounded-full" />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 py-16 sm:py-24">
        {/* Top bar status */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-12 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-xl shadow-lg shadow-emerald-500/20">
              ⚡
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-zinc-100">
                TELEGRAM ASSISTANT
              </div>
              <div className="text-xs text-zinc-400">Autonomous Serverless Hub</div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs font-mono text-zinc-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Webhook Operational & Ready
          </div>
        </header>

        {/* Hero */}
        <div className="py-16 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
            Private Personal Assistant • Multi-Engine AI
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white max-w-3xl leading-[1.15]">
            Smarter Finance, Calendar & Voice on Telegram.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-zinc-400 max-w-2xl leading-relaxed">
            Manage your daily schedule, track expenses in Google Sheets, process receipts,
            and send hands-free voice notes with dual-calendar routing and strict confirmation safeguards.
          </p>
        </div>

        {/* Capabilities Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-12">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="group p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-xl hover:border-zinc-700/80 transition-all duration-300 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="text-3xl p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50 w-fit">
                  {cap.icon}
                </div>
                <span
                  className={`text-[11px] font-mono px-2.5 py-1 rounded-full border ${cap.badgeColor}`}
                >
                  {cap.badge}
                </span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2 group-hover:text-emerald-400 transition-colors">
                {cap.title}
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                {cap.description}
              </p>

              <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/60 p-4 font-mono text-xs text-zinc-300 space-y-1.5">
                <div className="text-[10px] uppercase text-zinc-500 font-sans font-semibold tracking-wider mb-2">
                  Sample Interactions
                </div>
                {cap.examples.map((ex) => (
                  <div key={ex} className="flex items-center gap-2">
                    <span className="text-emerald-500">›</span>
                    <span className="truncate">{ex}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Slash Commands Table */}
        <div className="my-16 p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Bot Command Reference</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Quick commands registered in the Telegram interactive menu
              </p>
            </div>
            <div className="text-xs font-mono text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 w-fit">
              Run /setcommands to sync
            </div>
          </div>

          <div className="divide-y divide-zinc-800/60 font-mono text-sm">
            {commands.map((c) => (
              <div
                key={c.cmd}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <code className="text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 w-fit">
                  {c.cmd}
                </code>
                <span className="text-zinc-300 font-sans text-sm">{c.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Security Architecture */}
        <div className="p-8 rounded-2xl bg-gradient-to-br from-zinc-900/80 to-zinc-900/30 border border-zinc-800">
          <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <span>🛡️</span> Zero-Trust Security & Integrity
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed max-w-3xl">
            Incoming Telegram updates require valid webhook secret tokens and user ID authorization.
            Updates are logged idempotently to prevent duplicate processing. All Google Calendar event additions
            and finance soft-deletions require interactive, two-step confirmation callbacks that automatically expire after 5 minutes.
          </p>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-zinc-900 text-center sm:text-left text-xs text-zinc-500 flex flex-col sm:flex-row justify-between gap-4">
          <div>Built with Next.js, Vercel AI SDK, Google Gemini & Sheets/Calendar APIs</div>
          <div>Private Telegram Personal Assistant</div>
        </footer>
      </div>
    </div>
  );
}
