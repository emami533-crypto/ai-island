const Database = require('better-sqlite3');
const db = new Database('ai-island.db');

const projects = [
  {name:"جعبهابزار هوش مصنوعی (HomeShed MCP)", author:"HomeShed", category:"code", description:"یک سرور MCP با ۱۱۹ ابزار که به دستیار هوش مصنوعی اجازه می‌ده به کامپیوترت دسترسی داشته باشه: Docker، Git، حافظه‌ی بلندمدت و بررسی امنیتی.", link:"https://github.com/homeshed/mcp", tags:"MCP,Python,AI Tools", icon:"🛠️", lang:"fa"},
  {name:"کنترل دسکتاپ با AI (Reflex-CU)", author:"8itlab", category:"code", description:"یک سرور MCP که به AI Agent اجازه می‌ده دسکتاپ Mac و Windows رو کنترل کنه: کلیک، تایپ، اسکرول و اجرای اسکریپت.", link:"https://github.com/8itlab/reflex-cu", tags:"MCP,Automation,Python", icon:"🖥️", lang:"fa"},
  {name:"ارتقای کیفیت عکس لوکال (Local Upscaler)", author:"Local Upscaler", category:"img", description:"ابزار رایگان برای ارتقای کیفیت، شارپ کردن، رفع تاری و رنگی‌کردن عکس. همه‌چیز روی کامپیوتر خودت اجرا می‌شه.", link:"https://github.com/local-upscaler/local-upscaler", tags:"ESRGAN,Image,ONNX", icon:"🖼️", lang:"fa"},
  {name:"حذف اشیاء و ترمیم عکس (IOPaint)", author:"Sanster", category:"img", description:"ابزار ویرایش عکس که حذف محتوا، ترمیم و رفع اشکال رو ممکن می‌کنه: پاک کردن واترمارک، حذف افراد از عکس، ترمیم عکس‌های قدیمی.", link:"https://github.com/Sanster/IOPaint", tags:"Inpainting,PyTorch,OpenCV", icon:"🎨", lang:"fa"},
  {name:"پردازش تصویر در VS Code", author:"farshid-mcp", category:"img", description:"یک سرور MCP با حدود ۴۰ ابزار پردازش تصویر (OpenCV) که مستقیماً در VS Code Copilot کار می‌کنه: تشخیص چهره، تشخیص QR و فیلترگذاری.", link:"https://github.com/farshid-mcp/imageProcessing", tags:"OpenCV,MCP,Image", icon:"🔍", lang:"fa"},
  {name:"کارمند دیجیتال تمام‌وقت (DeerFlow 2.0)", author:"ByteDance", category:"chatbot", description:"یک فریم‌ورک Agent قدرتمند با بیش از ۵۷ هزار ستاره در گیت‌هاب که کارهای طولانی و چندمرحله‌ای رو خودش انجام می‌ده: تحقیق، نوشتن گزارش و اجرای کد.", link:"https://github.com/bytedance/deerflow", tags:"Agent,LangGraph,Automation", icon:"🤖", lang:"fa"},
  {name:"دستیار اجرایی فریلنسرها (OPC Agents)", author:"lulin70", category:"chatbot", description:"یک سیستم اجرای خودکار که فقط جواب نمی‌ده، کار رو تموم می‌کنه و فایل تحویل می‌ده. مثلاً «گزارش تحقیق بنویس» → فایل MD تحویل می‌ده.", link:"https://github.com/lulin70/OPC-Agents", tags:"Agent,Streamlit,Research", icon:"📋", lang:"fa"},
  {name:"همکار AI تیمی (Tedix)", author:"Tedix HQ", category:"chatbot", description:"AI Agentهایی که کارهای تکرارشونده‌ی تیم رو انجام می‌دهند، قبل از کارهای پرخطر اجازه می‌گیرند و گزارش کامل از کارشون ثبت می‌کنند.", link:"https://github.com/tedix-hq/tedix", tags:"Agent,TypeScript,Team", icon:"👥", lang:"fa"},
  {name:"کم کردن حجم عکس (Pic Smaller)", author:"joye61", category:"img", description:"ابزار رایگان و متن‌باز برای فشرده‌سازی دسته‌ای عکس‌ها که کاملاً در مرورگر اجرا می‌شه. از JPEG، PNG، WEBP، AVIF، SVG و GIF پشتیبانی می‌کنه.", link:"https://github.com/joye61/pic-smaller", tags:"Compression,Browser,JS", icon:"📉", lang:"fa"},
  {name:"تبدیل PDF فارسی به متن (Persian OCR)", author:"Hamed Gharghi", category:"text", description:"ابزار OCR مخصوص زبان فارسی که PDF و عکس رو به متن قابل ویرایش تبدیل می‌کنه. یه قابلیت عالی هم داره: اسکرین‌شات از هر جای صفحه و تبدیل خودکارش به متن.", link:"https://github.com/Hamed-Gharghi/Persian-OCR-App", tags:"OCR,Persian,PDF", icon:"📄", lang:"fa"},
  {name:"مترجم آفلاین (Argos Translate)", author:"Argos Open Tech", category:"text", description:"مترجم آفلاین با بیش از ۵۲۰۰ ستاره در گیت‌هاب. همه‌ی ترجمه‌ها روی CPU یا GPU لوکال انجام می‌شه و داده‌ها به هیچ سروری فرستاده نمی‌شه. از ۴۰+ زبان پشتیبانی می‌کنه.", link:"https://github.com/argosopentech/argos-translate", tags:"Translation,Offline,Python", icon:"🌐", lang:"fa"}
];

const insert = db.prepare(`INSERT INTO projects (user_id, name, author, category, description, link, tags, icon, lang, approved) VALUES (NULL, @name, @author, @category, @description, @link, @tags, @icon, @lang, 1)`);
const checkExist = db.prepare('SELECT 1 FROM projects WHERE name = ?');

let added = 0;
for(const p of projects){
  if(checkExist.get(p.name)) continue;
  insert.run(p);
  added++;
}
console.log(`✅ ${added} پروژه اضافه شد.`);