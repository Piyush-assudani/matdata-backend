const ExcelJS = require('exceljs');

const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const createWorkbook = () => new ExcelJS.Workbook();

const protectCell = (value) => {
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) return `'${value}`;
  if (value instanceof Date) return value;
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return value ?? '';
};

/**
 * Polymorphic sheet builder: supports both
 * 1. addSheet(workbook, name, [ { key: val } ])
 * 2. addSheet(workbook, name, ['Col1', 'Col2'], [ ['val1', 'val2'] ])
 */
const addSheet = (workbook, name, arg3, arg4) => {
  const sheet = workbook.addWorksheet(name || 'Sheet1');
  
  // Case 1: Called with explicit headers and 2D row array: addSheet(wb, name, headers, rows)
  if (Array.isArray(arg3) && Array.isArray(arg4)) {
    const headers = arg3;
    const rows = arg4;
    sheet.columns = headers.map((h, i) => ({
      header: String(h || `Column ${i + 1}`),
      key: `col_${i}`,
      width: Math.min(Math.max(String(h || '').length + 4, 14), 36),
    }));
    rows.forEach((row) => {
      if (Array.isArray(row)) {
        const rowObj = {};
        row.forEach((cellVal, idx) => {
          rowObj[`col_${idx}`] = protectCell(cellVal);
        });
        sheet.addRow(rowObj);
      } else if (row && typeof row === 'object') {
        sheet.addRow(row);
      }
    });
  } else if (Array.isArray(arg3)) {
    // Case 2: Called with array of objects or array of arrays: addSheet(wb, name, rows)
    const rows = arg3;
    if (rows.length && Array.isArray(rows[0])) {
      // Array of arrays without headers
      sheet.columns = rows[0].map((_, i) => ({
        header: `Col ${i + 1}`,
        key: `col_${i}`,
        width: 16,
      }));
      rows.forEach((r) => {
        const rowObj = {};
        r.forEach((cellVal, idx) => {
          rowObj[`col_${idx}`] = protectCell(cellVal);
        });
        sheet.addRow(rowObj);
      });
    } else {
      // Array of objects
      const columns = rows.length ? Object.keys(rows[0]) : [];
      sheet.columns = columns.map((key) => ({
        header: key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
        key,
        width: Math.min(Math.max(key.length + 4, 14), 36),
      }));
      sheet.addRows(rows.map((row) => Object.fromEntries(columns.map((key) => [key, protectCell(row[key])]))));
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.columns && sheet.columns.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  return sheet;
};

/**
 * Bulletproof sendWorkbook:
 * Works regardless of whether arguments are (res, workbook, filename) or (res, filename, workbook)
 */
const sendWorkbook = async (res, arg2, arg3) => {
  let workbook = arg2;
  let filename = arg3;

  // Handle swapped arguments gracefully
  if (typeof arg2 === 'string' && arg3 && typeof arg3.xlsx !== 'undefined') {
    workbook = arg3;
    filename = arg2;
  }

  if (!workbook || !workbook.xlsx) {
    throw new Error('Invalid ExcelJS workbook instance provided to sendWorkbook');
  }

  const rawName = String(filename || 'export').trim();
  const safeFilename = rawName.replace(/\.xlsx$/i, '') || 'export';

  const buffer = await workbook.xlsx.writeBuffer();
  res.attachment(`${safeFilename}.xlsx`).type(contentType).send(Buffer.from(buffer));
};

module.exports = { createWorkbook, addSheet, sendWorkbook };
