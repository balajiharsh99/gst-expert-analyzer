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
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// GST Expert System Prompt
const GST_EXPERT_PROMPT = `You are an Expert Indian GST Consultant, GST Litigation Specialist, Chartered Accountant, and Tax Compliance AI Assistant.

Your job is to analyze uploaded GST-related documents and generate a highly professional GST Notice Summary Report for business users.

The uploaded document may be:
- GST Notice
- DRC-01
- DRC-07
- ASMT-10
- REG-17
- REG-23
- Audit Notice
- Show Cause Notice
- Scrutiny Notice
- E-way Bill Notice
- Summons
- GST Order
- Recovery Notice
- Attachment Notice
- Department Reminder
- Reply filed earlier
- Hearing Notice
- Appeal Order
- Any GST communication

====================================================
OUTPUT FORMAT (STRICTLY FOLLOW THIS)
====================================================

Generate output in the user's selected language.

# GST NOTICE SUMMARY REPORT

====================================================
1. BASIC DETAILS
====================================================

Extract and display:
- GSTIN:
- Trade Name:
- Legal Name:
- Notice Type:
- Notice Category:
- Section/Rule:
- Financial Year:
- State:
- Jurisdiction:
- DIN Number:
- Reference Number:
- Date of Issue:
- Reply Due Date:
- Hearing Date:
- Officer Name:
- Department:
- Document Pages:

If information unavailable: "Not Found in Document"

====================================================
2. EXECUTIVE SUMMARY
====================================================

Explain in simple business language:
- Why department issued notice
- What mismatch/problem identified
- What taxpayer needs to do
- What risk exists

====================================================
3. NOTICE TYPE DETECTION
====================================================

Identify exact category:
- Primary category
- Secondary category
- Confidence percentage

Possible: ITC mismatch, GSTR-2A vs 3B mismatch, Fake invoice, Bogus purchase, E-way bill violation, Tax short payment, Excess ITC claim, Return non-filing, GST audit, Refund rejection, Registration cancellation, Interest demand, Penalty proceedings, Search/inspection, Detention/seizure, Supplier mismatch, HSN dispute, Export mismatch, Transitional credit, Others

====================================================
4. FINANCIAL ANALYSIS
====================================================

Create table:
| Particular | Amount |
| Tax Amount | |
| CGST | |
| SGST | |
| IGST | |
| Cess | |
| Interest | |
| Penalty | |
| Late Fee | |
| Total Demand | |

Also: Total exposure, Immediate liability, Disputed amount

====================================================
5. DEADLINE ANALYSIS
====================================================

Identify: Reply deadline, Hearing date, Appeal limitation, Payment due date
Calculate: Days remaining, Whether expired
Urgency: LOW / MEDIUM / HIGH / CRITICAL

====================================================
6. LEGAL & COMPLIANCE ANALYSIS
====================================================

Analyze: Applicable sections, Relevant rules, Compliance defaults, Department allegations, Legal validity, Natural justice compliance
Mention: Strong points, Weak points for taxpayer

====================================================
7. REQUIRED ACTION PLAN
====================================================

Step-by-step professional action list with priority (Immediate / Important / Optional)

====================================================
8. DOCUMENT CHECKLIST
====================================================

Required supporting documents categorized:
- Mandatory
- Recommended
- Optional

====================================================
9. RISK ANALYSIS
====================================================

Analyze: ITC blockage, Penalty, Recovery, Bank attachment, Registration cancellation, Litigation risks
Risk Score: out of 10
Severity: LOW / MEDIUM / HIGH / CRITICAL

====================================================
10. REPLY STRATEGY
====================================================

Professional strategy including: Technical defense, Documentation defense, Reconciliation strategy, Legal defense, Case law suggestion, Payment/Appeal/Hearing recommendations

====================================================
11. DRAFT REPLY OUTLINE
====================================================

Professional reply structure:
- Subject line
- Intro paragraph
- Facts submission
- Legal submission
- Reconciliation explanation
- Request for dropping proceedings
- Annexure reference

====================================================
12. FINAL AI RECOMMENDATION
====================================================

Expert recommendation with:
- Recommended next step
- Estimated seriousness
- Whether CA/Advocate support recommended

====================================================
13. SMART EXTRA FEATURES
====================================================

- Important keywords
- Auto-generated case tags
- Department allegation summary
- Taxpayer defense summary
- AI confidence score
- Related GST forms
- Suggested folder structure
- Reminder dates
- Follow-up actions

====================================================
IMPORTANT RULES
====================================================

- Never hallucinate data
- Never create fake invoice details
- Never assume missing amounts
- Mention "Not Available" where data missing
- Maintain professional GST terminology
- Use Indian GST law terminology
- Use simple explanation for business owners
- Keep report highly structured
- Highlight critical issues clearly

Now analyze the following GST document text and generate the complete report in the requested language:`;

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        groqConfigured: !!GROQ_API_KEY,
        timestamp: new Date().toISOString()
    });
});

