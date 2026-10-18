import type { sheets_v4 } from "googleapis";
import { getSheetsClient } from "../google";
import { ensureWorkoutsSheetExists } from "./workout-service";

type Request = sheets_v4.Schema$Request;
type Color = sheets_v4.Schema$Color;

const DASHBOARD_TITLE = "📈 Progress";
/** Older generated dashboards, replaced by this one. */
const LEGACY_TITLES = ["📈 Workout Analytics"];
const WORKOUTS_SHEET_TITLE = "Workouts";

/** 1-based row holding the chart tables' headers; each table has DATA_ROWS rows under it. */
const TABLE_HEADER_ROW = 46;
const DATA_ROWS = 200;
const FIRST = TABLE_HEADER_ROW + 1;
const LAST = TABLE_HEADER_ROW + DATA_ROWS;
const TABLE_WIDTH = 15;

const LIFTS = [
  { name: "Squat", match: "Squat*", input: "'Initial Inputs'!$B$10", color: "#2D6A4F" },
  { name: "Bench", match: "Bench Press*", input: "'Initial Inputs'!$B$11", color: "#4C6EF5" },
  { name: "Deadlift", match: "Deadlift*", input: "'Initial Inputs'!$B$12", color: "#E8590C" },
] as const;

const W = WORKOUTS_SHEET_TITLE;

function getSpreadsheetId(): string {
  const spreadsheetId =
    process.env.GOOGLE_WORKOUT_SHEET_ID || process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error(
      "GOOGLE_WORKOUT_SHEET_ID (or GOOGLE_SHEET_ID) is missing."
    );
  }
  return spreadsheetId;
}

function hex(h: string): Color {
  return {
    red: parseInt(h.slice(1, 3), 16) / 255,
    green: parseInt(h.slice(3, 5), 16) / 255,
    blue: parseInt(h.slice(5, 7), 16) / 255,
  };
}

/** 0-based, end-exclusive grid range. */
function grid(sheetId: number, r1: number, c1: number, r2: number, c2: number): sheets_v4.Schema$GridRange {
  return { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 };
}

/** One column of the chart tables, header row included, as a chart source. */
function tableColumn(sheetId: number, col: number): sheets_v4.Schema$ChartData {
  return { sourceRange: { sources: [grid(sheetId, TABLE_HEADER_ROW - 1, col, LAST, col + 1)] } };
}

function border(): sheets_v4.Schema$Border {
  return { style: "SOLID", colorStyle: { rgbColor: hex("#CED4DA") } };
}

// Wildcards in *IFS criteria: curls minus leg curls are biceps, anything named "Tricep" is triceps.
const sumWeek = (crit: string) =>
  `SUMIFS(${W}!$M:$M,${W}!$B:$B,">="&w,${W}!$B:$B,"<"&(w+7),${W}!$F:$F,"${crit}")`;
const countWeek = (crit: string) =>
  `COUNTIFS(${W}!$B:$B,">="&w,${W}!$B:$B,"<"&(w+7),${W}!$F:$F,"${crit}")`;
const weekMap = (expr: string) => `=MAP($F$${FIRST}:$F$${LAST},LAMBDA(w,IF(w="",,${expr})))`;

