import { getUpcomingSchedule } from "./calendar";
import { sendTelegramMessage } from "./telegram";

const sentLeaveNowEventIds = new Set<string>();

export function markLeaveNowNoticeSent(eventId: string): void {
  sentLeaveNowEventIds.add(eventId);
}

export function hasLeaveNowNoticeBeenSent(eventId: string): boolean {
  return sentLeaveNowEventIds.has(eventId);
}

export interface TravelEstimate {
  location: string;
  travelMinutes: number;
  bufferMinutes: number;
  totalLeadMinutes: number;
  transitMode: "transit" | "cab" | "walk";
}

export interface LeaveNowNotice {
  eventId: string;
  title: string;
  location: string;
  calendarName: "personal" | "work";
  eventStartTime: string;
  estimatedTravelMinutes: number;
  recommendedDepartureTime: string;
  minutesUntilDeparture: number;
  message: string;
}

/**
 * Estimates travel time within Singapore based on destination keywords and heuristics.
 */
export function estimateSingaporeTravelTime(location: string): TravelEstimate {
  const clean = location.toLowerCase().trim();
  const bufferMinutes = 10; // 10 min parking / walking buffer

  let travelMinutes = 30; // default Singapore transit duration
  let transitMode: "transit" | "cab" | "walk" = "transit";

  if (
    clean.includes("online") ||
    clean.includes("zoom") ||
    clean.includes("meet") ||
    clean.includes("teams") ||
    clean.includes("call") ||
    clean.includes("http")
  ) {
    return {
      location,
      travelMinutes: 0,
      bufferMinutes: 2,
      totalLeadMinutes: 2,
      transitMode: "walk",
    };
  }

  if (clean.includes("airport") || clean.includes("changi") || clean.includes("jewel")) {
    travelMinutes = 45;
  } else if (
    clean.includes("nus") ||
    clean.includes("ntu") ||
    clean.includes("jurong") ||
    clean.includes("woodlands") ||
    clean.includes("tuas")
  ) {
    travelMinutes = 40;
  } else if (
    clean.includes("raffles") ||
    clean.includes("marina") ||
    clean.includes("mbs") ||
    clean.includes("tanjong pagar") ||
    clean.includes("shenton") ||
    clean.includes("cbd")
  ) {
    travelMinutes = 25;
  } else if (
    clean.includes("orchard") ||
    clean.includes("somerset") ||
    clean.includes("dhoby") ||
    clean.includes("bugis")
  ) {
    travelMinutes = 20;
  } else if (clean.includes("nearby") || clean.includes("walk") || clean.includes("block")) {
    travelMinutes = 10;
    transitMode = "walk";
  }

  return {
    location,
    travelMinutes,
    bufferMinutes,
    totalLeadMinutes: travelMinutes + bufferMinutes,
    transitMode,
  };
}

/**
 * Checks upcoming schedule for events requiring immediate departure notices.
 */
export async function getUpcomingLeaveNowNotices(
  now = new Date()
): Promise<LeaveNowNotice[]> {
  const nowMs = now.getTime();
  const lookaheadMs = 3 * 60 * 60 * 1000; // look ahead 3 hours
  const timeMin = now.toISOString();
  const timeMax = new Date(nowMs + lookaheadMs).toISOString();

  const events = await getUpcomingSchedule({
    timeMin,
    timeMax,
    calendarName: "all",
    maxResults: 20,
  });

  const notices: LeaveNowNotice[] = [];

  for (const event of events) {
    if (
      event.isAllDay ||
      !event.location ||
      hasLeaveNowNoticeBeenSent(event.eventId)
    ) {
      continue;
    }

    const eventStartMs = new Date(event.start).getTime();
    if (isNaN(eventStartMs)) continue;

    const estimate = estimateSingaporeTravelTime(event.location);
    if (estimate.travelMinutes === 0) {
      continue; // virtual meeting
    }

    const departureMs = eventStartMs - estimate.totalLeadMinutes * 60 * 1000;
    const minutesUntilDeparture = Math.round((departureMs - nowMs) / (60 * 1000));

    // Alert if departure is within next 15 minutes, or up to 5 minutes past ideal departure
    if (minutesUntilDeparture <= 15 && minutesUntilDeparture >= -5) {
      const depDate = new Date(departureMs);
      const depTimeStr = new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(depDate);

      const eventTimeStr = new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(eventStartMs));

      let urgency = "⏰ *Time to Leave Soon!*";
      if (minutesUntilDeparture <= 0) {
        urgency = "🚨 *LEAVE NOW!*";
      } else if (minutesUntilDeparture <= 5) {
        urgency = "⚠️ *Depart in 5 minutes!*";
      }

      const message = [
        urgency,
        "",
        `📍 *Event*: ${event.title}`,
        `🏢 *Location*: ${event.location}`,
        `🕒 *Starts at*: ${eventTimeStr}`,
        `🚗 *Estimated Transit*: ~${estimate.travelMinutes} mins (+${estimate.bufferMinutes}m buffer)`,
        `🚶‍♂️ *Leave by*: *${depTimeStr}* (${
          minutesUntilDeparture <= 0
            ? "You should be leaving now"
            : `in ${minutesUntilDeparture} min${minutesUntilDeparture === 1 ? "" : "s"}`
        })`,
      ].join("\n");

      notices.push({
        eventId: event.eventId,
        title: event.title,
        location: event.location,
        calendarName: event.calendarName,
        eventStartTime: event.start,
        estimatedTravelMinutes: estimate.travelMinutes,
        recommendedDepartureTime: depTimeStr,
        minutesUntilDeparture,
        message,
      });
    }
  }

  return notices;
}

export async function checkAndSendLeaveNowAlerts(
  targetChatId?: number
): Promise<number> {
  const allowedUserId =
    targetChatId || Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!allowedUserId) return 0;

  const notices = await getUpcomingLeaveNowNotices();
  let sentCount = 0;

  for (const notice of notices) {
    await sendTelegramMessage(allowedUserId, notice.message);
    markLeaveNowNoticeSent(notice.eventId);
    sentCount++;
  }

  return sentCount;
}
