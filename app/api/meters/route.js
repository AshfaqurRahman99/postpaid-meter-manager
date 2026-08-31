import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// আপনার গুগল শিটের একদম হুবহু নাম
const SETTINGS_SHEET = 'Smart Meter - Settings Database';
const HISTORY_SHEET = 'Smart Meter - Billing History Database';

// শিট থেকে ডেটা এনে ড্যাশবোর্ডকে দেওয়া
export async function GET() {
    try {
        // দুটি শিট থেকেই একসাথে ডেটা ফেচ করা
        const [settingsRes, historyRes] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SETTINGS_SHEET}'!A2:I` }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${HISTORY_SHEET}'!A2:P` })
        ]);

        const settingsRows = settingsRes.data.values || [];
        const historyRows = historyRes.data.values || [];

        const metersData = {};

        // Settings Sheet থেকে ডেটা প্রসেস করা
        settingsRows.forEach(row => {
            const meterName = row[1];
            if (!meterName) return;

            metersData[meterName] = {
                meterNumber: row[2] || "",
                isActive: row[3] === 'TRUE',
                useCarryLogic: row[4] === 'TRUE',
                target: Number(row[5]) || 0,
                maxCarry: Number(row[6]) || 0,
                currentCarry: Number(row[7]) || 0,
                lastReading: Number(row[8]) || 0,
                history: []
            };
        });

        // History Sheet থেকে ডেটা প্রসেস করা
        historyRows.forEach(row => {
            const meterName = row[3];
            if (!meterName || !metersData[meterName]) return;

            const historyRecord = {
                updatedAt: row[1] || "",
                month: row[2] || "",
                prevReading: Number(row[4]) || 0,
                rawInput: Number(row[5]) || 0,
                consumed: Number(row[6]) || 0,
                billed: Number(row[7]) || 0,
                carry: Number(row[8]) || 0,
                reading: Number(row[9]) || 0,
                isLocked: row[10] === 'TRUE',
                config: {
                    useCarryLogic: row[11] === 'TRUE',
                    target: Number(row[12]) || 0,
                    maxCarry: Number(row[13]) || 0
                },
                prevCarry: Number(row[15]) || 0 // P কলামে PrevCarry সেভ হবে
            };
            metersData[meterName].history.push(historyRecord);
        });

        return NextResponse.json(metersData);

    } catch (error) {
        console.error("GET Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// ড্যাশবোর্ড থেকে নতুন ডেটা রিসিভ করে শিটে সেভ করা
export async function POST(request) {
    try {
        const metersData = await request.json();

        const settingsValues = [];
        const historyValues = [];

        let meterIndex = 1;
        let historyIndex = 1;

        // JSON ডেটা ভেঙে শিটের কলাম অনুযায়ী সাজানো
        for (const [meterName, data] of Object.entries(metersData)) {
            // Settings এর সারি প্রস্তুত করা
            settingsValues.push([
                `meter_${meterIndex.toString().padStart(2, '0')}`, // A: Record ID
                meterName,                                         // B: Meter Name
                data.meterNumber,                                  // C: Meter Number
                data.isActive ? 'TRUE' : 'FALSE',                  // D: Is Active
                data.useCarryLogic ? 'TRUE' : 'FALSE',             // E: Use Carry Logic
                data.target,                                       // F: Target
                data.maxCarry,                                     // G: Max Carry
                data.currentCarry,                                 // H: Current Carry
                data.lastReading                                   // I: Last Reading
            ]);
            meterIndex++;

            // History এর সারিগুলো প্রস্তুত করা
            if (data.history && data.history.length > 0) {
                data.history.forEach(record => {
                    historyValues.push([
                        `rec_${historyIndex.toString().padStart(3, '0')}`, // A: Record ID
                        record.updatedAt,                                  // B: Updated At
                        record.month,                                      // C: Month
                        meterName,                                         // D: Meter Name
                        record.prevReading,                                // E: Prev Reading
                        record.rawInput,                                   // F: Raw Input
                        record.consumed,                                   // G: Consumed
                        record.billed,                                     // H: Billed Units
                        record.carry,                                      // I: Carry Balance
                        record.reading,                                    // J: Present Reading
                        record.isLocked ? 'TRUE' : 'FALSE',                // K: Is Locked
                        record.config?.useCarryLogic ? 'TRUE' : 'FALSE',   // L: Snap_UseCarry
                        record.config?.target || 0,                        // M: Snap_Target
                        record.config?.maxCarry || 0,                      // N: Snap_MaxCarry
                        0,                                                 // O: Estimated Bill
                        record.prevCarry || 0                              // P: Prev Carry (Hidden System Memory)
                    ]);
                    historyIndex++;
                });
            }
        }

        // পুরনো ডেটা মুছে নতুন আপডেটেড ডেটা ওভাররাইট করা (যাতে এডিট করলে ডুপ্লিকেট না হয়)
        await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${SETTINGS_SHEET}'!A2:I` });
        await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${HISTORY_SHEET}'!A2:P` });

        if (settingsValues.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${SETTINGS_SHEET}'!A2`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: settingsValues }
            });
        }

        if (historyValues.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `'${HISTORY_SHEET}'!A2`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: historyValues }
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("POST Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}