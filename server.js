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

// Rate limiting - prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per 15 minutes per IP
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB max, 5 files
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// SERVER-SIDE API KEY - Users never see this
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY not set in environment variables!');
    console.error('Add it in Render dashboard → Environment Variables');
}

// GST Expert System Prompt
const GST_EXPERT_PROMPT = `You are an Expert Indian GST Consultant, GST Litigation Specialist, Chartered Accountant, and Tax Compliance AI Assistant.

Analyze the GST document and generate a professional report with these sections:

# GST NOTICE SUMMARY REPORT

## 1. BASIC DETAILS
- GSTIN, Trade Name, Legal Name, Notice Type, Section/Rule, DIN, Reference Number, Dates, Officer Name, Department

## 2. EXECUTIVE SUMMARY
- Simple explanation for business owners

## 3. NOTICE TYPE DETECTION
- Primary/Secondary category with confidence %

## 4. FINANCIAL ANALYSIS
- Table: Tax, CGST, SGST, IGST, Cess, Interest, Penalty, Late Fee, Total Demand

## 5. DEADLINE ANALYSIS
- Reply deadline, Hearing date, Urgency level (LOW/MEDIUM/HIGH/CRITICAL)

## 6. LEGAL & COMPLIANCE ANALYSIS
- Applicable sections, Strong/Weak points

## 7. REQUIRED ACTION PLAN
- Step-by-step with priority (Immediate/Important/Optional)

## 8. DOCUMENT CHECKLIST
- Mandatory/Recommended/Optional

## 9. RISK ANALYSIS
- Risk Score out of 10, Severity level

## 10. REPLY STRATEGY
- Technical, Documentation, Legal defense

## 11. DRAFT REPLY OUTLINE
- Professional structure

## 12. FINAL AI RECOMMENDATION
- Next steps, Seriousness, CA/Advocate needed

## 13. SMART FEATURES
- Keywords, Tags, Related forms, Reminders

RULES: Never hallucinate. Use "Not Available" for missing data. Professional GST terminology.`;

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        groqConfigured: !!GROQ_API_KEY,
        message: 'GST Expert Analyzer API'
    });
});

// Main analyze endpoint - NO API key needed from user
app.post('/api/analyze', upload.array('pdfs', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No PDF files uploaded' });
        }

        if (!GROQ_API_KEY) {
            return res.status(500).json({ 
                error: 'Server configuration error. Please contact admin.' 
            });
        }

        const language = req.body.language || 'English';
        const results = [];
        const errors = [];

        for (const file of req.files) {
            try {
                // Extract text from PDF
                const pdfData = await pdfParse(file.buffer);
                const text = pdfData.text.substring(0, 15000);

                // Call Groq API with SERVER key
                const summary = await callGroqAPI(text, language);

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
        console.error('Analyze error:', error);
        res.status(500).json({ 
            error: 'Analysis failed', 
            message: error.message 
        });
    }
});

async function callGroqAPI(text, language) {
    const languageInstruction = {
        'English': 'Generate report in English.',
        'Hindi': 'Generate report in Hindi (हिन्दी) using Devanagari script.',
        'Tamil': 'Generate report in Tamil (தமிழ்) using Tamil script.',
        'Telugu': 'Generate report in Telugu (తెలుగు) using Telugu script.',
        'Marathi': 'Generate report in Marathi (मराठी) using Devanagari script.'
    };

    const response = await axios.post(GROQ_API_URL, {
        model: 'llama-3.3-70b-versatile',
        messages: [
            { 
                role: 'system', 
                content: GST_EXPERT_PROMPT + '\n\n' + (languageInstruction[language] || languageInstruction['English'])
            },
            { 
                role: 'user', 
                content: `ANALYZE THIS GST DOCUMENT:\n\n${text}\n\nGenerate complete professional report now.` 
            }
        ],
        temperature: 0.2,
        max_tokens: 4096
    }, {
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
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
        error: 'Server error', 
        message: err.message 
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════╗
    ║      GST Expert Analyzer - LIVE                      ║
    ╠══════════════════════════════════════════════════════╣
    ║  🌐 URL: http://localhost:${PORT}                      ║
    ║  💰 FREE for all users - No API key needed!            ║
    ║                                                      ║
    ║  API Key: ${GROQ_API_KEY ? '✅ Configured' : '❌ MISSING'}              ║
    ╚══════════════════════════════════════════════════════╝
    `);
});