function dashboardValues(): string[][] {
  const rows: string[][] = Array.from({ length: FIRST }, () => []);
  rows[0][0] = "PH3 Progress";
  rows[1][0] = "Built from the Workouts log and updates as you log sets. Rebuild any time with /gym setup.";

  // "Start 140 kg (+5)": ROUND keeps whole numbers free of a trailing "." that TEXT(x,"0.#") leaves.
  const vsStart = (best: string, start: string) =>
    `"Start "&ROUND(${start},1)&" kg  ("&IF(${best}>=${start},"+","")&ROUND(${best}-${start},1)&")"`;
  LIFTS.forEach((lift, i) => {
    const col = 1 + i * 3;
    const best = `MAXIFS(${W}!$L:$L,${W}!$F:$F,"${lift.match}")`;
    rows[3][col] = lift.name;
    rows[4][col] = `=IFERROR(${best},0)`;
    rows[5][col] = `=IF(${best}=0,"No sets yet",${vsStart(best, lift.input)})`;
  });
  // A total only means something once every lift has a logged set.
  rows[3][10] = "Total";
  rows[4][10] = "=IF(MIN(B5,E5,H5)=0,0,B5+E5+H5)";
  rows[5][10] = `=IF(K5=0,"Needs a set on all three lifts",${vsStart("K5", "SUM('Initial Inputs'!$B$10:$B$12)")})`;
  rows[6][1] = "Best estimated 1RM per lift (Epley formula, from logged sets)";
  rows[7][1] = `="Training days logged: "&COUNTUNIQUE(${W}!$B$2:$B)&"     Last session: "&IF(COUNT(${W}!$B$2:$B)=0,"none",TEXT(MAX(${W}!$B$2:$B),"ddd d mmm yyyy"))`;

  rows[TABLE_HEADER_ROW - 2][0] = "Data behind the charts";
  rows[TABLE_HEADER_ROW - 1] = [
    "Session", "Squat", "Bench", "Deadlift", "",
    "Week of", "Squat", "Bench", "Deadlift", "Arms", "Other", "",
    "Week of", "Biceps sets", "Triceps sets",
  ];

  const data = rows[FIRST - 1];
  data[0] = `=IFERROR(SORT(UNIQUE(FILTER(${W}!$B$2:$B,ISNUMBER(${W}!$B$2:$B)))),"")`;
  LIFTS.forEach((lift, i) => {
    data[1 + i] = `=MAP($A$${FIRST}:$A$${LAST},LAMBDA(d,IF(d="",,LET(m,MAXIFS(${W}!$L:$L,${W}!$B:$B,d,${W}!$F:$F,"${lift.match}"),IF(m=0,,m)))))`;
  });
  data[5] = `=IFERROR(SORT(UNIQUE(FILTER(${W}!$B$2:$B-WEEKDAY(${W}!$B$2:$B,2)+1,ISNUMBER(${W}!$B$2:$B)))),"")`;
  LIFTS.forEach((lift, i) => {
    data[6 + i] = weekMap(sumWeek(lift.match));
  });
  const arms = `${sumWeek("*Curl*")}-${sumWeek("*Leg Curl*")}+${sumWeek("*Tricep*")}`;
  data[9] = weekMap(arms);
  data[10] = weekMap(
    `SUMIFS(${W}!$M:$M,${W}!$B:$B,">="&w,${W}!$B:$B,"<"&(w+7))-(${LIFTS.map((l) => sumWeek(l.match)).join("+")})-(${arms})`
  );
  data[12] = `=ARRAYFORMULA(IF($F$${FIRST}:$F$${LAST}="",,$F$${FIRST}:$F$${LAST}))`;
  data[13] = `=MAP($M$${FIRST}:$M$${LAST},LAMBDA(w,IF(w="",,${countWeek("*Curl*")}-${countWeek("*Leg Curl*")})))`;
  data[14] = `=MAP($M$${FIRST}:$M$${LAST},LAMBDA(w,IF(w="",,${countWeek("*Tricep*")})))`;

  // Sparse rows would be sent as nulls; fill every gap with an empty cell.
  return rows.map((r) => Array.from({ length: TABLE_WIDTH }, (_, i) => r[i] ?? ""));
}

function chart(
  sheetId: number,
  title: string,
  type: "LINE" | "COLUMN",
  domainCol: number,
  series: Array<{ col: number; color: string }>,
  axes: { x: string; y: string },
  anchor: { row: number; col: number },
  stacked = false
): Request {
  return {
    addChart: {
      chart: {
        spec: {
          title,
          titleTextFormat: { bold: true, fontSize: 13, fontFamily: "Inter" },
          fontName: "Inter",
          basicChart: {
            chartType: type,
            legendPosition: "BOTTOM_LEGEND",
            headerCount: 1,
            // Sessions without a given lift are blank: join the line across them.
            ...(type === "LINE" ? { interpolateNulls: true } : {}),
            ...(stacked ? { stackedType: "STACKED" } : {}),
            axis: [
              { position: "BOTTOM_AXIS", title: axes.x },
              {
                position: "LEFT_AXIS",
                title: axes.y,
                // Volume and set counts start at zero (an all-zero week otherwise draws a -1..1 axis);
                // the 1RM line auto-scales so small gains stay visible.
                ...(type === "COLUMN" ? { viewWindowOptions: { viewWindowMode: "PRETTY", viewWindowMin: 0 } } : {}),
              },
            ],
            domains: [{ domain: tableColumn(sheetId, domainCol) }],
            series: series.map((s) => ({
              series: tableColumn(sheetId, s.col),
              targetAxis: "LEFT_AXIS",
              colorStyle: { rgbColor: hex(s.color) },
              ...(type === "LINE" ? { pointStyle: { shape: "CIRCLE", size: 7 }, lineStyle: { width: 3 } } : {}),
            })),
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId, rowIndex: anchor.row, columnIndex: anchor.col },
            widthPixels: 600,
            heightPixels: 330,
          },
        },
      },
    },
  };
}

