require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/analyze', limiter);

// File upload config — memory only, PDFs only, max 10MB each, up to 5 files
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

const GROQ_API_KEY    = process.env.GROQ_API_KEY;
const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const RAPIDAPI_KEY    = process.env.RAPIDAPI_KEY;
const GSTIN_HOST      = 'gst-return-status.p.rapidapi.com';
const GSTIN_BASE_URL  = `https://${GSTIN_HOST}/free/gstin`;

if (!GROQ_API_KEY)  console.error('❌ ERROR: GROQ_API_KEY not set!');
if (!RAPIDAPI_KEY)  console.error('❌ ERROR: RAPIDAPI_KEY not set!');

// ─── GST EXPERT SYSTEM PROMPT ───────────────────────────────────────────────
const GST_EXPERT_PROMPT = `You are a Senior Expert Indian GST Consultant, GST Litigation Specialist, and Chartered Accountant with 20+ years of experience.

Analyze the provided GST document thoroughly and generate a COMPLETE professional report covering ALL sections below. Do NOT skip any section. If data is not found in the document, write "Not Available" — never guess or hallucinate.

# GST NOTICE SUMMARY REPORT

## 1. BASIC DETAILS
Extract: GSTIN, Trade Name, Legal Name, Notice/Order Type, Section/Rule Invoked, DIN Number, Reference Number, Issue Date, Due Date, Issuing Officer Name & Designation, Jurisdictional Office

## 2. EXECUTIVE SUMMARY
Write 4-5 sentences a non-CA business owner can understand. What is this notice about? What is the risk? What must they do?

## 3. NOTICE TYPE DETECTION
- Primary Category (e.g. SCN, Assessment Order, Audit Notice, Recovery Notice, Refund Rejection)
- Secondary Category if applicable
- Confidence: XX%

## 4. FINANCIAL ANALYSIS
Provide a table with these exact columns: | Component | CGST | SGST | IGST | Cess | Total |
Rows: Tax Demand, Interest, Penalty, Late Fee, Other Charges, GRAND TOTAL

## 5. DEADLINE ANALYSIS
- Reply/Response Deadline: [date or "Not Available"]
- Personal Hearing Date: [date or "Not Available"]
- Days Remaining (from today): [number]
- Urgency Level: CRITICAL / HIGH / MEDIUM / LOW
- Urgency Reason: [one sentence]

## 6. LEGAL & COMPLIANCE ANALYSIS
- Sections/Rules Invoked: [list]
- Grounds Stated by Department: [list]
- Taxpayer's Strong Points: [list]
- Taxpayer's Weak Points: [list]
- Relevant Case Laws/Circulars: [if applicable]

## 7. REQUIRED ACTION PLAN
Number each action with priority tag:
1. [IMMEDIATE] Action description — Deadline: [date]
2. [IMPORTANT] Action description — Deadline: [date]
3. [OPTIONAL] Action description

## 8. DOCUMENT CHECKLIST
Group as:
- MANDATORY: [list]
- RECOMMENDED: [list]
- OPTIONAL: [list]

## 9. RISK ANALYSIS
- Risk Score: X/10
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Financial Exposure: ₹[amount or range]
- Risk Factors: [bullet list]
- Mitigating Factors: [bullet list]

## 10. REPLY STRATEGY
- Recommended Approach: [Technical / Factual / Legal / Mixed]
- Key Arguments to Make: [numbered list]
- What to Avoid: [list]

## 11. DRAFT REPLY OUTLINE
Provide a structured outline of a professional GST reply letter:
- Subject line
- Opening paragraph
- Main grounds of reply (numbered)
- Documents to attach
- Closing paragraph

## 12. FINAL AI RECOMMENDATION
- Immediate Next Steps: [numbered]
- Seriousness Level: [1-10 with reason]
- Professional Help Needed: Yes — CA / Advocate / Both / No
- Estimated Resolution Time: [timeframe]

## 13. SMART TAGS
- Notice Keywords: [comma separated]
- Related GST Forms: [e.g. GSTR-1, GSTR-3B]
- Applicable Notifications: [if found]

STRICT RULES:
- Never hallucinate numbers, dates, or names not in the document
- Use "Not Available" for any missing field
- Use ₹ for all amounts
- Keep professional GST/legal terminology throughout`;

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getLanguageInstruction(language) {
    const map = {
        'English':  'Generate the entire report in English.',
        'Hindi':    'Generate the entire report in Hindi (हिन्दी) using Devanagari script only.',
        'Tamil':    'Generate the entire report in Tamil (தமிழ்) using Tamil script only.',
        'Telugu':   'Generate the entire report in Telugu (తెలుగు) using Telugu script only.',
        'Marathi':  'Generate the entire report in Marathi (मराठी) using Devanagari script only.',
        'Kannada':  'Generate the entire report in Kannada (ಕನ್ನಡ) using Kannada script only.',
        'Gujarati': 'Generate the entire report in Gujarati (ગુજરાતી) using Gujarati script only.',
    };
    return map[language] || map['English'];
}

