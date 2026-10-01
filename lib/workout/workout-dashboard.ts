import { getSheetsClient } from "../google";
import { ensureWorkoutsSheetExists } from "./workout-service";

const ANALYTICS_SHEET_TITLE = "📈 Workout Analytics";
const WORKOUTS_SHEET_TITLE = "Workouts";

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

export async function setupWorkoutDashboardSheet(): Promise<{ success: boolean; message: string }> {
  await ensureWorkoutsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList = meta.data.sheets ?? [];

  let workoutsSheetId: number | undefined;
  let analyticsSheetId: number | undefined;

  for (const s of sheetList) {
    if (s.properties?.title === WORKOUTS_SHEET_TITLE) {
      workoutsSheetId = s.properties.sheetId ?? undefined;
    }
    if (s.properties?.title === ANALYTICS_SHEET_TITLE) {
      analyticsSheetId = s.properties.sheetId ?? undefined;
    }
  }

  // 1. Style Workouts sheet if not already styled
  if (workoutsSheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Header formatting: Dark emerald background, white text, bold, frozen row 1
          {
            repeatCell: {
              range: {
                sheetId: workoutsSheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 13,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.08, green: 0.45, blue: 0.28 }, // Forest Emerald
                  textFormat: {
                    bold: true,
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    fontSize: 10,
                  },
                  horizontalAlignment: "CENTER",
                  verticalAlignment: "MIDDLE",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
            },
          },
          // Column width adjustments
          {
            updateDimensionProperties: {
              range: {
                sheetId: workoutsSheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: 1,
              },
              properties: { pixelSize: 130 }, // Session ID
              fields: "pixelSize",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: workoutsSheetId,
                dimension: "COLUMNS",
                startIndex: 1,
                endIndex: 3,
              },
              properties: { pixelSize: 95 }, // Date, Week
              fields: "pixelSize",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: workoutsSheetId,
                dimension: "COLUMNS",
                startIndex: 3,
                endIndex: 5,
              },
              properties: { pixelSize: 90 }, // Location, Routine
              fields: "pixelSize",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: workoutsSheetId,
                dimension: "COLUMNS",
                startIndex: 5,
                endIndex: 6,
              },
              properties: { pixelSize: 170 }, // Exercise
              fields: "pixelSize",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: workoutsSheetId,
                dimension: "COLUMNS",
                startIndex: 6,
                endIndex: 13,
              },
              properties: { pixelSize: 85 }, // Set, Weight, Reps, Drop, Notes, 1RM, Vol
              fields: "pixelSize",
            },
          },
        ],
      },
    });
  }

  // 2. Create Analytics Dashboard sheet if not present
  if (analyticsSheetId === undefined) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: ANALYTICS_SHEET_TITLE,
                tabColor: { red: 0.1, green: 0.5, blue: 0.8 },
                gridProperties: {
                  rowCount: 50,
                  columnCount: 12,
                  hideGridlines: false,
                },
              },
            },
          },
        ],
      },
    });
    analyticsSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
  }

  if (analyticsSheetId !== undefined) {
    // Populate KPI formulas and visual sections
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${ANALYTICS_SHEET_TITLE}!A1:H15`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          ["🏋️ PROGRESSIVE OVERLOAD & WORKOUT TRACKER", "", "", "", "", "", "", ""],
          ["", "", "", "", "", "", "", ""],
          ["METRIC", "VALUE", "", "CORE LIFT", "BEST WEIGHT (KG)", "EST. 1RM", "LOCATION", ""],
          [
            "Total Recorded Sets",
            '=COUNTA(Workouts!A2:A)',
            "",
            "Incline Smith Press",
            '=IFERROR(MAXIFS(Workouts!H:H, Workouts!F:F, "*Incline Smith*"), "-")',
            '=IFERROR(MAXIFS(Workouts!L:L, Workouts!F:F, "*Incline Smith*"), "-")',
            "School",
            "",
          ],
          [
            "All-Time Volume Tonnage",
            '=IFERROR(SUM(Workouts!M2:M), 0)',
            "",
            "Barbell Bench Press",
            '=IFERROR(MAXIFS(Workouts!H:H, Workouts!F:F, "*Bench Press*"), "-")',
            '=IFERROR(MAXIFS(Workouts!L:L, Workouts!F:F, "*Bench Press*"), "-")',
            "CSC",
            "",
          ],
          [
            "Latest Active Week",
            '=IFERROR(MAX(Workouts!C2:C), 1)',
            "",
            "T-Bar Row",
            '=IFERROR(MAXIFS(Workouts!H:H, Workouts!F:F, "*T-Bar*"), "-")',
            '=IFERROR(MAXIFS(Workouts!L:L, Workouts!F:F, "*T-Bar*"), "-")',
            "Both",
            "",
          ],
          [
            "Unique Workout Days",
            '=IFERROR(COUNTA(UNIQUE(Workouts!B2:B)), 0)',
            "",
            "Pec Dec Fly",
            '=IFERROR(MAXIFS(Workouts!H:H, Workouts!F:F, "*Pec Dec*"), "-")',
            '=IFERROR(MAXIFS(Workouts!L:L, Workouts!F:F, "*Pec Dec*"), "-")',
            "Both",
            "",
          ],
          ["", "", "", "Pull-ups", 'Max Reps: =IFERROR(MAXIFS(Workouts!I:I, Workouts!F:F, "*Pull*"), "-")', "-", "CSC", ""],
          ["", "", "", "", "", "", "", ""],
          ["PROGRESSIVE OVERLOAD RECENT SESSION BREAKDOWN", "", "", "", "", "", "", ""],
          ["Date", "Location", "Exercise", "Set", "Weight (kg)", "Reps", "Est. 1RM (kg)", "Volume (kg)"],
          [
            '=IFERROR(INDEX(Workouts!B2:B, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!D2:D, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!F2:F, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!G2:G, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!H2:H, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!I2:I, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!L2:L, COUNTA(Workouts!A2:A)), "-")',
            '=IFERROR(INDEX(Workouts!M2:M, COUNTA(Workouts!A2:A)), "-")',
          ],
        ],
      },
    });

    // Formatting analytics cells
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Title banner
          {
            repeatCell: {
              range: {
                sheetId: analyticsSheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 8,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.12, green: 0.22, blue: 0.35 },
                  textFormat: {
                    bold: true,
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    fontSize: 13,
                  },
                  verticalAlignment: "MIDDLE",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
            },
          },
          // Table headers
          {
            repeatCell: {
              range: {
                sheetId: analyticsSheetId,
                startRowIndex: 2,
                endRowIndex: 3,
                startColumnIndex: 0,
                endColumnIndex: 7,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.9, green: 0.93, blue: 0.96 },
                  textFormat: { bold: true, fontSize: 10 },
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat)",
            },
          },
        ],
      },
    });
  }

  return { success: true, message: "Workout sheets and analytics configured successfully." };
}