function dashboardFormatting(sheetId: number): Request[] {
  const ink = hex("#1B4332");
  const fmt = (r: sheets_v4.Schema$GridRange, format: sheets_v4.Schema$CellFormat, fields: string): Request => ({
    repeatCell: { range: r, cell: { userEnteredFormat: format }, fields: `userEnteredFormat(${fields})` },
  });
  const requests: Request[] = [
    fmt(grid(sheetId, 0, 0, LAST, 16), { textFormat: { fontFamily: "Inter", fontSize: 10 } }, "textFormat"),
    { mergeCells: { range: grid(sheetId, 0, 0, 1, TABLE_WIDTH), mergeType: "MERGE_ALL" } },
    fmt(
      grid(sheetId, 0, 0, 1, TABLE_WIDTH),
      {
        backgroundColor: ink,
        textFormat: { fontFamily: "Inter", bold: true, fontSize: 18, foregroundColor: hex("#FFFFFF") },
        verticalAlignment: "MIDDLE",
        padding: { left: 12 },
      },
      "backgroundColor,textFormat,verticalAlignment,padding"
    ),
    fmt(grid(sheetId, 1, 0, 2, TABLE_WIDTH), { textFormat: { fontFamily: "Inter", italic: true, foregroundColor: hex("#6C757D") } }, "textFormat"),
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 44 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 40 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 16 }, properties: { pixelSize: 92 }, fields: "pixelSize" } },
  ];

  // KPI tiles: Squat, Bench, Deadlift, Total, each two columns wide.
  for (const col of [1, 4, 7, 10]) {
    for (const row of [3, 4, 5]) {
      requests.push({ mergeCells: { range: grid(sheetId, row, col, row + 1, col + 2), mergeType: "MERGE_ALL" } });
    }
    const tile = grid(sheetId, 3, col, 6, col + 2);
    requests.push(
      fmt(tile, { backgroundColor: hex("#F1F8F4"), horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" }, "backgroundColor,horizontalAlignment,verticalAlignment"),
      fmt(grid(sheetId, 3, col, 4, col + 2), { textFormat: { fontFamily: "Inter", bold: true, fontSize: 10, foregroundColor: hex("#495057") } }, "textFormat"),
      fmt(grid(sheetId, 4, col, 5, col + 2), { numberFormat: { type: "NUMBER", pattern: '0.0" kg";-0.0" kg";"–"' }, textFormat: { fontFamily: "Inter", bold: true, fontSize: 20, foregroundColor: ink } }, "numberFormat,textFormat"),
      fmt(grid(sheetId, 5, col, 6, col + 2), { textFormat: { fontFamily: "Inter", fontSize: 9, foregroundColor: hex("#6C757D") } }, "textFormat"),
      { updateBorders: { range: tile, top: border(), bottom: border(), left: border(), right: border() } }
    );
  }
  requests.push(
    fmt(grid(sheetId, 6, 1, 8, TABLE_WIDTH), { textFormat: { fontFamily: "Inter", fontSize: 9, foregroundColor: hex("#6C757D") } }, "textFormat"),
    fmt(grid(sheetId, TABLE_HEADER_ROW - 2, 0, TABLE_HEADER_ROW - 1, TABLE_WIDTH), { textFormat: { fontFamily: "Inter", bold: true, fontSize: 12, foregroundColor: ink } }, "textFormat")
  );

  // Chart tables: header style and number formats.
  for (const [c1, c2] of [[0, 4], [5, 11], [12, 15]]) {
    requests.push(
      fmt(grid(sheetId, TABLE_HEADER_ROW - 1, c1, TABLE_HEADER_ROW, c2), { backgroundColor: hex("#2D6A4F"), textFormat: { fontFamily: "Inter", bold: true, foregroundColor: hex("#FFFFFF") }, horizontalAlignment: "CENTER" }, "backgroundColor,textFormat,horizontalAlignment"),
      fmt(grid(sheetId, FIRST - 1, c1, LAST, c1 + 1), { numberFormat: { type: "DATE", pattern: "d mmm" }, horizontalAlignment: "CENTER" }, "numberFormat,horizontalAlignment")
    );
  }
  requests.push(
    fmt(grid(sheetId, FIRST - 1, 1, LAST, 4), { numberFormat: { type: "NUMBER", pattern: "0.0" }, horizontalAlignment: "CENTER" }, "numberFormat,horizontalAlignment"),
    fmt(grid(sheetId, FIRST - 1, 6, LAST, 11), { numberFormat: { type: "NUMBER", pattern: "#,##0" }, horizontalAlignment: "CENTER" }, "numberFormat,horizontalAlignment"),
    fmt(grid(sheetId, FIRST - 1, 13, LAST, 15), { numberFormat: { type: "NUMBER", pattern: "0" }, horizontalAlignment: "CENTER" }, "numberFormat,horizontalAlignment")
  );

  requests.push(
    chart(
      sheetId,
      "Estimated 1RM per session",
      "LINE",
      0,
      LIFTS.map((l, i) => ({ col: 1 + i, color: l.color })),
      { x: "Session", y: "kg" },
      { row: 9, col: 0 }
    ),
    chart(
      sheetId,
      "Weekly volume lifted (sets x reps x kg)",
      "COLUMN",
      5,
      [
        ...LIFTS.map((l, i) => ({ col: 6 + i, color: l.color })),
        { col: 9, color: "#9C36B5" },
        { col: 10, color: "#ADB5BD" },
      ],
      { x: "Week of", y: "kg" },
      { row: 9, col: 7 },
      true
    ),
    chart(
      sheetId,
      "Arm sets per week",
      "COLUMN",
      12,
      [
        { col: 13, color: "#9C36B5" },
        { col: 14, color: "#E64980" },
      ],
      { x: "Week of", y: "Sets" },
      { row: 27, col: 0 }
    )
  );
  return requests;
}

function workoutsFormatting(sheetId: number, hasBanding: boolean): Request[] {
  const widths: Array<[number, number, number]> = [
    [0, 1, 130], // SessionID
    [1, 3, 95], // Date, Week
    [3, 5, 90], // Location, Routine
    [5, 6, 220], // Exercise
    [6, 13, 85], // Set, Weight, Reps, Drop, Notes, 1RM, Volume
  ];
  const requests: Request[] = [
    {
      repeatCell: {
        range: grid(sheetId, 0, 0, 1000, 13),
        cell: { userEnteredFormat: { textFormat: { fontFamily: "Inter", fontSize: 10 }, verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(textFormat.fontFamily,textFormat.fontSize,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: grid(sheetId, 0, 0, 1, 13),
        cell: {
          userEnteredFormat: {
            backgroundColor: hex("#1B4332"),
            textFormat: { fontFamily: "Inter", bold: true, fontSize: 10, foregroundColor: hex("#FFFFFF") },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: grid(sheetId, 1, 1, 1000, 13),
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    },
    {
      repeatCell: {
        range: grid(sheetId, 1, 5, 1000, 6),
        cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    ...widths.map(([start, end, px]): Request => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: start, endIndex: end },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    })),
  ];
  if (!hasBanding) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: grid(sheetId, 0, 0, 1000, 13),
          rowProperties: {
            headerColorStyle: { rgbColor: hex("#1B4332") },
            firstBandColorStyle: { rgbColor: hex("#FFFFFF") },
            secondBandColorStyle: { rgbColor: hex("#F1F8F4") },
          },
        },
      },
    });
  }
  return requests;
}

/**
 * Builds the "📈 Progress" tab: best estimated 1RM per lift, a 1RM-per-session line chart,
 * weekly volume by lift and weekly arm sets. Everything is formula-driven off the Workouts
 * log, so it stays current as sets are logged; rerunning rebuilds the tab from scratch.
 */
export async function setupWorkoutDashboardSheet(): Promise<{ success: boolean; message: string }> {
  await ensureWorkoutsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title),bandedRanges(bandedRangeId))",
  });
  const sheetList = meta.data.sheets ?? [];
  const workouts = sheetList.find((s) => s.properties?.title === WORKOUTS_SHEET_TITLE);
  const stale = sheetList.filter((s) =>
    [DASHBOARD_TITLE, ...LEGACY_TITLES].includes(s.properties?.title ?? "")
  );

  const setup: Request[] = stale.map((s) => ({ deleteSheet: { sheetId: s.properties?.sheetId ?? undefined } }));
  setup.push({
    addSheet: {
      properties: {
        title: DASHBOARD_TITLE,
        index: 0,
        tabColor: hex("#2D6A4F"),
        gridProperties: { rowCount: LAST + 5, columnCount: 16, hideGridlines: true },
      },
    },
  });
  const added = await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: setup } });
  const dashboardId = added.data.replies?.at(-1)?.addSheet?.properties?.sheetId;
  if (dashboardId === undefined || dashboardId === null) {
    throw new Error("Could not create the Progress tab.");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DASHBOARD_TITLE}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: dashboardValues() },
  });

  const formatting = dashboardFormatting(dashboardId);
  const workoutsId = workouts?.properties?.sheetId;
  if (workoutsId !== undefined && workoutsId !== null) {
    formatting.push(...workoutsFormatting(workoutsId, (workouts?.bandedRanges ?? []).length > 0));
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatting } });

  return { success: true, message: "Progress dashboard rebuilt: open the 📈 Progress tab in your powerlifting log." };
}
