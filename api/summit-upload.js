const { google } = require('googleapis');
const SftpClient = require('ssh2-sftp-client');

function makeCsv(rows) {
  return rows
    .map(r =>
      r
        .map(v => {
          const s = v ?? '';
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\n');
}

/**
 * Vercel serverless function
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async (req, res) => {
  try {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const host = process.env.SUMMIT_SFTP_HOST;
    const port = Number(process.env.SUMMIT_SFTP_PORT || '22');
    const username = process.env.SUMMIT_SFTP_USERNAME;
    const password = process.env.SUMMIT_SFTP_PASSWORD;
    const remotePath = process.env.SUMMIT_SFTP_REMOTE_PATH || '/ar2/armadillo_inventory.csv';

    if (!saJson || !sheetId || !host || !username || !password) {
      throw new Error('Missing required env vars');
    }

    const creds = JSON.parse(saJson);

    const jwt = new google.auth.JWT(
      creds.client_email,
      undefined,
      creds.private_key,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );

    const sheets = google.sheets({ version: 'v4', auth: jwt });

    // Read the "Summit Feed" sheet
    const range = `'Summit Feed'!A1:C`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    const values = resp.data.values || [];
    if (!values.length) {
      throw new Error('No data in Summit Feed sheet');
    }

    const csv = makeCsv(values);

    const sftp = new SftpClient();
    await sftp.connect({ host, port, username, password });

    await sftp.put(Buffer.from(csv, 'utf8'), remotePath);
    await sftp.end();

    return res.status(200).json({
      ok: true,
      rows: values.length - 1, // minus header
      remotePath,
    });
  } catch (err) {
    console.error('summit-upload error', err);
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
