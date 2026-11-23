const axios = require('axios');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODELS    = ['openai/gpt-oss-20b'];
const RULE = 'You are a world-class interpreter for Thai-Korean business. Translate naturally and politely. Output ONLY the translated text.';

function expandThaiDates(t) {
  const M = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  return t.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_, d, m, y) => {
    const mi = parseInt(m,10); if (mi<1||mi>12) return _; return parseInt(d)+' '+M[mi]+' '+y; });
}
function cleanKorean(t) {
  return t.split('').filter(c => { const n=c.charCodeAt(0);
    return (n>=0xAC00&&n<=0xD7AF)||(n>=0x1100&&n<=0x11FF)||(n>=0x3130&&n<=0x318F)||
           (n>=65&&n<=90)||(n>=97&&n<=122)||n===32||n===10||n===9||(n>=48&&n<=57)||n===45||n===126; }).join('').trim();
}
function cleanThai(t) {
  return t.split('').filter(c => { const n=c.charCodeAt(0);
    return (n>=0x0E00&&n<=0x0E7F)||(n>=65&&n<=90)||(n>=97&&n<=122)||
           n===32||n===10||n===9||(n>=48&&n<=57)||n===45||n===126; }).join('').trim();
}
async function geminiTranslate(text, toLang, fromLang) {
  if (!GEMINI_API_KEY) return null;
  const L = {th:'Thai',ko:'Korean',en:'English'};
  const rule = toLang==='ko' ? 'Output ONLY Korean Hangul formal polite. Proper nouns in English.'
                             : 'Output ONLY Thai script formal polite. Proper nouns in English.';
  const prompt = RULE+'\n\nTranslate this '+L[fromLang]+' to '+L[toLang]+'. '+rule+'\n\n'+text;
  try {
    const r = await axios.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key='+GEMINI_API_KEY,
      {contents:[{parts:[{text:prompt}]}]},{headers:{'Content-Type':'application/json'},timeout:15000});
    const o = r.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!o) return null; console.log('[TR] Gemini ok '+fromLang+'->'+toLang); return o.trim();
  } catch(e) { console.error('[TR] Gemini:',e.response?.data?.error?.message??e.message); return null; }
}
async function groqTranslate(text, prompt) {
  if (!GROQ_API_KEY) return null;
  for (const model of GROQ_MODELS) {
    try {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        {model,messages:[{role:'system',content:prompt},{role:'user',content:text}],temperature:0.1,max_tokens:500},
        {headers:{'Content-Type':'application/json',Authorization:'Bearer '+GROQ_API_KEY},timeout:20000});
      return r.data.choices[0].message.content.trim();
    } catch(e) { console.error('[TR] Groq:',e.response?.data??e.message); }
  }
  return null;
}
async function translateAll(text) {
  text = text.replace(/(\d{1,3})\s*-\s*(\d{1,3})/g,'$1~$2');
  text = expandThaiDates(text);
  const thCnt=(text.match(/[฀-๿]/g)||[]).length;
  const krCnt=(text.match(/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g)||[]).length;
  if (thCnt>0 && thCnt>=krCnt) {
    const p=RULE+'\n\nTranslate Thai to Korean Hangul formal polite. No romanization.';
    const raw=await geminiTranslate(text,'ko','th')||await groqTranslate(text,p);
    if (!raw) return null; const k=cleanKorean(raw); return k?{kr:k,th:null}:null;
  }
  if (krCnt>0 && krCnt>thCnt) {
    const p=RULE+'\n\nTranslate Korean to Thai script formal polite. No romanization.';
    const raw=await geminiTranslate(text,'th','ko')||await groqTranslate(text,p);
    if (!raw) return null; const t2=cleanThai(raw); return t2?{kr:null,th:t2}:null;
  }
  if (/[a-zA-Z]/.test(text)) {
    const p=RULE+'\n\nTranslate English to Thai script formal polite. No romanization.';
    const raw=await geminiTranslate(text,'th','en')||await groqTranslate(text,p);
    if (!raw) return null; const t2=cleanThai(raw); return t2?{kr:null,th:t2}:null;
  }
  return null;
}
module.exports = { translateAll };
