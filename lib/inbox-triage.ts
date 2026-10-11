import { getGmailClient } from "./google";

export interface TriagedEmail {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  snippet: string;
  date: string;
  isUrgent: boolean;
  suggestedAction?: string;
}

export interface InboxTriageSummary {
  totalUnread: number;
  actionableCount: number;
  emails: TriagedEmail[];
  formattedSummary: string;
}

const AUTOMATED_SENDER_PATTERNS = [
  /no-?reply/i,
  /notification/i,
  /receipt/i,
  /alert@/i,
  /mailer-daemon/i,
  /marketing/i,
  /promotions/i,
  /billing@/i,
  /paylah/i,
  /dbs\.com/i,
  /grab\.com/i,
  /apple\.com/i,
  /linkedin\.com/i,
  /uber\.com/i,
  /shopee/i,
  /lazada/i,
];

const AUTOMATED_SUBJECT_PATTERNS = [
  /your transaction/i,
  /e-receipt/i,
  /payment receipt/i,
  /otp/i,
  /verification code/i,
  /security alert/i,
  /your order/i,
  /statement of account/i,
  /weekly digest/i,
  /newsletter/i,
];

function isAutomatedEmail(from: string, subject: string): boolean {
  if (AUTOMATED_SENDER_PATTERNS.some((pat) => pat.test(from))) {
    return true;
  }
  if (AUTOMATED_SUBJECT_PATTERNS.some((pat) => pat.test(subject))) {
    return true;
  }
  return false;
}

function parseSender(fromHeader: string): { email: string; name: string } {
  const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    const rawName = match[1].replace(/^["']|["']$/g, "").trim();
    return {
      name: rawName || match[2],
      email: match[2].trim(),
    };
  }
  return {
    name: fromHeader.trim(),
    email: fromHeader.trim(),
  };
}

/**
 * Scans unread inbox emails, filters out automated transactions, and ranks actionable threads.
 */
export async function triageUnreadInbox(maxEmails = 5): Promise<InboxTriageSummary> {
  const gmail = getGmailClient();

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults: 20,
  });

  const messageList = listRes.data.messages || [];
  const totalUnread = listRes.data.resultSizeEstimate ?? messageList.length;

  if (messageList.length === 0) {
    return {
      totalUnread: 0,
      actionableCount: 0,
      emails: [],
      formattedSummary: "📬 *Inbox Triage*\n\nInbox Zero! You have no unread emails.",
    };
  }

  const triaged: TriagedEmail[] = [];

  for (const item of messageList) {
    if (!item.id) continue;
    if (triaged.length >= maxEmails) break;

    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: item.id,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = msg.data.payload?.headers || [];
      const fromHeader = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "Unknown";
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "(No Subject)";
      const dateHeader = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";

      if (isAutomatedEmail(fromHeader, subject)) {
        continue;
      }

      const sender = parseSender(fromHeader);
      const snippet = msg.data.snippet || "";
      const isUrgent =
        /urgent|asap|important|action required|deadline/i.test(subject) ||
        /urgent|asap|by today|by tomorrow/i.test(snippet);

      let suggestedAction = "Reply";
      if (/invitation|join|calendar/i.test(subject)) {
        suggestedAction = "RSVP / Review";
      } else if (/review|feedback|approve/i.test(subject)) {
        suggestedAction = "Review & Approve";
      }

      triaged.push({
        id: item.id,
        threadId: item.threadId || item.id,
        from: sender.email,
        fromName: sender.name,
        subject,
        snippet,
        date: dateHeader,
        isUrgent,
        suggestedAction,
      });
    } catch (err) {
      console.error(`Error fetching metadata for email ${item.id}:`, err);
    }
  }

  const formattedSummary = formatInboxTriageMessage({
    totalUnread,
    actionableCount: triaged.length,
    emails: triaged,
  });

  return {
    totalUnread,
    actionableCount: triaged.length,
    emails: triaged,
    formattedSummary,
  };
}

export function formatInboxTriageMessage(summary: {
  totalUnread: number;
  actionableCount: number;
  emails: TriagedEmail[];
}): string {
  if (summary.emails.length === 0) {
    return `📬 *Inbox Triage*\n\nInbox Zero! You have no actionable unread emails (${summary.totalUnread} total unread notifications).`;
  }

  const lines = [
    `📬 *Inbox Triage* (${summary.actionableCount} actionable of ${summary.totalUnread} unread):`,
    "",
  ];

  summary.emails.forEach((email, index) => {
    const urgentBadge = email.isUrgent ? "🚨 " : "✉️ ";
    lines.push(
      `${urgentBadge}*${index + 1}. ${email.fromName}*`,
      `📌 *Subject*: ${email.subject}`,
      email.snippet ? `💬 _"${email.snippet.slice(0, 100)}${email.snippet.length > 100 ? "..." : ""}"_` : "",
      email.suggestedAction ? `💡 Action: ${email.suggestedAction}` : "",
      ""
    );
  });

  return lines.filter(Boolean).join("\n");
}
