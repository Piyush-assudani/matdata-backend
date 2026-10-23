const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let cachedPythonCmd = null;

/**
 * Determine working Python 3 command in runtime (tries PYTHON_PATH, python3, python)
 */
async function getWorkingPythonCommand() {
  if (cachedPythonCmd) return cachedPythonCmd;
  const candidates = [process.env.PYTHON_PATH, 'python3', 'python'].filter(Boolean);
  for (const cmd of candidates) {
    const ok = await new Promise((resolve) => {
      try {
        const py = spawn(cmd, ['-c', 'import pypdf, openpyxl; print("OK")']);
        let out = '';
        py.stdout.on('data', (d) => { out += d.toString(); });
        py.on('close', (code) => resolve(code === 0 && out.includes('OK')));
        py.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
    if (ok) {
      // Ensure PyMuPDF (fitz) and Pillow are installed in Python runtime for photo extraction
      try {
        const fitzOk = await new Promise((res) => {
          const check = spawn(cmd, ['-c', 'import fitz, PIL; print("FITZ_OK")']);
          let cOut = '';
          check.stdout.on('data', (d) => { cOut += d.toString(); });
          check.on('close', (c) => res(c === 0 && cOut.includes('FITZ_OK')));
          check.on('error', () => res(false));
        });
        if (!fitzOk) {
          console.warn(`[pythonBridge] PyMuPDF/Pillow missing in ${cmd}. Auto-installing...`);
          await new Promise((res) => {
            const pip = spawn(cmd, ['-m', 'pip', 'install', 'PyMuPDF>=1.24.0', 'Pillow>=10.0.0', '--no-warn-script-location']);
            pip.on('close', () => res(true));
            pip.on('error', () => res(false));
          });
        }
      } catch (err) {
        console.warn('[pythonBridge] Dependency auto-install check error:', err.message);
      }

      cachedPythonCmd = cmd;
      return cmd;
    }
  }
  return null;
}

/**
 * Execute high-speed Python PyMuPDF / glyph parser for PDF to Excel conversion
 * 
 * @param {string} pdfPath - Path to input PDF
 * @param {string} excelPath - Path to destination .xlsx
 * @param {string} wardNo - Optional Ward Number
 * @param {string} boothNo - Optional Booth / Part Number
 * @param {string} photosDir - Optional path to save extracted photos
 * @returns {Promise<{ success: boolean, count?: number, file: string }>}
 */
async function runPythonPdfToExcel(pdfPath, excelPath, wardNo = '', boothNo = '', photosDir = null) {
  const pythonCmd = await getWorkingPythonCommand() || 'python3';
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, '../scripts/extract_voters_perfect.py');
    if (!fs.existsSync(pythonScript)) {
      return reject(new Error(`Python script not found: ${pythonScript}`));
    }

    const templatePath = path.join(__dirname, '../../voter-import-template.xlsx');
    const args = [
      pythonScript,
      '--pdf', pdfPath,
      '--output', excelPath,
      '--ward', wardNo || '',
      '--booth', boothNo || ''
    ];
    if (fs.existsSync(templatePath)) {
      args.push('--template', templatePath);
    }
    if (photosDir) {
      args.push('--extract-photos-dir', photosDir);
    }

    const py = spawn(pythonCmd, args);

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });

    py.on('close', (code) => {
      if (code === 0) {
        const lines = stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.success) return resolve(parsed);
          } catch {}
        }
        resolve({ success: true, file: excelPath });
      } else {
        reject(new Error(`Python extraction failed (code ${code}): ${stderr || stdout}`));
      }
    });

    py.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if Python 3 and required libraries are available in runtime
 */
async function isPythonAvailable() {
  const cmd = await getWorkingPythonCommand();
  return Boolean(cmd);
}

module.exports = {
  runPythonPdfToExcel,
  isPythonAvailable,
  getWorkingPythonCommand
};