async function callGroqAPI(text, language, retries = 2) {
    const body = {
        model: 'llama-3.3-70b-versatile',
        messages: [
            {
                role: 'system',
                content: GST_EXPERT_PROMPT + '\n\n' + getLanguageInstruction(language)
            },
            {
                role: 'user',
                content: `ANALYZE THIS GST DOCUMENT AND GENERATE THE COMPLETE REPORT:\n\n${text}\n\nGenerate all 13 sections now. Do not skip any section.`
            }
        ],
        temperature: 0.15,
        max_tokens: 4096
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(GROQ_API_URL, body, {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 90000
            });
            return response.data.choices[0].message.content;
        } catch (err) {
            const isLast = attempt === retries;
            if (isLast) throw err;
            // Wait 2s before retry
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// ─── GSTIN HELPERS ───────────────────────────────────────────────────────────

function isValidGSTIN(gstin) {
    return /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.trim().toUpperCase());
}

const STATE_CODES = {
    '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
    '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
    '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
    '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
    '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
    '24':'Gujarat','26':'Dadra & Nagar Haveli','27':'Maharashtra','28':'Andhra Pradesh',
    '29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu',
    '34':'Puducherry','35':'Andaman & Nicobar','36':'Telangana','37':'Andhra Pradesh (New)',
    '38':'Ladakh','97':'Other Territory','99':'Centre Jurisdiction'
};

// Rate limiter for GSTIN — protects RapidAPI free quota (1000/day)
const gstinLimiter = rateLimit({
    windowMs: 60 * 1000, max: 15,
    message: { error: 'Too many GSTIN searches. Please wait a moment.' },
    standardHeaders: true, legacyHeaders: false,
});

// ─── ROUTES ─────────────────────────────────────────────────────────────────

// GSTIN Search
app.get('/api/gstin/:gstin', gstinLimiter, async (req, res) => {
    try {
        const gstin = req.params.gstin.trim().toUpperCase();

        if (!isValidGSTIN(gstin)) {
            return res.status(400).json({
                error: 'Invalid GSTIN format. Must be 15 characters (e.g. 33AABCC1234D1ZX).'
            });
        }

        if (!RAPIDAPI_KEY) {
            return res.status(500).json({ error: 'GSTIN search not configured. Contact admin.' });
        }

        const response = await axios.get(
            `https://gst-return-status.p.rapidapi.com/free/gstin/${gstin}`,
            {
                headers: {
                    'x-rapidapi-key':  RAPIDAPI_KEY,
                    'x-rapidapi-host': 'gst-return-status.p.rapidapi.com',
                    'content-type':    'application/json'
                },
                timeout: 15000
            }
        );

        const d = response.data?.data;
        if (!d) return res.status(404).json({ error: 'GSTIN not found.' });

        const stateCode   = gstin.substring(0, 2);
        const latestGSTR1  = d.returns?.find(r => r.rtntype === 'GSTR1');
        const latestGSTR3B = d.returns?.find(r => r.rtntype === 'GSTR3B');

        res.json({
            success: true,
            data: {
                gstin:              d.gstin || gstin,
                legalName:          d.lgnm || 'N/A',
                tradeName:          d.tradeName || d.lgnm || 'N/A',
                status:             d.sts || 'N/A',
                registrationType:   d.dty || 'N/A',
                entityType:         d.ctb || 'N/A',
                pan:                d.pan || 'N/A',
                registrationDate:   d.rgdt || 'N/A',
                cancellationDate:   d.cxdt || null,
                address:            d.adr || 'N/A',
                pincode:            d.pincode || 'N/A',
                stateCode,
                stateName:          STATE_CODES[stateCode] || 'Unknown',
                centralJurisdiction: d.ctj || 'N/A',
                stateJurisdiction:   d.stj || 'N/A',
                complianceCategory:  d.compCategory || 'N/A',
                aggregateTurnover:   d.aggreTurnOver || 'N/A',
                turnoverFY:          d.aggreTurnOverFY || 'N/A',
                hsnCodes:            d.hsn || [],
                natureOfBusiness:    d.nba || [],
                mandatoryEInvoice:   d.mandatedeInvoice || 'N/A',
                filingFrequency:     d.fillingFreq || {},
                returns:             (d.returns || []).slice(0, 24),
                latestGSTR1:         latestGSTR1  ? `${latestGSTR1.taxp} ${latestGSTR1.fy} (filed ${latestGSTR1.dof})`  : 'N/A',
                latestGSTR3B:        latestGSTR3B ? `${latestGSTR3B.taxp} ${latestGSTR3B.fy} (filed ${latestGSTR3B.dof})` : 'N/A',
                dataSyncedOn:        d.meta?.syncMasterDate || 'N/A'
            }
        });

    } catch (err) {
        console.error('GSTIN lookup error:', err.message);
        if (err.response?.status === 404) return res.status(404).json({ error: 'GSTIN not found in GST portal database.' });
        if (err.response?.status === 429) return res.status(429).json({ error: 'Search quota exceeded. Try again later.' });
        res.status(500).json({ error: 'GSTIN lookup failed. ' + (err.message || '') });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        groqConfigured:    !!GROQ_API_KEY,
        gstinConfigured:   !!RAPIDAPI_KEY,
        timestamp: new Date().toISOString(),
        message: 'GST Expert Analyzer — Online'
    });
});