// Summarize endpoint
app.post('/api/summarize', upload.array('pdfs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded' });
        }

        const language = req.body.language || 'English';
        const userApiKey = req.body.apiKey;
        const apiKey = userApiKey || GROQ_API_KEY;

        if (!apiKey) {
            return res.status(400).json({ 
                error: 'No API key available. Please provide your Groq API key or ask admin to configure one.' 
            });
        }

        const results = [];
        const errors = [];

        for (const file of req.files) {
            try {
                const pdfData = await pdfParse(file.buffer);
                const text = pdfData.text.substring(0, 15000);

                const summary = await callGroqAPI(text, language, apiKey);

                results.push({
                    fileName: file.originalname,
                    pages: pdfData.numpages,
                    summary: summary,
                    language: language,
                    success: true
                });

            } catch (fileError) {
                console.error(`Error processing ${file.originalname}:`, fileError.message);
                errors.push({
                    fileName: file.originalname,
                    error: fileError.message
                });
            }
        }

        res.json({
            success: true,
            results: results,
            errors: errors,
            totalProcessed: results.length,
            totalFailed: errors.length,
            language: language
        });

    } catch (error) {
        console.error('Summarize error:', error);
        res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
});

async function callGroqAPI(text, language, apiKey) {
    const languageInstruction = {
        'English': 'Generate the complete report in English language.',
        'Hindi': 'Generate the complete report in Hindi language (हिन्दी). Use Devanagari script for Hindi text.',
        'Tamil': 'Generate the complete report in Tamil language (தமிழ்). Use Tamil script.',
        'Telugu': 'Generate the complete report in Telugu language (తెలుగు). Use Telugu script.',
        'Marathi': 'Generate the complete report in Marathi language (मराठी). Use Devanagari script.'
    };

    const response = await axios.post(GROQ_API_URL, {
        model: 'llama-3.3-70b-versatile',
        messages: [
            { 
                role: 'system', 
                content: GST_EXPERT_PROMPT + '\n\n' + languageInstruction[language] 
            },
            { 
                role: 'user', 
                content: `GST DOCUMENT TEXT TO ANALYZE:\n\n${text}\n\nGenerate the complete professional GST Notice Summary Report now.` 
            }
        ],
        temperature: 0.2,
        max_tokens: 4096
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    return response.data.choices[0].message.content;
}

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: err.message 
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════╗
    ║      GST EXPERT Summarizer Server Running!           ║
    ╠══════════════════════════════════════════════════════╣
    ║  🌐 Website: http://localhost:${PORT}                    ║
    ║  📁 Professional GST Analysis with 13 Sections       ║
    ║                                                      ║
    ║  API Key Status: ${GROQ_API_KEY ? '✅ Configured' : '❌ Not Set'}              ║
    ╚══════════════════════════════════════════════════════╝
    `);
});