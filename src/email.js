const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const EMAIL_CONFIG_PATH = path.resolve(__dirname, '../config/email.json');

async function sendDailyReport(csvPath) {
  try {
    if (!fs.existsSync(EMAIL_CONFIG_PATH)) {
      console.warn('[Email] Email config file config/email.json is missing.');
      return;
    }

    const config = JSON.parse(fs.readFileSync(EMAIL_CONFIG_PATH, 'utf8'));

    if (config.smtp_user.includes('YOUR_GMAIL_ADDRESS') || config.smtp_pass.includes('YOUR_GMAIL_APP_PASSWORD')) {
      console.warn('[Email] Please configure your Gmail App Password in config/email.json to enable daily report emails.');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_secure,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
    });

    const fileName = path.basename(csvPath);

    const mailOptions = {
      from: `"LAA Bot" <${config.smtp_user}>`,
      to: config.recipient_email,
      subject: `LinkedIn Auto-Apply Bot Daily Report — ${new Date().toISOString().slice(0, 10)}`,
      text: `Hello,

Please find attached the daily Excel/CSV report of the jobs applied by the LinkedIn Auto-Apply Bot today.

Best regards,
LAA Bot`,
      attachments: [
        {
          filename: fileName,
          path: csvPath,
        },
      ],
    };

    console.log(`[Email] Sending daily report to ${config.recipient_email}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Report sent successfully: ${info.messageId}`);
  } catch (err) {
    console.error(`[Email] Error sending email: ${err.message}`);
  }
}

module.exports = { sendDailyReport };