app.post('/api/analyze', upload.array('pdfs', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded. Please select at least one PDF.' });
        }

        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: 'AI service not configured. Please contact the administrator.' });
        }

        const language = req.body.language || 'English';
        const results = [];
        const errors = [];

        for (const file of req.files) {
            try {
                const pdfData = await pdfParse(file.buffer);

                if (!pdfData.text || pdfData.text.trim().length < 50) {
                    errors.push({
                        fileName: file.originalname,
                        error: 'This PDF appears to be a scanned image with no readable text. Please use a text-based PDF.'
                    });
                    continue;
                }

                // Limit text to 15000 chars to stay within token limits
                const text = pdfData.text.substring(0, 15000);
                const summary = await callGroqAPI(text, language);

                results.push({
                    fileName: file.originalname,
                    pages: pdfData.numpages,
                    summary,
                    language,
                    success: true
                });

            } catch (fileError) {
                console.error(`Error processing ${file.originalname}:`, fileError.message);
                errors.push({
                    fileName: file.originalname,
                    error: fileError.response?.data?.error?.message || fileError.message || 'Processing failed'
                });
            }
        }

        res.json({
            success: true,
            results,
            errors,
            totalProcessed: results.length,
            totalFailed: errors.length,
            language
        });

    } catch (error) {
        console.error('Analyze route error:', error);
        res.status(500).json({
            error: 'Analysis failed',
            message: error.message || 'An unexpected error occurred'
        });
    }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB per file.' });
    }
    if (err.message === 'Only PDF files are allowed') {
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Server error', message: err.message });
});

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║        GST Expert Analyzer — LIVE                ║
╠══════════════════════════════════════════════════╣
║  URL  : http://localhost:${PORT}                   ║
║  AI   : ${GROQ_API_KEY ? '✅ Groq API Ready' : '❌ GROQ_API_KEY missing'}              ║
╚══════════════════════════════════════════════════╝
    `);
});
