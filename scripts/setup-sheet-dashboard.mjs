import { google } from "googleapis";

function cleanPrivateKey(rawKey) {
  if (!rawKey) return undefined;
  let key = rawKey.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n").trim();
}

async function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !key || !spreadsheetId) {
    throw new Error("Missing Google Sheets credentials in environment.");
  }

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

export async function setupDashboardSheet() {
  const { sheets, spreadsheetId } = await getSheets();

  // 1. Get spreadsheet metadata
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetList = meta.data.sheets ?? [];
  const existingTitles = sheetList.map((s) => s.properties?.title?.trim() ?? "");

  console.log("Current sheets:", existingTitles);

  // Find all month transaction sheets
  const monthSheets = existingTitles.filter((title) =>
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}$/i.test(title)
  );
  if (!monthSheets.includes("Oct 2026")) {
    monthSheets.push("Oct 2026");
  }

  const DASHBOARD_TITLE = "📊 Dashboard";
  let dashboardSheetId;
  const existingDashboard = sheetList.find(
    (s) => s.properties?.title === DASHBOARD_TITLE || s.properties?.title === "Dashboard"
  );

  if (existingDashboard) {
    dashboardSheetId = existingDashboard.properties.sheetId;
    console.log(`Found existing dashboard sheet (ID: ${dashboardSheetId}). Updating...`);
    // Rename to standard title if needed and ensure index 0
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: dashboardSheetId,
                title: DASHBOARD_TITLE,
                index: 0,
                gridProperties: {
                  rowCount: 45,
                  columnCount: 14,
                  hideGridlines: false,
                },
                tabColor: { red: 0.31, green: 0.27, blue: 0.90 }, // Indigo
              },
              fields: "title,index,gridProperties(rowCount,columnCount,hideGridlines),tabColor",
            },
          },
        ],
      },
    });
  } else {
    console.log("Creating new dashboard sheet at Index 0...");
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: DASHBOARD_TITLE,
                index: 0,
                gridProperties: {
                  rowCount: 45,
                  columnCount: 14,
                  hideGridlines: false,
                },
                tabColor: { red: 0.31, green: 0.27, blue: 0.90 }, // Indigo
              },
            },
          },
        ],
      },
    });
    dashboardSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  }

  // 2. Set Column Widths and Row Heights
  console.log("Configuring layout dimensions...");
  const colWidths = [
    { index: 0, width: 24 },   // A: Margin
    { index: 1, width: 140 },  // B: Label / Category
    { index: 2, width: 130 },  // C: Value / Amount
    { index: 3, width: 105 },  // D: Metric / % Share
    { index: 4, width: 85 },   // E: Count
    { index: 5, width: 140 },  // F: Sparkline
    { index: 6, width: 25 },   // G: Spacer
    { index: 7, width: 95 },   // H: Chart / Table Col 1
    { index: 8, width: 110 },  // I: Col 2
    { index: 9, width: 120 },  // J: Col 3
    { index: 10, width: 130 }, // K: Col 4
    { index: 11, width: 155 }, // L: Col 5 / Month Dropdown
    { index: 12, width: 25 },  // M: Margin
  ];

  const dimensionRequests = colWidths.map(({ index, width }) => ({
    updateDimensionProperties: {
      range: {
        sheetId: dashboardSheetId,
        dimension: "COLUMNS",
        startIndex: index,
        endIndex: index + 1,
      },
      properties: { pixelSize: width },
      fields: "pixelSize",
    },
  }));

  // Row heights
  const rowHeights = [
    { index: 0, height: 16 },  // Row 1: Spacer
    { index: 1, height: 42 },  // Row 2: Banner Top
    { index: 2, height: 26 },  // Row 3: Banner Subtitle
    { index: 3, height: 16 },  // Row 4: Spacer
    { index: 4, height: 24 },  // Row 5: KPI Title
    { index: 5, height: 38 },  // Row 6: KPI Big Metric
    { index: 6, height: 26 },  // Row 7: KPI Subtitle / Sparkline
    { index: 7, height: 18 },  // Row 8: Spacer
    { index: 8, height: 30 },  // Row 9: Section Header
    { index: 9, height: 10 },  // Row 10: Spacer
    { index: 10, height: 30 }, // Row 11: Table Header
  ];

  for (const { index, height } of rowHeights) {
    dimensionRequests.push({
      updateDimensionProperties: {
        range: {
          sheetId: dashboardSheetId,
          dimension: "ROWS",
          startIndex: index,
          endIndex: index + 1,
        },
        properties: { pixelSize: height },
        fields: "pixelSize",
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: dimensionRequests },
  });

  // 3. Clear existing values and write clean formulas
  console.log("Populating values, formulas, and labels...");
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'📊 Dashboard'!A1:N45",
  });
  const defaultMonth = existingTitles.includes("Sep 2026") ? "Sep 2026" : monthSheets[0] || "Sep 2026";

  const valuesPayload = [
    // Row 1 (Empty spacer)
    [""],
    // Row 2: Header Banner
    [
      "",
      "📊 PERSONAL FINANCE INTELLIGENCE",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "ACTIVE MONTH:",
      "",
      defaultMonth,
      '=IF(ISNUMBER($L$2), TEXT($L$2, "mmm yyyy"), TO_TEXT($L$2))',
    ],
    // Row 3: Header Subtitle
    [
      "",
      "Evan's Expenditure • Live Automated Sync • Singapore (SGD)",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Select month to filter",
    ],
    // Row 4: Spacer
    [""],
    // Row 5: KPI Titles
    [
      "",
      "TOTAL EXPENDITURE",
      "",
      "MONTHLY BUDGET",
      "",
      "REMAINING TO SPEND",
      "",
      "BUDGET UTILIZATION",
      "",
      "DAILY AVERAGE SPEND",
    ],
    // Row 6: KPI Values
    [
      "",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      "",
      '=IF(DATEVALUE("1 "&$M$2) >= DATEVALUE("1 Oct 2026"), 500, "Uncapped")',
      "",
      '=IF(ISNUMBER(D6), D6 - B6, "—")',
      "",
      '=IF(AND(ISNUMBER(D6), D6>0), B6/D6, "—")',
      "",
      '=IF(B6>0, B6/MAX(1, IF($M$2=TEXT(TODAY(), "mmm yyyy"), DAY(TODAY()), DAY(EOMONTH(DATEVALUE("1 "&$M$2), 0)))), 0)',
    ],
    // Row 7: KPI Subtitles / Progress
    [
      "",
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted") & " transactions logged", "0 transactions")',
      "",
      '=IF(ISNUMBER(D6), "Target Cap ($500.00 / mo)", "Budget starts Oct 2026 ($500/mo)")',
      "",
      '=IF(ISNUMBER(D6), IF(F6<0, "🚨 Exceeded by " & TEXT(ABS(F6), "$#,##0.00"), "✅ " & TEXT(F6, "$#,##0.00") & " left to spend"), "No budget cap set for this period")',
      "",
      '=IF(AND(ISNUMBER(D6), D6>0), SPARKLINE(MIN(B6, D6), {"charttype", "bar"; "max", D6; "color1", IF(B6>D6, "#DC2626", IF(B6>0.85*D6, "#F59E0B", "#10B981"))}), "")',
      "",
      '="Pacing: " & TEXT(J6 * DAY(EOMONTH(DATEVALUE("1 "&$M$2), 0)), "$#,##0") & " at month end"',
    ],
    // Row 8: Spacer
    [""],
    // Row 9: Section Headers
    [
      "",
      "CATEGORY SPENDING BREAKDOWN",
      "",
      "",
      "",
      "",
      "",
      "EXPENSE DISTRIBUTION & CHARTS",
    ],
    // Row 10: Spacer
    [""],
    // Row 11: Table Headers
    [
      "",
      "Category",
      "Total Spent",
      "% Share",
      "Txns",
      "Distribution",
    ],
    // Rows 12-19: Category rows
    [
      "",
      "Dining",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B12, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C12/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B12, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C12>0, SPARKLINE(C12, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#4F46E5"}), "")',
    ],
    [
      "",
      "Groceries",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B13, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C13/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B13, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C13>0, SPARKLINE(C13, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#06B6D4"}), "")',
    ],
    [
      "",
      "Shopping",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B14, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C14/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B14, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C14>0, SPARKLINE(C14, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#EC4899"}), "")',
    ],
    [
      "",
      "Transport",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B15, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C15/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B15, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C15>0, SPARKLINE(C15, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#F59E0B"}), "")',
    ],
    [
      "",
      "Utilities",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B16, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C16/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B16, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C16>0, SPARKLINE(C16, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#10B981"}), "")',
    ],
    [
      "",
      "Entertainment",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B17, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C17/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B17, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C17>0, SPARKLINE(C17, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#8B5CF6"}), "")',
    ],
    [
      "",
      "General",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B18, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C18/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B18, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C18>0, SPARKLINE(C18, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#3B82F6"}), "")',
    ],
    [
      "",
      "Other",
      '=IFERROR(SUMIFS(INDIRECT("\'"&$M$2&"\'!D2:D"), INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B19, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF($B$6>0, C19/$B$6, 0)',
      '=IFERROR(COUNTIFS(INDIRECT("\'"&$M$2&"\'!C2:C"), "expense", INDIRECT("\'"&$M$2&"\'!F2:F"), B19, INDIRECT("\'"&$M$2&"\'!H2:H"), "<>deleted"), 0)',
      '=IF(C19>0, SPARKLINE(C19, {"charttype", "bar"; "max", MAX($C$12:$C$19); "color1", "#64748B"}), "")',
    ],
    // Row 20: Spacer
    [""],
    // Row 21: Table Total
    [
      "",
      "Total Active Expenses",
      "=SUM(C12:C19)",
      "=SUM(D12:D19)",
      "=SUM(E12:E19)",
      "",
    ],
    // Row 22: Spacer
    [""],
    // Row 23: Section Header Top 5
    [
      "",
      "TOP 5 LARGEST EXPENSES THIS MONTH",
    ],
    // Row 24: Table Header Top 5
    [
      "",
      "Rank",
      "Date & Time",
      "Category",
      "Description / Merchant",
      "Amount",
    ],
    // Rows 25-29: Dynamic Top 5 formula
    [
      "",
      "1",
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 1, 1), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 1, 2), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 1, 3), "No expenses")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 1, 4), 0)',
    ],
    [
      "",
      "2",
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 2, 1), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 2, 2), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 2, 3), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 2, 4), 0)',
    ],
    [
      "",
      "3",
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 3, 1), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 3, 2), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 3, 3), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 3, 4), 0)',
    ],
    [
      "",
      "4",
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 4, 1), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 4, 2), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 4, 3), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 4, 4), 0)',
    ],
    [
      "",
      "5",
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 5, 1), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 5, 2), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 5, 3), "-")',
      '=IFERROR(INDEX(SORTN(FILTER({INDIRECT("\'"&$M$2&"\'!B2:B"), INDIRECT("\'"&$M$2&"\'!F2:F"), INDIRECT("\'"&$M$2&"\'!G2:G"), INDIRECT("\'"&$M$2&"\'!D2:D")}, INDIRECT("\'"&$M$2&"\'!C2:C")="expense", INDIRECT("\'"&$M$2&"\'!H2:H")<>"deleted"), 5, 0, 4, FALSE), 5, 4), 0)',
    ],
    // Row 30: Spacer
    [""],
    // Row 31: Section Header Multi-Month
    [
      "",
      "MONTHLY BUDGET TRACKING & HISTORY",
    ],
    // Row 32: Table Header
    [
      "",
      "Month",
      "Monthly Budget",
      "Actual Spent",
      "Remaining / Variance",
      "Status",
    ],
    // Rows 33-34: Multi-Month Rows
    [
      "",
      "Sep 2026",
      "Uncapped",
      '=IFERROR(SUMIFS(\'Sep 2026\'!D2:D, \'Sep 2026\'!C2:C, "expense", \'Sep 2026\'!H2:H, "<>deleted"), 0)',
      "—",
      "📊 Baseline (No Cap)",
    ],
    [
      "",
      "Oct 2026",
      500,
      '=IFERROR(SUMIFS(\'Oct 2026\'!D2:D, \'Oct 2026\'!C2:C, "expense", \'Oct 2026\'!H2:H, "<>deleted"), 0)',
      '=IF(ISNUMBER(C34), C34 - D34, "—")',
      '=IF(D34=0, "🎯 Starts Next Month ($500 Cap)", IF(E34>=0, "✅ On Track", "🚨 Budget Exceeded"))',
    ],
    // Row 35: Empty spacer
    [""],
    // Row 36: Spacer
    [""],
    // Row 37: Footer
    [
      "",
      "⚡ Powered by Evan's Telegram Assistant • Live Sync with Apple Pay, PayLah, & DBS • Auto-categorized via Gemini AI",
    ],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DASHBOARD_TITLE}'!A1:M${valuesPayload.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: valuesPayload,
    },
  });

  // 4. Formatting, Colors, Merges, Data Validation
  console.log("Applying UI/UX executive styling and formatting...");
  const stylingRequests = [];

  // Month Dropdown Data Validation on L2
  stylingRequests.push({
    setDataValidation: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 11,
        endColumnIndex: 12,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: monthSheets.map((m) => ({ userEnteredValue: m })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  });

  // Cell Merges
  const merges = [
    // Banner Title (B2:I2)
    { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
    // Banner Subtitle (B3:I3)
    { startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 },
    // Month Label (J2:K2)
    { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 9, endColumnIndex: 11 },
    // KPI Card 1 (B:C)
    { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 },
    { startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 },
    { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
    // KPI Card 2 (D:E)
    { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 5 },
    { startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 5 },
    { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 },
    // KPI Card 3 (F:G)
    { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 5, endColumnIndex: 7 },
    { startRowIndex: 5, endRowIndex: 6, startColumnIndex: 5, endColumnIndex: 7 },
    { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 5, endColumnIndex: 7 },
    // KPI Card 4 (H:I)
    { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 },
    { startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 9 },
    { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 },
    // KPI Card 5 (J:L)
    { startRowIndex: 4, endRowIndex: 5, startColumnIndex: 9, endColumnIndex: 12 },
    { startRowIndex: 5, endRowIndex: 6, startColumnIndex: 9, endColumnIndex: 12 },
    { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 9, endColumnIndex: 12 },
    // Section Header 1 (B9:F9)
    { startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 6 },
    // Section Header 2 (H9:L9)
    { startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 12 },
    // Top 5 Section Header (B23:F23)
    { startRowIndex: 22, endRowIndex: 23, startColumnIndex: 1, endColumnIndex: 6 },
    // Budget History Section Header (B31:F31)
    { startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 6 },
    // Footer (B37:L37)
    { startRowIndex: 36, endRowIndex: 37, startColumnIndex: 1, endColumnIndex: 12 },
  ];

  for (const m of merges) {
    stylingRequests.push({
      mergeCells: {
        range: { sheetId: dashboardSheetId, ...m },
        mergeType: "MERGE_ALL",
      },
    });
  }

  // --- Background Colors & Borders ---
  // Banner Background (Slate #0F172A): B2:L3
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 1,
        endRowIndex: 3,
        startColumnIndex: 1,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.06, green: 0.09, blue: 0.16 }, // #0F172A
          padding: { top: 6, right: 12, bottom: 6, left: 12 },
        },
      },
      fields: "userEnteredFormat(backgroundColor,padding)",
    },
  });

  // Banner Title Text (B2)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 1,
        endColumnIndex: 9,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 14,
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
    },
  });

  // Banner Subtitle Text (B3)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 2,
        endRowIndex: 3,
        startColumnIndex: 1,
        endColumnIndex: 9,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 9,
            foregroundColor: { red: 0.58, green: 0.64, blue: 0.72 }, // Slate-400
          },
          verticalAlignment: "TOP",
        },
      },
      fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
    },
  });

  // Month Selector Label (J2:K2)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 9,
        endColumnIndex: 11,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 9,
            bold: true,
            foregroundColor: { red: 0.82, green: 0.86, blue: 0.92 },
          },
          horizontalAlignment: "RIGHT",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
    },
  });

  // Month Dropdown Cell (L2)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 11,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.19, green: 0.24, blue: 0.36 }, // Slate-700
          textFormat: {
            fontSize: 11,
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          borders: {
            top: { style: "SOLID", color: { red: 0.3, green: 0.4, blue: 0.6 } },
            bottom: { style: "SOLID", color: { red: 0.3, green: 0.4, blue: 0.6 } },
            left: { style: "SOLID", color: { red: 0.3, green: 0.4, blue: 0.6 } },
            right: { style: "SOLID", color: { red: 0.3, green: 0.4, blue: 0.6 } },
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)",
    },
  });

  // Month helper text (L3)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 2,
        endRowIndex: 3,
        startColumnIndex: 11,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 8,
            italic: true,
            foregroundColor: { red: 0.58, green: 0.64, blue: 0.72 },
          },
          horizontalAlignment: "CENTER",
          verticalAlignment: "TOP",
        },
      },
      fields: "userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
    },
  });

  // --- KPI Cards (Rows 5-7) ---
  const kpiColumns = [
    { startCol: 1, endCol: 3 }, // B:C
    { startCol: 3, endCol: 5 }, // D:E
    { startCol: 5, endCol: 7 }, // F:G
    { startCol: 7, endCol: 9 }, // H:I
    { startCol: 9, endCol: 12 }, // J:L
  ];

  for (const { startCol, endCol } of kpiColumns) {
    // Card container borders and clean light background
    stylingRequests.push({
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 4,
          endRowIndex: 7,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.98, green: 0.98, blue: 0.99 },
            padding: { top: 4, right: 8, bottom: 4, left: 8 },
            borders: {
              top: { style: "SOLID", color: { red: 0.88, green: 0.91, blue: 0.94 } },
              bottom: { style: "SOLID", color: { red: 0.88, green: 0.91, blue: 0.94 } },
              left: { style: "SOLID", color: { red: 0.88, green: 0.91, blue: 0.94 } },
              right: { style: "SOLID", color: { red: 0.88, green: 0.91, blue: 0.94 } },
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,padding,borders)",
      },
    });

    // Row 5: KPI Label (9pt, bold, slate)
    stylingRequests.push({
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 4,
          endRowIndex: 5,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 8,
              bold: true,
              foregroundColor: { red: 0.4, green: 0.45, blue: 0.55 },
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
      },
    });

    // Row 6: KPI Main Metric (16pt, bold)
    stylingRequests.push({
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 5,
          endRowIndex: 6,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 16,
              bold: true,
              foregroundColor: { red: 0.06, green: 0.09, blue: 0.16 },
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
      },
    });

    // Row 7: KPI Subtitle / footnote (8pt)
    stylingRequests.push({
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 6,
          endRowIndex: 7,
          startColumnIndex: startCol,
          endColumnIndex: endCol,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 8,
              foregroundColor: { red: 0.4, green: 0.45, blue: 0.55 },
            },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
      },
    });
  }

  // Currency number formatting for KPI row 6
  // B6: Total Spent ($#,##0.00)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 1,
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // D6: Monthly Budget ($#,##0.00, Indigo color)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 3,
        endColumnIndex: 5,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
          textFormat: {
            fontSize: 16,
            bold: true,
            foregroundColor: { red: 0.31, green: 0.27, blue: 0.90 }, // Indigo
          },
        },
      },
      fields: "userEnteredFormat.numberFormat,userEnteredFormat.textFormat",
    },
  });

  // F6: Remaining ($#,##0.00)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 5,
        endColumnIndex: 7,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // H6: Utilization (0.0%)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 7,
        endColumnIndex: 9,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "PERCENT", pattern: "0.0%" },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // J6: Daily Average ($#,##0.00)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 9,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
        },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  });

  // Section Headers (Row 9, Row 23, Row 31)
  const sectionHeaderRows = [8, 22, 30];
  for (const r of sectionHeaderRows) {
    stylingRequests.push({
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: r,
          endRowIndex: r + 1,
          startColumnIndex: 1,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              fontSize: 10,
              bold: true,
              foregroundColor: { red: 0.06, green: 0.09, blue: 0.16 },
            },
            verticalAlignment: "BOTTOM",
          },
        },
        fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
      },
    });
  }

  // Category Table Header (Row 11: B11:F11)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 10,
        endRowIndex: 11,
        startColumnIndex: 1,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 }, // Slate-800
          textFormat: {
            fontSize: 9,
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,padding,verticalAlignment)",
    },
  });

  // Category Table Data Rows (Rows 12-19: B12:F19)
  stylingRequests.push(
    // Col B: Category (Left, 9pt)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 11,
          endRowIndex: 19,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
      },
    },
    // Col C: Amount (Right, Currency)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 11,
          endRowIndex: 20,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
            textFormat: { fontSize: 9 },
            horizontalAlignment: "RIGHT",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Col D: % Share (Right, Percentage)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 11,
          endRowIndex: 20,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "PERCENT", pattern: "0.0%" },
            textFormat: { fontSize: 9, foregroundColor: { red: 0.35, green: 0.4, blue: 0.5 } },
            horizontalAlignment: "RIGHT",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Col E: Txns (Center)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 11,
          endRowIndex: 20,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, foregroundColor: { red: 0.35, green: 0.4, blue: 0.5 } },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Table Total Row (Row 21: B21:F21)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 20,
          endRowIndex: 21,
          startColumnIndex: 1,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
            textFormat: { fontSize: 9, bold: true },
            borders: {
              top: { style: "SOLID", color: { red: 0.7, green: 0.75, blue: 0.8 } },
              bottom: { style: "DOUBLE", color: { red: 0.1, green: 0.1, blue: 0.2 } },
            },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,borders)",
      },
    }
  );

  // Top 5 Table Header (Row 24: B24:F24)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 23,
        endRowIndex: 24,
        startColumnIndex: 1,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 }, // Slate-800
          textFormat: {
            fontSize: 9,
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,padding,verticalAlignment)",
    },
  });

  // Top 5 Data Rows formatting (Rows 25-29)
  stylingRequests.push(
    // Rank
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 24,
          endRowIndex: 29,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Date & Category & Description
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 24,
          endRowIndex: 29,
          startColumnIndex: 2,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9 },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(textFormat,verticalAlignment)",
      },
    },
    // Amount (Currency, bold)
    {
      repeatCell: {
        range: {
          sheetId: dashboardSheetId,
          startRowIndex: 24,
          endRowIndex: 29,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
            textFormat: { fontSize: 9, bold: true },
            horizontalAlignment: "RIGHT",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
      },
    }
  );

  // Multi-Month Table Header (Row 32: B32:F32)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 31,
        endRowIndex: 32,
        startColumnIndex: 1,
        endColumnIndex: 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 }, // Slate-800
          textFormat: {
            fontSize: 9,
            bold: true,
            foregroundColor: { red: 1, green: 1, blue: 1 },
          },
          padding: { top: 4, right: 8, bottom: 4, left: 8 },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,padding,verticalAlignment)",
    },
  });

  // Multi-Month Rows Currency format (Cols C, D, E)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 32,
        endRowIndex: 34,
        startColumnIndex: 2,
        endColumnIndex: 5,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' },
          textFormat: { fontSize: 9 },
          horizontalAlignment: "RIGHT",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // Footer (Row 37)
  stylingRequests.push({
    repeatCell: {
      range: {
        sheetId: dashboardSheetId,
        startRowIndex: 36,
        endRowIndex: 37,
        startColumnIndex: 1,
        endColumnIndex: 12,
      },
      cell: {
        userEnteredFormat: {
          textFormat: {
            fontSize: 8,
            italic: true,
            foregroundColor: { red: 0.58, green: 0.64, blue: 0.72 },
          },
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment",
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: stylingRequests },
  });

  // 5. Add Native Doughnut Chart (Rows 11-21, Cols H:L)
  console.log("Setting up embedded native Doughnut Chart...");
  // Check if chart already exists
  const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const dashboardSheet = updatedMeta.data.sheets.find(
    (s) => s.properties.sheetId === dashboardSheetId
  );
  const existingCharts = dashboardSheet?.charts ?? [];

  const chartRequests = [];
  for (const c of existingCharts) {
    chartRequests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
  }

  // Create new Doughnut Chart
  chartRequests.push({
    addChart: {
      chart: {
        spec: {
          title: "Spending Breakdown by Category",
          pieChart: {
            pieHole: 0.5,
            legendPosition: "RIGHT_LEGEND",
            domain: {
              sourceRange: {
                sources: [
                  {
                    sheetId: dashboardSheetId,
                    startRowIndex: 11,
                    endRowIndex: 19,
                    startColumnIndex: 1,
                    endColumnIndex: 2,
                  },
                ],
              },
            },
            series: {
              sourceRange: {
                sources: [
                  {
                    sheetId: dashboardSheetId,
                    startRowIndex: 11,
                    endRowIndex: 19,
                    startColumnIndex: 2,
                    endColumnIndex: 3,
                  },
                ],
              },
            },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: {
              sheetId: dashboardSheetId,
              rowIndex: 10,
              columnIndex: 7,
            },
            offsetXPixels: 5,
            offsetYPixels: 5,
            widthPixels: 450,
            heightPixels: 290,
          },
        },
      },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: chartRequests },
  });

  console.log("✅ Dashboard setup complete! Tab '📊 Dashboard' is live at Index 0.");
  return { success: true, sheetId: dashboardSheetId };
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDashboardSheet().catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
}
