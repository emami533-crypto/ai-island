/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AI Island | Backend v9
 *  Node.js + Express + SQLite + JWT + RSS + MyMemory + Translation Cache
 *  + دسته‌بندی + صفحه‌بندی + بخش آموزش
 * ═══════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const Parser = require('rss-parser');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');

const app = express();
const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Island-Bot/1.0)' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
      ['enclosure', 'enclosure']
    ]
  }
});
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const FETCH_CRON = process.env.FETCH_CRON || '0 */3 * * *';

/* ═══════════ پایگاه داده ═══════════ */
const db = new Database('ai-island.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE,
    title_fa TEXT,   title_en TEXT,
    summary_fa TEXT, summary_en TEXT,
    content_fa TEXT, content_en TEXT,
    source TEXT, url TEXT, category TEXT, image TEXT,
    published_at TEXT, likes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tutorials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    category TEXT,
    title_fa TEXT,   title_en TEXT,
    summary_fa TEXT, summary_en TEXT,
    content_fa TEXT, content_en TEXT,
    icon TEXT DEFAULT '📚',
    level TEXT DEFAULT 'beginner',
    read_time INTEGER DEFAULT 5,
    source TEXT,
    url TEXT,
    image TEXT,
    is_manual INTEGER DEFAULT 1,
    published_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    approved INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(news_id) REFERENCES news(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT, description TEXT NOT NULL,
    link TEXT, tags TEXT, icon TEXT DEFAULT '🚀',
    lang TEXT DEFAULT 'fa',
    votes INTEGER DEFAULT 0, approved INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS translation_cache (
    hash TEXT PRIMARY KEY,
    source_text TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ═══════════ منابع خبری ═══════════ */
const FEEDS = [
  /* ═══ ابزارها (اولویت اول) ═══ */
  { source:'Product Hunt AI',   category:'tools',    url:'https://www.producthunt.com/feed' },
  { source:'AI Central Tools',  category:'tools',    url:'https://aicentraltools.com/news/feed/' },
  { source:'The Rundown AI',    category:'tools',    url:'https://www.therundown.ai/feed' },

  /* ═══ مدل‌ها ═══ */
  { source:'Google DeepMind',   category:'llm',      url:'https://deepmind.google/blog/rss.xml' },
  { source:'Hugging Face Blog', category:'llm',      url:'https://huggingface.co/blog/feed.xml' },
  { source:'Anthropic News',    category:'llm',      url:'https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_anthropic_news.xml' },
  { source:'xAI News',          category:'llm',      url:'https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_xai_news.xml' },

  /* ═══ ایجنت‌ها ═══ */
  { source:'AI Agents Weekly',  category:'agent',    url:'https://aiagents.substack.com/feed' },

  /* ═══ سخت‌افزار ═══ */
  { source:'NVIDIA Blog',       category:'hardware', url:'https://blogs.nvidia.com/feed/' },
  { source:'NVIDIA Developer',  category:'hardware', url:'https://developer.nvidia.com/blog/feed/' },

  /* ═══ پژوهش ═══ */
  { source:'arXiv AI',          category:'research', url:'https://rss.arxiv.org/rss/cs.AI' },
  { source:'arXiv ML',          category:'research', url:'https://rss.arxiv.org/rss/cs.LG' },
  { source:'MIT Tech Review',   category:'research', url:'https://www.technologyreview.com/topic/artificial-intelligence/feed' },

  /* ═══ عمومی (پشتیبان) ═══ */
  { source:'TechCrunch AI',     category:'general',  url:'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { source:'The Verge AI',      category:'general',  url:'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' }
];
/* ═══════════ منابع آموزشی ═══════════ */
const TUTORIAL_FEEDS = [
  { source:'Google AI Blog',    category:'basics',    url:'https://blog.google/technology/ai/rss/' },
  { source:'AWS ML Blog',       category:'prompt',    url:'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { source:'KDnuggets',         category:'context',   url:'https://www.kdnuggets.com/feed' },
  { source:'MarkTechPost',      category:'agent',     url:'https://www.marktechpost.com/feed/' }
];

/* ═══════════ کش ترجمه ═══════════ */
function hashText(text, target){
  return crypto.createHash('md5').update(`${target}::${text}`).digest('hex');
}

function getCachedTranslation(text, target){
  const h = hashText(text, target);
  const row = db.prepare('SELECT translated_text FROM translation_cache WHERE hash=?').get(h);
  return row ? row.translated_text : null;
}

function saveCachedTranslation(text, target, translated){
  const h = hashText(text, target);
  try{
    db.prepare(`INSERT OR REPLACE INTO translation_cache
      (hash, source_text, target_lang, translated_text)
      VALUES (?, ?, ?, ?)`).run(h, text, target, translated);
  }catch(e){ console.error('[cache] save error:', e.message); }
}

/* ═══════════ ترجمه ═══════════ */
async function translate(text, target){
  if(!text) return text;
  const provider = process.env.TRANSLATE_PROVIDER || 'none';
  if(provider === 'none') return text;

  // اول کش رو چک کن
  const cached = getCachedTranslation(text, target);
  if(cached) return cached;

  // بعد ترجمه‌ی واقعی
  const translated = await translateRaw(text, target);

  // اگه ترجمه واقعی بود، توی کش ذخیره کن
  if(translated && translated !== text){
    saveCachedTranslation(text, target, translated);
  }
  return translated;
}

async function translateRaw(text, target){
  if(!text) return text;

  const providers = [
    { name: 'Google', fn: translateGoogle },
    { name: 'MyMemory', fn: translateMyMemory }
  ];

  for(const provider of providers){
    try{
      const result = await provider.fn(text, target);
      if(result && result.trim() && result !== text){
        return result;
      }
    }catch(e){
      console.log(`   [ترجمه] ${provider.name} خطا: ${e.message}`);
    }
  }
  return text;
}

async function translateGoogle(text, target){
  const targetLang = target === 'fa' ? 'fa' : 'en';
  const sourceLang = target === 'fa' ? 'en' : 'fa';
  const chunks = [];
  let remaining = text;
  const maxLen = 1500;
  while(remaining.length > 0){
    let cut = Math.min(maxLen, remaining.length);
    if(cut < remaining.length){
      const lastSpace = remaining.lastIndexOf(' ', cut);
      if(lastSpace > 500) cut = lastSpace;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  const out = [];
  for(const chunk of chunks){
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(chunk)}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if(!r.ok) throw new Error(`Google HTTP ${r.status}`);
    const data = await r.json();
    if(Array.isArray(data) && Array.isArray(data[0])){
      out.push(data[0].map(item => item[0]).filter(Boolean).join(''));
    } else {
      throw new Error('Google: پاسخ نامعتبر');
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return out.join(' ');
}

async function translateMyMemory(text, target){
  const pair = target === 'fa' ? 'en|fa' : 'fa|en';
  const email = process.env.MYMEMORY_EMAIL || '';
  const maxLen = 480;

  async function translateChunk(chunk){
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${pair}`;
    if(email) url += `&de=${encodeURIComponent(email)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if(!r.ok) throw new Error(`MyMemory HTTP ${r.status}`);
    const data = await r.json();
    const result = data?.responseData?.translatedText || '';
    if(result.includes('MYMEMORY WARNING')) throw new Error('MyMemory سقف پر شده');
    return result;
  }

  if(text.length <= maxLen) return await translateChunk(text);

  const chunks = [];
  let remaining = text;
  while(remaining.length > 0){
    let cut = Math.min(maxLen, remaining.length);
    if(cut < remaining.length){
      const lastSpace = remaining.lastIndexOf(' ', cut);
      if(lastSpace > 200) cut = lastSpace;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  const out = [];
  for(const chunk of chunks){
    try{ out.push(await translateChunk(chunk)); }
    catch(e){ out.push(chunk); }
    await new Promise(r => setTimeout(r, 250));
  }
  return out.join(' ');
}

/* ═══════════ استخراج تصویر ═══════════ */
function extractImage(item){
  if(item.enclosure?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(item.enclosure.url))
    return item.enclosure.url;

  const mc = item.mediaContent || item['media:content'];
  if(Array.isArray(mc) && mc.length){
    for(const m of mc){
      const url = m?.$?.url || m?.url;
      if(url && /\.(jpg|jpeg|png|webp|gif)/i.test(url)) return url;
    }
  } else if(mc){
    const url = mc?.$?.url || mc?.url;
    if(url) return url;
  }

  const mt = item.mediaThumbnail || item['media:thumbnail'];
  if(Array.isArray(mt) && mt.length){
    for(const m of mt){
      const url = m?.$?.url || m?.url;
      if(url) return url;
    }
  } else if(mt){
    const url = mt?.$?.url || mt?.url;
    if(url) return url;
  }

  const html = item.contentEncoded || item['content:encoded'] || item.content || item.summary || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if(match && match[1]) return match[1];

  return '';
}

/* ═══════════ تشخیص دسته‌بندی خبر ═══════════ */
function detectCategory(title, summary, feedCategory){
  const text = `${title} ${summary}`.toLowerCase();

  if(/\b(gpt|claude|gemini|llama|mistral|deepseek|qwen|model|llm|gpt-\d|claude \d|gemini \d)\b/i.test(text))
    return 'llm';
  if(/\b(agent|agentic|autonomous|langchain|autogen|crewai|tool.use|copilot|assistant)\b/i.test(text))
    return 'agent';
  if(/\b(gpu|nvidia|cuda|tpu|chip|silicon|h100|h200|b100|b200|gb200|rtx|amd instinct|hardware|semiconductor)\b/i.test(text))
    return 'hardware';
  if(/\b(paper|research|arxiv|study|benchmark|state-of-the-art|sota|neurips|icml|iclr)\b/i.test(text))
    return 'research';
  if(/\b(api|sdk|library|framework|tool|plugin|open.source|github)\b/i.test(text))
    return 'tools';
  return feedCategory || 'general';
}

/* ═══════════ جمع‌آوری اخبار ═══════════ */
const insertNews = db.prepare(`
  INSERT OR IGNORE INTO news
    (guid, title_fa, title_en, summary_fa, summary_en, content_fa, content_en,
     source, url, category, image, published_at)
  VALUES (@guid, @title_fa, @title_en, @summary_fa, @summary_en, @content_fa, @content_en,
          @source, @url, @category, @image, @published_at)
`);

async function fetchAllNews(){
  console.log(`\n[fetch] ${new Date().toISOString()} - News from ${FEEDS.length} sources...`);
  let added = 0, withImage = 0, cached = 0, failed = 0;

  for(const feed of FEEDS){
    try{
      const f = await parser.parseURL(feed.url);
      const items = (f.items || []).slice(0, 5);

      for(const item of items){
        const guid = item.guid || item.link;
        if(!guid) continue;
        if(db.prepare('SELECT 1 FROM news WHERE guid=?').get(guid)) continue;

        const title_en = (item.title || '').trim();
        if(!title_en) continue;

        const summary_en = (item.contentSnippet || item.content || item.summary || '')
          .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);

        const detectedCat = detectCategory(title_en, summary_en, feed.category);

        let title_fa = title_en;
        let summary_fa = summary_en;
        const titleCached = getCachedTranslation(title_en, 'fa');
        try{
          title_fa = await translate(title_en, 'fa');
          if(titleCached) cached++;
        }catch(e){}
        try{
          summary_fa = await translate(summary_en, 'fa');
        }catch(e){}

        const image = extractImage(item);
        if(image) withImage++;

        insertNews.run({
          guid, title_fa, title_en, summary_fa, summary_en,
          content_fa: summary_fa, content_en: summary_en,
          source: feed.source, url: item.link || '',
          category: detectedCat, image,
          published_at: item.isoDate || item.pubDate || new Date().toISOString()
        });
        added++;
        await sleep(200);
      }
      console.log(`   [ok] ${feed.source}`);
    }catch(e){
      console.error(`   [fail] ${feed.source}: ${e.message}`);
      failed++;
    }
  }
  console.log(`[done] ${added} new | ${withImage} with image | ${cached} cached | ${failed} failed\n`);
  return added;
}

/* ═══════════ جمع‌آوری آموزش‌های خودکار ═══════════ */
const insertTutorial = db.prepare(`
  INSERT OR IGNORE INTO tutorials
    (slug, category, title_fa, title_en, summary_fa, summary_en,
     content_fa, content_en, icon, level, read_time, source, url, image,
     is_manual, published_at)
  VALUES (@slug, @category, @title_fa, @title_en, @summary_fa, @summary_en,
          @content_fa, @content_en, @icon, @level, @read_time, @source, @url, @image,
          0, @published_at)
`);

const TUT_ICONS = {
  basics:'🧠', prompt:'✍️', context:'📖', agent:'🤖',
  image:'🎨', voice:'🎙️', code:'💻', finetune:'⚙️'
};

async function fetchAllTutorials(){
  console.log(`[tut] Fetching from ${TUTORIAL_FEEDS.length} tutorial sources...`);
  let added = 0;

  for(const feed of TUTORIAL_FEEDS){
    try{
      const f = await parser.parseURL(feed.url);
      for(const item of (f.items || []).slice(0, 3)){
        const url = item.link || '';
        if(!url) continue;
        const slug = 'auto-' + crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
        if(db.prepare('SELECT 1 FROM tutorials WHERE slug=?').get(slug)) continue;

        const title_en = (item.title || '').trim();
        if(!title_en) continue;
        const summary_en = (item.contentSnippet || item.content || '')
          .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

        const title_fa = await translate(title_en, 'fa');
        const summary_fa = await translate(summary_en, 'fa');

        insertTutorial.run({
          slug,
          category: feed.category,
          title_fa, title_en, summary_fa, summary_en,
          content_fa: summary_fa, content_en: summary_en,
          icon: TUT_ICONS[feed.category] || '📚',
          level: 'intermediate',
          read_time: Math.max(3, Math.ceil(summary_en.split(' ').length / 200)),
          source: feed.source,
          url,
          image: extractImage(item),
          published_at: item.isoDate || new Date().toISOString()
        });
        added++;
        await sleep(300);
      }
      console.log(`   [ok] ${feed.source}`);
    }catch(e){
      console.error(`   [fail] ${feed.source}: ${e.message}`);
    }
  }
  console.log(`[tut done] ${added} new tutorials\n`);
  return added;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ═══════════ داده‌های اولیه‌ی آموزش (دستی) ═══════════ */
function seedManualTutorials(){
  const count = db.prepare('SELECT COUNT(*) as c FROM tutorials WHERE is_manual=1').get().c;
  if(count > 0) return;

  const tutorials = [
    {
      slug:'intro-ai', category:'basics', icon:'🧠', level:'beginner', read_time:8,
      title_fa:'هوش مصنوعی چیه و چطور کار می‌کنه؟',
      title_en:'What is AI and How Does It Work?',
      summary_fa:'آشنایی با مفاهیم پایه‌ی هوش مصنوعی، تفاوت با یادگیری ماشین و یادگیری عمیق، و انواع مدل‌ها.',
      summary_en:'Introduction to AI basics, differences with ML and DL, and types of models.',
      content_fa:'هوش مصنوعی (AI) شاخه‌ای از علوم کامپیوتر است که تلاش می‌کند ماشین‌ها را وادار به انجام کارهایی کند که معمولاً به هوش انسانی نیاز دارند.\n\nتفاوت AI، ML و DL:\n- AI: چتر بزرگ همه‌چیز\n- ML (یادگیری ماشین): زیرمجموعه‌ی AI که مدل‌ها از داده یاد می‌گیرند\n- DL (یادگیری عمیق): زیرمجموعه‌ی ML با شبکه‌های عصبی چندلایه\n\nانواع مدل‌های امروزی:\n- LLM (مدل‌های زبانی): GPT، Claude، Gemini\n- مدل‌های تصویری: DALL-E، Midjourney، FLUX\n- مدل‌های صوتی: Whisper، ElevenLabs\n- مدل‌های ویدیویی: Sora، Runway\n\nهر مدل با «آموزش» روی حجم عظیمی از داده، الگوها را یاد می‌گیرد و سپس می‌تواند پیش‌بینی کند.',
      content_en:'AI is a branch of computer science that tries to make machines perform tasks that normally require human intelligence.\n\nDifferences between AI, ML, DL:\n- AI: the big umbrella\n- ML: subset of AI where models learn from data\n- DL: subset of ML with multi-layer neural networks\n\nTypes of modern models:\n- LLM: GPT, Claude, Gemini\n- Image models: DALL-E, Midjourney, FLUX\n- Voice models: Whisper, ElevenLabs\n- Video models: Sora, Runway',
      published_at:new Date().toISOString()
    },
    {
      slug:'prompt-engineering-basics', category:'prompt', icon:'✍️', level:'beginner', read_time:10,
      title_fa:'اصول مهندسی پرامپت',
      title_en:'Prompt Engineering Basics',
      summary_fa:'یاد بگیر چطور پرامپت‌های مؤثر بنویسی و از مدل‌های زبانی بهترین جواب رو بگیری.',
      summary_en:'Learn how to write effective prompts and get the best responses from LLMs.',
      content_fa:'مهندسی پرامپت یعنی طراحی ورودی (prompt) طوری که مدل بهترین خروجی رو بده.\n\nاصول پایه:\n1. واضح و مشخص باش\n2. هدف رو بگو، نه فقط سوال\n3. مثال بده (Few-shot)\n4. قالب خروجی رو تعیین کن\n5. مرحله‌به‌مرحله بخواه (Chain of Thought)\n\nتکنیک‌های مهم:\n- Zero-shot: فقط سوال\n- Few-shot: چند مثال + سوال\n- Chain of Thought: «قدم به قدم فکر کن»\n- Role Prompting: «تو یک متخصص ... هستی»\n- Self-Consistency: چند بار بپرس و رأی‌گیری کن\n\nاشتباهات رایج:\n- پرامپت مبهم\n- چند سوال در یک پرامپت\n- ندادن زمینه\n- نداشتن مثال',
      content_en:'Prompt engineering means designing input so the model gives the best output.\n\nBasic principles:\n1. Be clear and specific\n2. State the goal, not just the question\n3. Give examples (Few-shot)\n4. Specify output format\n5. Ask step by step (Chain of Thought)',
      published_at:new Date().toISOString()
    },
    {
      slug:'context-engineering', category:'context', icon:'📖', level:'intermediate', read_time:12,
      title_fa:'مهندسی متن و Context Window',
      title_en:'Context Engineering',
      summary_fa:'مدیریت context window، RAG، حافظه‌ی مدل و تکنیک‌های تغذیه‌ی اطلاعات به مدل.',
      summary_en:'Managing context window, RAG, model memory and information-feeding techniques.',
      content_fa:'Context Window یعنی حداکثر مقدار متنی که مدل می‌تونه یک‌بار ببینه.\n\nمشکل: context محدوده و گرون.\nراه‌حل‌ها:\n- خلاصه‌سازی مکالمه\n- RAG (Retrieval Augmented Generation)\n- حافظه‌ی بلندمدت\n- Chunking هوشمند\n\nRAG چیه؟\n1. سوال کاربر → تبدیل به vector\n2. جستجو در دیتابیس برداری\n3. بازیابی ۳-۵ chunk مرتبط\n4. دادن اونها به مدل به‌عنوان context\n5. مدل با اطلاعات واقعی جواب می‌ده\n\nمزیت RAG:\n- اطلاعات به‌روز\n- بدون Fine-tune\n- هزینه‌ی کمتر\n- قابل استناد',
      content_en:'Context Window is the maximum text a model can see at once.\n\nProblems: context is limited and expensive.\nSolutions:\n- Conversation summarization\n- RAG (Retrieval Augmented Generation)\n- Long-term memory\n- Smart chunking',
      published_at:new Date().toISOString()
    },
    {
      slug:'agent-engineering', category:'agent', icon:'🤖', level:'advanced', read_time:15,
      title_fa:'مهندسی ایجنت (AI Agents)',
      title_en:'AI Agent Engineering',
      summary_fa:'ساخت ایجنت‌های هوشمند، ابزارها، Function Calling و فریمورک‌های LangChain و CrewAI.',
      summary_en:'Building intelligent agents, tools, Function Calling and LangChain/CrewAI frameworks.',
      content_fa:'AI Agent یعنی مدلی که نه فقط جواب می‌ده، بلکه «کار» انجام می‌ده.\n\nتفاوت Agent با Chatbot:\n- Chatbot: فقط جواب می‌ده\n- Agent: تصمیم می‌گیره، ابزار استفاده می‌کنه، چند مرحله‌ای کار می‌کنه\n\nاجزای یک Agent:\n1. LLM (مغز)\n2. Tools (ابزارها): جستجو، محاسبه، API\n3. Memory (حافظه)\n4. Planning (برنامه‌ریزی)\n\nFunction Calling:\nمدل می‌تونه توابع تعریف‌شده رو صدا بزنه. مثلاً: get_weather(city)، search_web(query)، send_email(to, body)\n\nفریمورک‌های محبوب:\n- LangChain (پایتون و JS)\n- CrewAI (چند ایجنت)\n- AutoGen (مایکروسافت)\n- LlamaIndex (RAG-محور)\n\nنکته: کد AI رو همیشه بازبینی کن.',
      content_en:'AI Agent is a model that not only answers but performs tasks.\n\nDifferences from Chatbot:\n- Chatbot: only answers\n- Agent: decides, uses tools, multi-step\n\nComponents:\n1. LLM (brain)\n2. Tools: search, calc, API\n3. Memory\n4. Planning\n\nPopular frameworks:\n- LangChain\n- CrewAI\n- AutoGen\n- LlamaIndex',
      published_at:new Date().toISOString()
    },
    {
      slug:'image-engineering', category:'image', icon:'🎨', level:'intermediate', read_time:10,
      title_fa:'مهندسی تصویر با هوش مصنوعی',
      title_en:'AI Image Engineering',
      summary_fa:'تولید و ویرایش تصویر با Midjourney، Stable Diffusion، DALL-E و FLUX.',
      summary_en:'Image generation and editing with Midjourney, Stable Diffusion, DALL-E and FLUX.',
      content_fa:'مدل‌های تصویری امروز می‌تونن از توضیح متنی، تصویر بسازن.\n\nپرامپت تصویری خوب:\n1. موضوع اصلی\n2. سبک (واقع‌گرایانه، انیمه، نقاشی)\n3. نور و رنگ\n4. ترکیب‌بندی (زاویه، فاصله)\n5. جزئیات (کیفیت، رزولوشن)\n\nمثال:\nA serene Japanese garden at sunrise, watercolor style, soft pink and orange light, wide angle, highly detailed, 8k\n\nابزارهای محبوب:\n- Midjourney: بهترین کیفیت هنری\n- Stable Diffusion: رایگان و اوپن‌سورس\n- DALL-E 3: ساده و دقیق\n- FLUX: سریع و باکیفیت\n\nویرایش تصویر:\n- Inpainting: تغییر بخشی از تصویر\n- Outpainting: گسترش تصویر\n- Style Transfer: انتقال سبک',
      content_en:'Modern image models can create images from text descriptions.\n\nGood image prompt:\n1. Main subject\n2. Style (realistic, anime, painting)\n3. Light and color\n4. Composition (angle, distance)\n5. Details (quality, resolution)\n\nTools:\n- Midjourney: best artistic quality\n- Stable Diffusion: free, open-source\n- DALL-E 3: simple, accurate\n- FLUX: fast, high-quality',
      published_at:new Date().toISOString()
    },
    {
      slug:'voice-engineering', category:'voice', icon:'🎙️', level:'intermediate', read_time:8,
      title_fa:'مهندسی صدا و گفتار',
      title_en:'Voice and Speech Engineering',
      summary_fa:'تبدیل متن به گفتار (TTS)، تشخیص گفتار (STT) و تولید موسیقی با AI.',
      summary_en:'Text-to-Speech, Speech-to-Text and AI music generation.',
      content_fa:'مدل‌های صوتی امروز خیلی طبیعی شدن.\n\nTTS (Text-to-Speech):\n- ElevenLabs: طبیعی‌ترین صدا\n- OpenAI TTS: سریع و ارزون\n- Google WaveNet: باکیفیت\n\nSTT (Speech-to-Text):\n- OpenAI Whisper: دقیق و چندزبانه\n- Google Speech: سریع\n- AssemblyAI: با timestamps\n\nکلونینگ صدا:\n- با ۱ دقیقه نمونه، صدای یه نفر رو کپی می‌کنن\n- کاربرد: دوبله، پادکست، دستیار صوتی\n- خطر: جعل صدا\n\nموسیقی با AI:\n- Suno: آهنگ کامل با متن\n- Udio: موسیقی حرفه‌ای\n- MusicGen (Meta): اوپن‌سورس',
      content_en:'Modern voice models are very natural.\n\nTTS: ElevenLabs, OpenAI TTS, Google WaveNet\nSTT: Whisper, Google Speech, AssemblyAI\n\nVoice cloning: with 1 min sample, copy someones voice.\nMusic: Suno, Udio, MusicGen',
      published_at:new Date().toISOString()
    },
    {
      slug:'code-engineering', category:'code', icon:'💻', level:'beginner', read_time:10,
      title_fa:'کدنویسی با هوش مصنوعی',
      title_en:'Coding with AI',
      summary_fa:'استفاده از Copilot، Cursor و ChatGPT برای نوشتن، دیباگ و بهینه‌سازی کد.',
      summary_en:'Using Copilot, Cursor and ChatGPT to write, debug and optimize code.',
      content_fa:'AI امروز یه همکار برنامه‌نویسه.\n\nابزارها:\n- GitHub Copilot: داخل VS Code\n- Cursor: IDE کامل با AI\n- Cline: اوپن‌سورس\n- ChatGPT و Claude: برای سوالات\n\nکاربردها:\n1. تولید کد از توضیح\n2. تکمیل خودکار\n3. دیباگ\n4. Refactor\n5. نوشتن تست\n6. توضیح کد قدیمی\n\nپرامپت خوب برای کد:\n- زبان و نسخه رو بگو\n- ورودی و خروجی رو مشخص کن\n- مثال بده\n- خطاها رو کامل بذار\n\nنکته: کد AI رو همیشه بازبینی کن.',
      content_en:'AI is now a programming partner.\n\nTools: GitHub Copilot, Cursor, Cline, ChatGPT\n\nUses:\n1. Code generation from description\n2. Autocomplete\n3. Debugging\n4. Refactoring\n5. Test writing\n6. Explaining legacy code',
      published_at:new Date().toISOString()
    },
    {
      slug:'finetuning', category:'finetune', icon:'⚙️', level:'advanced', read_time:14,
      title_fa:'Fine-tuning مدل‌ها',
      title_en:'Fine-tuning Models',
      summary_fa:'آموزش مدل روی داده‌ی خودت، تفاوت با RAG، و تکنیک‌های LoRA و QLoRA.',
      summary_en:'Training models on your own data, difference with RAG, LoRA and QLoRA techniques.',
      content_fa:'Fine-tuning یعنی مدل رو روی داده‌ی خودت دوباره آموزش بدی.\n\nچه وقت Fine-tune کنیم؟\n- سبک خاصی از پاسخ می‌خوای\n- دامنه‌ی تخصصی داری\n- RAG کافی نیست\n- نیاز به سرعت بالا\n\nتفاوت با RAG:\n- RAG: اطلاعات جدید به مدل می‌دی، بدون آموزش\n- Fine-tune: رفتار مدل رو تغییر می‌دی\n\nانواع:\n- Full Fine-tune: تمام وزن‌ها (گرون)\n- LoRA: فقط بخش کوچیکی (ارزون)\n- QLoRA: LoRA + کوانتیزیشن (ارزون‌تر)\n\nمراحل:\n1. جمع‌آوری داده (۱۰۰۰+ نمونه)\n2. پاک‌سازی\n3. قالب‌بندی (JSONL)\n4. آموزش\n5. ارزیابی\n\nپلتفرم‌ها:\n- OpenAI Fine-tuning API\n- Together AI\n- Hugging Face\n- Replicate',
      content_en:'Fine-tuning means retraining a model on your own data.\n\nWhen to fine-tune?\n- Specific response style needed\n- Domain expertise\n- RAG is not enough\n- High speed needed\n\nDifference with RAG:\n- RAG: gives new info, no training\n- Fine-tune: changes model behavior\n\nTypes:\n- Full Fine-tune (expensive)\n- LoRA (cheap)\n- QLoRA (cheaper)',
      published_at:new Date().toISOString()
    }
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tutorials
      (slug, category, title_fa, title_en, summary_fa, summary_en,
       content_fa, content_en, icon, level, read_time, is_manual, published_at)
    VALUES (@slug, @category, @title_fa, @title_en, @summary_fa, @summary_en,
            @content_fa, @content_en, @icon, @level, @read_time, 1, @published_at)
  `);

  for(const tut of tutorials) stmt.run(tut);
  console.log(`[seed] ${tutorials.length} manual tutorials added`);
}

/* ═══════════ احراز هویت ═══════════ */
const signToken = u => jwt.sign({ id:u.id, email:u.email, name:u.name }, JWT_SECRET, { expiresIn:'30d' });

function auth(required=false){
  return (req,res,next)=>{
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if(!token){
      if(required) return res.status(401).json({error:'login required'});
      req.user = null; return next();
    }
    try{ req.user = jwt.verify(token, JWT_SECRET); }
    catch{ req.user = null; if(required) return res.status(401).json({error:'invalid token'}); }
    next();
  };
}

app.post('/api/auth/signup', (req,res)=>{
  const { name, email, password } = req.body;
  if(!name || !email || !password || password.length < 4)
    return res.status(400).json({error:'incomplete data'});
  const em = email.toLowerCase().trim();
  if(db.prepare('SELECT 1 FROM users WHERE email=?').get(em))
    return res.status(409).json({error:'email already registered'});
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)')
                  .run(name.trim(), em, hash);
  const u = { id:info.lastInsertRowid, name:name.trim(), email:em };
  res.json({ token: signToken(u), user: u });
});

app.post('/api/auth/login', (req,res)=>{
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase().trim());
  if(!u || !bcrypt.compareSync(password||'', u.password_hash))
    return res.status(401).json({error:'wrong email or password'});
  const pub = { id:u.id, name:u.name, email:u.email };
  res.json({ token: signToken(pub), user: pub });
});

/* ═══════════ Image Proxy (پنهان کردن کلید API) ═══════════ */
const fs = require('fs');
const IMAGE_CACHE_DIR = path.join(__dirname, 'public', 'images', 'cache');
if(!fs.existsSync(IMAGE_CACHE_DIR)) fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });

app.get('/api/image', async (req, res) => {
  const { prompt, seed, width, height } = req.query;
  if(!prompt) return res.status(400).json({error:'prompt required'});

  const w = Math.min(parseInt(width) || 800, 1200);
  const h = Math.min(parseInt(height) || 400, 800);
  const s = parseInt(seed) || 42;
  const p = prompt.slice(0, 200);

  // هش برای نام فایل کش
  const hash = crypto.createHash('md5').update(`${p}|${s}|${w}|${h}`).digest('hex');
  const cacheFile = path.join(IMAGE_CACHE_DIR, `${hash}.jpg`);

  // اگه توی کش هست، مستقیم بفرست
  if(fs.existsSync(cacheFile)){
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return fs.createReadStream(cacheFile).pipe(res);
  }

  // وگرنه از Pollinations بگیر
  const apiKey = process.env.POLLINATIONS_KEY;
  if(!apiKey){
    console.warn('[img] POLLINATIONS_KEY تنظیم نشده');
    return res.status(500).end();
  }

  const encodedPrompt = encodeURIComponent(p);
  const url = `https://gen.pollinations.ai/image/${encodedPrompt}?width=${w}&height=${h}&seed=${s}&model=flux&key=${apiKey}`;

  try{
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if(!r.ok){
      console.error(`[img] Pollinations HTTP ${r.status}`);
      return res.status(r.status).end();
    }

    const buf = Buffer.from(await r.arrayBuffer());
    // ذخیره در کش
    try{ fs.writeFileSync(cacheFile, buf); }catch(e){ console.error('[img] cache write error:', e.message); }

    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  }catch(e){
    console.error('[img] fetch error:', e.message);
    res.status(500).end();
  }
});

app.get('/api/me', auth(true), (req,res)=>{
  res.json({
    user: req.user,
    projects: db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY id DESC').all(req.user.id),
    comments: db.prepare('SELECT * FROM comments WHERE user_id=? ORDER BY id DESC').all(req.user.id)
  });
});

/* ═══════════ API اخبار با صفحه‌بندی ═══════════ */
app.get('/api/news', (req,res)=>{
  const { category, q, page=1, limit=12 } = req.query;
  const offset = (Number(page)-1) * Number(limit);

  let whereSql = 'WHERE 1=1';
  const p = {};
  if(category && category!=='all'){ whereSql += ' AND category=@category'; p.category = category; }
  if(q){ whereSql += ' AND (title_fa LIKE @q OR title_en LIKE @q)'; p.q = `%${q}%`; }

  const total = db.prepare(`SELECT COUNT(*) as c FROM news ${whereSql}`).get(p).c;
  const rows = db.prepare(`
    SELECT id,title_fa,title_en,summary_fa,summary_en,source,url,category,image,published_at,likes
    FROM news ${whereSql}
    ORDER BY datetime(published_at) DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...p, limit: Number(limit), offset });

  res.json({
    items: rows,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
});

app.get('/api/news/stats/categories', (req,res)=>{
  const rows = db.prepare('SELECT category, COUNT(*) as count FROM news GROUP BY category').all();
  res.json(rows);
});

app.get('/api/news/:id', (req,res)=>{
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if(!n) return res.status(404).json({error:'not found'});
  n.comments = db.prepare(`
    SELECT c.id,c.name,c.text,c.created_at,c.user_id
    FROM comments c WHERE c.news_id=? AND c.approved=1
    ORDER BY datetime(c.created_at) DESC`).all(n.id);
  res.json(n);
});

app.post('/api/news/:id/like', (req,res)=>{
  db.prepare('UPDATE news SET likes=likes+1 WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.post('/api/news/:id/comments', auth(true), (req,res)=>{
  const { text } = req.body;
  if(!text) return res.status(400).json({error:'text required'});
  const info = db.prepare('INSERT INTO comments (news_id,user_id,name,text) VALUES (?,?,?,?)')
                 .run(req.params.id, req.user.id, req.user.name, text);
  res.json({ok:true, id:info.lastInsertRowid});
});

/* ═══════════ API آموزش ═══════════ */
app.get('/api/tutorials', (req,res)=>{
  const { category, page=1, limit=12 } = req.query;
  const offset = (Number(page)-1) * Number(limit);

  let whereSql = 'WHERE 1=1';
  const p = {};
  if(category && category!=='all'){ whereSql += ' AND category=@category'; p.category = category; }

  const total = db.prepare(`SELECT COUNT(*) as c FROM tutorials ${whereSql}`).get(p).c;
  const rows = db.prepare(`
    SELECT id,slug,category,title_fa,title_en,summary_fa,summary_en,icon,level,read_time,source,url,image,is_manual
    FROM tutorials ${whereSql}
    ORDER BY is_manual DESC, datetime(published_at) DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...p, limit: Number(limit), offset });

  res.json({
    items: rows,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
});

app.get('/api/tutorials/:slug', (req,res)=>{
  const t = db.prepare('SELECT * FROM tutorials WHERE slug=?').get(req.params.slug);
  if(!t) return res.status(404).json({error:'not found'});
  res.json(t);
});

app.get('/api/tutorials/stats/categories', (req,res)=>{
  const rows = db.prepare('SELECT category, COUNT(*) as count FROM tutorials GROUP BY category').all();
  res.json(rows);
});

/* ═══════════ پروژه‌ها ═══════════ */
app.get('/api/projects', (req,res)=>{
  res.json(db.prepare('SELECT * FROM projects WHERE approved=1 ORDER BY votes DESC, id DESC').all());
});

app.post('/api/projects', auth(true), (req,res)=>{
  const { name, description, category, link, tags, icon, lang } = req.body;
  if(!name || !description) return res.status(400).json({error:'name and description required'});
  const info = db.prepare(`
    INSERT INTO projects (user_id,name,author,category,description,link,tags,icon,lang)
    VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(req.user.id, name, req.user.name, category||'', description, link||'',
        (tags||[]).join(','), icon||'🚀', lang||'fa');
  res.json({ok:true, id:info.lastInsertRowid});
});

app.post('/api/projects/:id/vote', (req,res)=>{
  db.prepare('UPDATE projects SET votes=votes+1 WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

/* ═══════════ ادمین ═══════════ */
const adminAuth = (req,res,next)=>{
  if(req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).end();
  next();
};

app.post('/api/admin/fetch-news', adminAuth, async (req,res)=>{
  try{
    const added = await fetchAllNews();
    const tutAdded = await fetchAllTutorials();
    res.json({ok:true, added, tutorials: tutAdded});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/admin/retranslate', adminAuth, async (req,res)=>{
  const rows = db.prepare("SELECT id, title_en, summary_en FROM news WHERE title_fa = title_en OR title_fa IS NULL").all();
  console.log(`[re] شروع ترجمه‌ی مجدد ${rows.length} خبر...`);
  let count = 0, errors = 0;
  for(const row of rows){
    try{
      const title_fa = await translate(row.title_en, 'fa');
      const summary_fa = await translate(row.summary_en, 'fa');
      db.prepare('UPDATE news SET title_fa=?, summary_fa=?, content_fa=? WHERE id=?')
        .run(title_fa, summary_fa, summary_fa, row.id);
      count++;
      if(count % 5 === 0) console.log(`[re] #${count} OK`);
    }catch(e){
      errors++;
      console.log(`[re] ERROR: ${e.message}`);
    }
    await sleep(300);
  }
  console.log(`[re] تمام شد: ${count} موفق، ${errors} خطا`);
  res.json({ok:true, retranslated: count, total: rows.length, errors});
});
app.get('/api/admin/cache-stats', adminAuth, (req,res)=>{
  const total = db.prepare('SELECT COUNT(*) as c FROM translation_cache').get().c;
  const recent = db.prepare("SELECT COUNT(*) as c FROM translation_cache WHERE created_at > datetime('now', '-1 day')").get().c;
  res.json({total, last24h: recent});
});

/* ═══════════ SPA Fallback ═══════════ */
app.use((req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ═══════════ زمان‌بندی ═══════════ */
cron.schedule(FETCH_CRON, fetchAllNews);
cron.schedule('30 */6 * * *', fetchAllTutorials);

function seedProjects(){
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
  if(count > 0) return;

  const projects = [
    {name:"جعبهابزار هوش مصنوعی (HomeShed MCP)", author:"HomeShed", category:"code", description:"یک سرور MCP با ۱۱۹ ابزار که به دستیار هوش مصنوعی اجازه می‌ده به کامپیوترت دسترسی داشته باشه: Docker، Git، حافظه‌ی بلندمدت و بررسی امنیتی.", link:"https://github.com/homeshed/mcp", tags:"MCP,Python,AI Tools", icon:"🛠️", lang:"fa"},
    {name:"کنترل دسکتاپ با AI (Reflex-CU)", author:"8itlab", category:"code", description:"یک سرور MCP که به AI Agent اجازه می‌ده دسکتاپ Mac و Windows رو کنترل کنه: کلیک، تایپ، اسکرول و اجرای اسکریپت.", link:"https://github.com/8itlab/reflex-cu", tags:"MCP,Automation,Python", icon:"🖥️", lang:"fa"},
    {name:"ارتقای کیفیت عکس لوکال (Local Upscaler)", author:"Local Upscaler", category:"img", description:"ابزار رایگان برای ارتقای کیفیت، شارپ کردن، رفع تاری و رنگی‌کردن عکس. همه‌چیز روی کامپیوتر خودت اجرا می‌شه.", link:"https://github.com/local-upscaler/local-upscaler", tags:"ESRGAN,Image,ONNX", icon:"🖼️", lang:"fa"},
    {name:"حذف اشیاء و ترمیم عکس (IOPaint)", author:"Sanster", category:"img", description:"ابزار ویرایش عکس که حذف محتوا، ترمیم و رفع اشکال رو ممکن می‌کنه: پاک کردن واترمارک، حذف افراد از عکس، ترمیم عکس‌های قدیمی.", link:"https://github.com/Sanster/IOPaint", tags:"Inpainting,PyTorch,OpenCV", icon:"🎨", lang:"fa"},
    {name:"پردازش تصویر در VS Code (Image MCP)", author:"farshid-mcp", category:"img", description:"یک سرور MCP با حدود ۴۰ ابزار پردازش تصویر (OpenCV) که مستقیماً در VS Code Copilot کار می‌کنه: تشخیص چهره، تشخیص QR و فیلترگذاری.", link:"https://github.com/farshid-mcp/imageProcessing", tags:"OpenCV,MCP,Image", icon:"🔍", lang:"fa"},
    {name:"کارمند دیجیتال تمام‌وقت (DeerFlow 2.0)", author:"ByteDance", category:"chatbot", description:"یک فریم‌ورک Agent قدرتمند با بیش از ۵۷ هزار ستاره در گیت‌هاب که کارهای طولانی و چندمرحله‌ای رو خودش انجام می‌ده: تحقیق، نوشتن گزارش و اجرای کد در سندباکس.", link:"https://github.com/bytedance/deerflow", tags:"Agent,LangGraph,Automation", icon:"🤖", lang:"fa"},
    {name:"دستیار اجرایی فریلنسرها (OPC Agents)", author:"lulin70", category:"chatbot", description:"یک سیستم اجرای خودکار که فقط جواب نمی‌ده، کار رو تموم می‌کنه و فایل تحویل می‌ده. مثلاً «گزارش تحقیق بنویس» → فایل MD تحویل می‌ده.", link:"https://github.com/lulin70/OPC-Agents", tags:"Agent,Streamlit,Research", icon:"📋", lang:"fa"},
    {name:"همکار AI تیمی (Tedix)", author:"Tedix HQ", category:"chatbot", description:"AI Agentهایی که کارهای تکرارشونده‌ی تیم رو انجام می‌دهند، قبل از کارهای پرخطر اجازه می‌گیرند و گزارش کامل از کارشون ثبت می‌کنند.", link:"https://github.com/tedix-hq/tedix", tags:"Agent,TypeScript,Team", icon:"👥", lang:"fa"},
    {name:"کم کردن حجم عکس (Pic Smaller)", author:"joye61", category:"img", description:"ابزار رایگان و متن‌باز برای فشرده‌سازی دسته‌ای عکس‌ها که کاملاً در مرورگر اجرا می‌شه. از JPEG، PNG، WEBP، AVIF، SVG و GIF پشتیبانی می‌کنه.", link:"https://github.com/joye61/pic-smaller", tags:"Compression,Browser,JS", icon:"📉", lang:"fa"},
    {name:"تبدیل PDF فارسی به متن (Persian OCR)", author:"Hamed Gharghi", category:"text", description:"ابزار OCR مخصوص زبان فارسی که PDF و عکس رو به متن قابل ویرایش تبدیل می‌کنه. یه قابلیت عالی هم داره: اسکرین‌شات از هر جای صفحه و تبدیل خودکارش به متن.", link:"https://github.com/Hamed-Gharghi/Persian-OCR-App", tags:"OCR,Persian,PDF", icon:"📄", lang:"fa"},
    {name:"مترجم آفلاین (Argos Translate)", author:"Argos Open Tech", category:"text", description:"مترجم آفلاین با بیش از ۵۲۰۰ ستاره در گیت‌هاب. همه‌ی ترجمه‌ها روی CPU یا GPU لوکال انجام می‌شه و داده‌ها به هیچ سروری فرستاده نمی‌شه. از ۴۰+ زبان پشتیبانی می‌کنه.", link:"https://github.com/argosopentech/argos-translate", tags:"Translation,Offline,Python", icon:"🌐", lang:"fa"}
  ];

  const insert = db.prepare(`INSERT INTO projects (user_id, name, author, category, description, link, tags, icon, lang, approved) VALUES (NULL, @name, @author, @category, @description, @link, @tags, @icon, @lang, 1)`);
  for(const p of projects){
    try{ insert.run(p); }catch(e){}
  }
  console.log(`[seed] ${projects.length} پروژه اضافه شد`);
}

seedManualTutorials();
seedProjects();
fetchAllNews();
fetchAllTutorials();

app.listen(process.env.PORT || 3000, ()=>
  console.log(`\n[ready] AI Island backend v9 on http://localhost:${process.env.PORT||3000}`)
);