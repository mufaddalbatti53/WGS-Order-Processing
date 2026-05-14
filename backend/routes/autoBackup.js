// backend/services/autoBackup.js
const cron = require('node-cron');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { Company, User, Client, Order, Notification, Product } = require('../db/models');

async function runDailyBackups() {
    console.log('🔄 [AUTO-BACKUP] Checking schedules for all connected workspaces...');

    try {
        // Get all active companies that are connected to Google Drive and have automation enabled (> 0 days)
        const companies = await Company.find({
            is_active: true,
            'backup_config.is_connected': true,
            'backup_config.frequency_days': { $gt: 0 }
        }).lean();

        for (const company of companies) {
            const config = company.backup_config;

            // Check if enough days have passed since the last backup
            if (config.last_backup_date) {
                const daysSince = (Date.now() - new Date(config.last_backup_date).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince < config.frequency_days) continue; // Not due yet, skip to next company
            }

            console.log(`📦 Running scheduled cloud backup for: ${company.slug}...`);

            // Initialize OAuth Client using this specific company's refresh token
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            oauth2Client.setCredentials({ refresh_token: config.google_refresh_token });
            const drive = google.drive({ version: 'v3', auth: oauth2Client });

            const cid = company._id;
            const backupData = {
                meta: { company_id: cid, company_name: company.name, company_slug: company.slug, exported_at: new Date().toISOString(), version: '1.0' },
                staff: await User.find({ company_id: cid }).lean(),
                clients: await Client.find({ company_id: cid }).lean(),
                orders: await Order.find({ company_id: cid }).lean(),
                products: await Product.find({ company_id: cid }).lean(),
                notifications: await Notification.find({ company_id: cid }).lean()
            };

            const stream = new Readable();
            stream.push(Buffer.from(JSON.stringify(backupData, null, 2)));
            stream.push(null);

            const filename = `WGS_AUTO_${company.slug}_${new Date().toISOString().split('T')[0]}.json`;

            // Upload to Drive
            await drive.files.create({
                requestBody: { name: filename, parents: config.drive_folder_id ? [config.drive_folder_id] : [] },
                media: { mimeType: 'application/json', body: stream }
            });

            // Update their last backup date so the countdown restarts
            await Company.findByIdAndUpdate(cid, { 'backup_config.last_backup_date': new Date() });
            console.log(`✅ Uploaded to their Drive: ${filename}`);
        }
    } catch (error) {
        console.error('❌ [AUTO-BACKUP] Failed:', error.message);
    }
}

function initAutoBackup() {
    // Schedule to run every day at Midnight (00:00) server time
    cron.schedule('0 0 * * *', () => runDailyBackups());
    console.log('⏰ Multi-tenant OAuth Auto-Backup scheduler active.');
}

module.exports = { initAutoBackup };