const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const csv = require('csv-parser');
const { systemPrompt, getFormattedExpertKnowledge } = require('./instructions.js');

const app = express();
const port = 3000;

let QNA_DATA = [];

// Enhanced CSV parsing with proper error handling
async function loadQnAData() {
  return new Promise((resolve, reject) => {
    const data = [];
    fs.createReadStream('database.csv')
      .pipe(csv())
      .on('data', (row) => {
        if(row.input && row.output) { // Validate CSV structure
          data.push({
            prompt: row.input.toLowerCase().trim(), // Normalize for matching
            response: row.output
          });
        }
      })
      .on('end', () => {
        console.log(`Loaded ${data.length} Q&A entries`);
        resolve(data);
      })
      .on('error', reject);
  });
}

// Optimized question validation with expanded medical lexicon
function isOptometryQuestion(text) {
  const EYE_TERMS = new Set([
    'ocular', 'retinal', 'corneal', 'vitreous', 'scleral', 'lacrimal',
    'ophthalmic', 'blephar', 'kerat', 'phakic', 'trabecular', 'zonular',
    'diopter', 'astigmatism', 'amblyopia', 'strabismus', 'presbyopia',
    'myopia', 'hyperopia', 'esotropia', 'exotropia', 'aphakia', 'uveitis',
    'glaucoma', 'cataract', 'macula', 'conjunctiv', 'iris', 'pupil',
    'vitrectomy', 'phaco', 'tonometry', 'refractive', 'accommodation'
  ]);

  const QUESTION_WORDS = new Set(['what','how','why','when','where','explain','describe','define']);
  const tokens = text.toLowerCase().split(/\W+/);
  
  return tokens.some(t => EYE_TERMS.has(t)) || 
         QUESTION_WORDS.has(tokens[0]);
}

// Enhanced AI response generation with error wrapping
async function generateExpertResponse(promptText) {
  try {
    const genAI = new GoogleGenerativeAI('AIzaSyDSwpJAEPeHFqA90UbB9kBH2KSoGYTxAxg');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-pro-exp-02-05' });
    const result = await model.generateContent({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        maxOutputTokens: 1024
      }
    });
    
    const response = await result.response.text();
    return response.replace(/(\*\*|\[|\]|<|>)/g, ''); // Sanitize output
    
  } catch (error) {
    console.error('AI Generation Error:', error);
    return 'Unable to generate expert response. Please rephrase your question.';
  }
}

// Dedicated suggestion generator
async function generateFollowUpQuestions(context) {
  try {
    const genAI = new GoogleGenerativeAI('AIzaSyDSwpJAEPeHFqA90UbB9kBH2KSoGYTxAxg');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-pro-exp-02-05' });
    const prompt = `Generate 3 expert follow-up optometry questions based on:\n${context}\nFormat as:\n1. Question\n2. Question\n3. Question`;
    
    const result = await model.generateContent({ 
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300 }
    });
    
    return (await result.response.text())
      .split('\n')
      .filter(l => l.match(/^\d+\./))
      .map(l => l.replace(/^\d+\.\s*/, ''));
      
  } catch (error) {
    console.error('Suggestion Generation Error:', error);
    return [];
  }
}

// Load Q&A data
loadQnAData().then(data => {
  QNA_DATA = data;
  console.log('Q&A data loaded');
});

app.use(express.json());
app.use(express.static('public'));

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Optimized endpoint handler
app.post('/api/ai_completion', async (req, res) => {
  try {
    const userQuery = (req.body.data || '').trim();
    
    // Validate input format
    if(typeof userQuery !== 'string' || userQuery.length > 500) {
      return res.status(400).json({ 
        error: 'Invalid query format. Max 500 characters allowed.' 
      });
    }

    // Initial validation
    if(!isOptometryQuestion(userQuery)) {
      return res.json({ 
        response: 'Please ask an optometry-related question.' 
      });
    }

    // Check Q&A cache (case-insensitive)
    const normalizedQuery = userQuery.toLowerCase().trim();
    const qnaMatch = QNA_DATA.find(q => 
      q.prompt === normalizedQuery ||
      // Simple fuzzy match (Levenshtein distance)
      (q.prompt.length > 0 && normalizedQuery.length > 0 && 
       Math.abs(q.prompt.length - normalizedQuery.length) < 3 && 
       [...q.prompt].filter((c, i) => c !== normalizedQuery[i]).length < 3)
    );

    if(qnaMatch) return res.json({ response: qnaMatch.response });

    // Generate AI response
    const aiResponse = await generateExpertResponse(
      `${getFormattedExpertKnowledge(QNA_DATA)}\nQuestion: ${userQuery}\nAnswer:`
    );

    // Generate suggestions
    const suggestions = await generateFollowUpQuestions(aiResponse);
    
    res.json({
      response: aiResponse,
      suggestions: suggestions.slice(0, 3) // Ensure max 3
    });

  } catch (error) {
    console.error('Endpoint Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      response: 'Expert system unavailable. Please try again later.'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});