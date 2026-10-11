import { getSheetsClient, withExponentialBackoff } from "./google";

/**
 * Deletes specific 1-indexed rows from a sheet tab in one batchUpdate.
 *
 * Unlike clearing the tab and rewriting the kept rows, this never touches
 * rows appended after the caller read the sheet, and kept cells are not
 * re-parsed by Sheets. Ranges are deleted bottom-up so earlier deletions do
 * not shift the indexes of later ones.
 */
export async function deleteSheetRows(input: {
  spreadsheetId: string;
  sheetTitle: string;
  rowNumbers: number[];
}): Promise<void> {
  const rows = [...new Set(input.rowNumbers)]
    .filter((n) => Number.isInteger(n) && n >= 2)
    .sort((a, b) => b - a);
  if (rows.length === 0) return;

  const sheets = getSheetsClient();
  const meta = await withExponentialBackoff(() =>
    sheets.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    })
  );
  const sheetId = meta.data.sheets?.find(
    (s) => s.properties?.title === input.sheetTitle
  )?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Sheet tab "${input.sheetTitle}" not found.`);
  }

  // Group descending row numbers into contiguous [start, end] runs.
  const runs: Array<{ start: number; end: number }> = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last.start - 1 === row) {
      last.start = row;
    } else {
      runs.push({ start: row, end: row });
    }
  }

  await withExponentialBackoff(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: runs.map((run) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: run.start - 1,
              endIndex: run.end,
            },
          },
        })),
      },
    })
  );
}
