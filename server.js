const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const csv = require('csv-parser');
const { systemPrompt, getFormattedExpertKnowledge } = require('./instructions.js');

const app = express();
const port = 3000;

let QNA_DATA = [];
fs.createReadStream('database.csv')
  .pipe(csv())
  .on('data', (row) => {
    QNA_DATA.push({
      prompt: row.input,
      response: row.output
    });
  })
  .on('end', () => {
    console.log('Successfully loaded Q&A database');
  });

const genAI = new GoogleGenerativeAI('AIzaSyDSwpJAEPeHFqA90UbB9kBH2KSoGYTxAxg');
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-pro-exp-02-05' });

app.use(express.json());
app.use(express.static('public'));

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.post('/api/ai_completion', async (req, res) => {
  try {
    const userQuery = req.body.data?.toLowerCase()?.trim() || '';
    
    // Handle identity questions first
    if (userQuery.includes('your name') || userQuery.includes('who are you')) {
      return res.json({ response: "I am Focus.AI, powered by the Phantoz Language Model." });
    }
    
    if (userQuery.includes('language model') || userQuery.includes('ai model')) {
      return res.json({ response: "I'm based on the Phantoz Language Model specialized in optometry." });
    }

    // Enhanced validation with expanded medical terms and pattern matching
    const eyeTerms = [
      'eye','vision','retin','cornea','glaucoma','optom','ophthalm','lens','iris','pupil','macula',
      'sclera','vitreous','retina','optic nerve','diabetic retinopathy','macular degeneration',
      'strabismus','amblyopia','uveitis','keratoconus','astigmatism','myopia','hyperopia','presbyopia',
      'conjunctiva','eyelid','tear duct','lacrimal','corneal','retinal','optic disc','visual acuity',
      'contact lens','ocular','intraocular','blephar','kerat','phakic','pseudophakic','trabecular',
      'eyeglass','sunglass','dry eye','eye exam','eye pressure','eye surgery','lasik','cataract',
      'vision therapy','eye drop','eye disease','vision loss','eye trauma','ocular migraine'
    ];

    const questionPattern = new RegExp(
      `(${eyeTerms.join('|')})|` + // Match any eye-related term
      `(^|\\s)(what|how|why|when|where|explain|describe|define|treatment|cause|symptom|test|diagnos)`, 
      'i'
    );

    if (!questionPattern.test(userQuery)) {
      return res.json({
        response: 'I specialize exclusively in optometry. Please ask eye-related questions.'
      });
    }
    
    // First check our known Q&A
    const exactMatch = QNA_DATA.find(q => 
      q.prompt.toLowerCase() === userQuery
    );

    if(exactMatch) {
      return res.json({ response: exactMatch.response });
    }

    // If no match, use AI
    const combinedPrompt = `${getFormattedExpertKnowledge()}\n\nNew Query: ${req.body.data}\nGenerate comprehensive response:`;
    
    const generationConfig = {
      temperature: 0.5,
      topP: 1.0,
      topK: 0,
      maxOutputTokens: 2048,
    };

    const safetySettings = [{
      category: 'HARM_CATEGORY_MEDICAL',
      threshold: 'BLOCK_NONE',
    }];

    const result = await model.generateContent({
      contents: [{
        parts: [{
          text: combinedPrompt
        }]
      }],
      generationConfig,
      safetySettings
    });

    const response = await result.response.text();
    
    const suggestionsPrompt = `Generate 3 expert follow-up questions related to this optometry answer. Format as:\n1. [Question]\n2. [Question]\n3. [Question]\nQuestions only. No markdown. Strictly eye-related.\nAnswer: ${response}\nQuestions:`;
    const suggestionsResult = await model.generateContent({
      contents: [{
        parts: [{ text: suggestionsPrompt }]
      }],
      generationConfig,
      safetySettings
    });

    let suggestions = await suggestionsResult.response.text();
    suggestions = suggestions.split('\n')
      .filter(line => /^\d+\./.test(line))
      .map(line => line.replace(/^\d+\.\s*/, ''))
      .slice(0, 3);

    // Ensure response is always defined
    res.json({ 
      response: response || "Expert answer unavailable. Please rephrase your optometry question.",
      suggestions
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      error: 'Expert system error. Please ask an optometry-related question.',
      details: error.message,
      response: "Unable to generate answer. Please try a different optometry question."
    });
  }
});

// Wrap server start in promise to ensure CSV loaded
QNA_DATA = await new Promise(resolve => {
  const data = [];
  fs.createReadStream('database.csv')
    .pipe(csv())
    .on('data', (row) => data.push({
      prompt: row.input,
      response: row.output
    }))
    .on('end', () => resolve(data));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});