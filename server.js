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
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// API KEYS
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'adfdb5b94dmshb083fde496dab7dp18182djsn6c8a6d90f465';

if (!GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY not set in environment variables!');
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

// ========== GSTIN VERIFICATION WITH RAPIDAPI ==========

function extractGSTIN(text) {
    const gstinRegex = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g;
    const matches = text.match(gstinRegex);
    return matches ? [...new Set(matches)] : [];
}

async function verifyGSTIN(gstin) {
    const cleanGSTIN = gstin.replace(/\s/g, '').toUpperCase();
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    
    if (!gstinRegex.test(cleanGSTIN)) {
        return { valid: false, error: 'Invalid GSTIN format' };
    }

    // Try RapidAPI first (official, reliable)
    try {
        const response = await axios.get(`https://gst-verification.p.rapidapi.com/v1/tasks/${cleanGSTIN}`, {
            timeout: 15000,
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': 'gst-verification.p.rapidapi.com'
            }
        });

        const data = response.data;
        
        if (data && data.result) {
            const result = data.result;
            return {
                valid: true,
                gstin: cleanGSTIN,
                businessName: result.legalName || result.legal_name || 'Not Available',
                tradeName: result.tradeName || result.trade_name || 'Not Available',
                status: result.status || result.gstinStatus || 'Unknown',
                state: result.state || result.stateName || 'Unknown',
                registrationDate: result.registrationDate || result.dateOfRegistration || 'Not Available',
                taxpayerType: result.taxpayerType || result.businessType || 'Not Available',
                source: 'RapidAPI (Official)'
            };
        }
        
        return {
            valid: false,
            error: 'GSTIN not found in government records',
            gstin: cleanGSTIN
        };

    } catch (rapidError) {
        console.error('RapidAPI GST verification failed:', rapidError.message);
        
        // Fallback to KnowYourGST
        try {
            console.log('Trying fallback KnowYourGST...');
            const fallbackResponse = await axios.get(`https://www.knowyourgst.com/gst-number-search/${cleanGSTIN}/`, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const html = fallbackResponse.data;
            
            function extractFromHTML(html, label) {
                const regex = new RegExp(`${label}[\\s\\S]*?<td[^>]*>(.*?)</td>`, 'i');
                const match = html.match(regex);
                return match ? match[1].replace(/<[^>]*>/g, '').trim() : null;
            }

            const businessName = extractFromHTML(html, 'Legal Name of Business');
            const tradeName = extractFromHTML(html, 'Trade Name');
            const status = extractFromHTML(html, 'GSTIN Status');
            const state = extractFromHTML(html, 'State');
            const registrationDate = extractFromHTML(html, 'Date of Registration');

            return {
                valid: true,
                gstin: cleanGSTIN,
                businessName: businessName || 'Not Available',
                tradeName: tradeName || 'Not Available',
                status: status || 'Unknown',
                state: state || 'Unknown',
                registrationDate: registrationDate || 'Not Available',
                taxpayerType: 'Not Available',
                source: 'KnowYourGST (Fallback)'
            };

        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError.message);
            return { 
                valid: false, 
                error: 'All verification services unavailable. Please verify manually on services.gst.gov.in',
                gstin: cleanGSTIN
            };
        }
    }
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        groqConfigured: !!GROQ_API_KEY,
        rapidapiConfigured: !!RAPIDAPI_KEY,
        message: 'GST Expert Analyzer API'
    });
});

// GSTIN Verification Endpoint
app.post('/api/verify-gstin', async (req, res) => {
    try {
        const { gstin } = req.body;
        if (!gstin) {
            return res.status(400).json({ error: 'GSTIN is required' });
        }
        const result = await verifyGSTIN(gstin);
        res.json(result);
    } catch (error) {
        console.error('Verify GSTIN error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Main analyze endpoint
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
                const pdfData = await pdfParse(file.buffer);
                const text = pdfData.text.substring(0, 15000);

                // Auto-extract and verify GSTIN
                const extractedGSTINs = extractGSTIN(text);
                let gstinVerification = null;
                if (extractedGSTINs.length > 0) {
                    gstinVerification = await verifyGSTIN(extractedGSTINs[0]);
                }

                const summary = await callGroqAPI(text, language);

                results.push({
                    fileName: file.originalname,
                    pages: pdfData.numpages,
                    summary: summary,
                    language: language,
                    success: true,
                    extractedGSTINs: extractedGSTINs,
                    gstinVerification: gstinVerification
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
    ║      GST Expert Analyzer - LIVE                    ║
    ╠══════════════════════════════════════════════════════╣
    ║  🌐 URL: http://localhost:${PORT}                    ║
    ║  💰 FREE for all users - No API key needed!          ║
    ║  🔍 GSTIN Verification (RapidAPI) Enabled            ║
    ║                                                      ║
    ║  Groq AI: ${GROQ_API_KEY ? '✅ Ready' : '❌ MISSING'}              ║
    ║  RapidAPI: ${RAPIDAPI_KEY ? '✅ Ready' : '❌ MISSING'}              ║
    ╚══════════════════════════════════════════════════════╝
    `);
});