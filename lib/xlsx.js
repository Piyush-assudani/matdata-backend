const ExcelJS = require('exceljs');

const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const createWorkbook = () => new ExcelJS.Workbook();
const protectCell = (value) => {
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) return `'${value}`;
  if (value instanceof Date) return value;
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
  return value ?? '';
};
const addSheet = (workbook, name, rows) => {
  const sheet = workbook.addWorksheet(name);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  sheet.columns = columns.map((key) => ({
    header: key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    key,
    width: Math.min(Math.max(key.length + 4, 14), 36),
  }));
  sheet.addRows(rows.map((row) => Object.fromEntries(columns.map((key) => [key, protectCell(row[key])]))));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (columns.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
};
const sendWorkbook = async (res, workbook, filename) => {
  const buffer = await workbook.xlsx.writeBuffer();
  res.attachment(`${filename}.xlsx`).type(contentType).send(Buffer.from(buffer));
};

module.exports = { createWorkbook, addSheet, sendWorkbook };
