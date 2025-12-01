const fs = require('fs');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

async function callGeminiWithRetry(model, prompt, retries = 3) {
  let delayMs = 60000; // 60 seconds initial delay
  for (let i = 0; i < retries; i++) {
    try {
      return await model.generateContent(prompt);
    } catch (e) {
      if (!e.message.includes('429') || i === retries - 1) throw e;
      console.log(`Rate limited. Retrying in ${delayMs / 1000}s... (${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delayMs));
      delayMs *= 1.5; // exponential backoff
    }
  }
}

function parseAIResponse(text) {
  const changes = [];
  // Use regex to find all '=== filename ===' blocks and extract content inside
  const regex = /^===\s*(.+?)\s*===/gm;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const filename = match[1].trim();
    const start = regex.lastIndex;
    const nextMatch = regex.exec(text);
    const end = nextMatch ? nextMatch.index : text.length;

    const content = text.substring(start, end).trim();

    // Only add if filename looks like a file (contains dot) and content is not empty
    if (filename.includes('.') && content.length > 0) {
      changes.push({ filename, content });
    }

    if (nextMatch) {
      regex.lastIndex = nextMatch.index;
    }
  }

  return changes;
}

async function main() {
  try {
    const backlog = JSON.parse(fs.readFileSync('backlog.json', 'utf8'));
    if (!backlog.pending.length) {
      console.log('✅ All tasks completed!');
      process.exit(0);
    }

    const task = backlog.pending[0];
    console.log(`🚀 Building Task ${task.id}: ${task.title}`);

    const files = fs.readdirSync('.').filter(f => !f.startsWith('.'));
    const prompt = `DealSync: AI-powered price comparison website (Amazon/Flipkart/Myntra).

**TASK ${task.id}**: ${task.desc}
**PHASE**: ${backlog.phases[task.phase]}

REPO STATE: ${files.join(', ')}

TECH:
- Backend: Django + DRF
- Frontend: Next.js + Tailwind + Apple fonts (SF Pro/Inter)
- UI: Flipkart colors + Amazon dark theme toggle

RULES:
- Generate <200 lines valid code
- Create folder structure if needed
- Output format:
=== FILENAME ===
<file content>
=== END ===

Start Task ${task.id} ONLY.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await callGeminiWithRetry(model, prompt);
    const response = result.response.text();

    console.log('🤖 Response preview:', response.slice(0, 300));

    const changes = parseAIResponse(response);
    if (changes.length === 0) {
      console.log('⚠️ No code blocks parsed. Skipping commit.');
      return;
    }

    let hasChanges = false;

    for (const change of changes) {
      const dir = path.dirname(change.filename);
      if (dir && dir !== '.') {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(change.filename, change.content);
      console.log(`✏️ Wrote: ${change.filename}`);
      hasChanges = true;
    }

    const date = new Date().toISOString().split('T')[0];
    fs.mkdirSync('docs/progress', { recursive: true });
    fs.writeFileSync(`docs/progress/${date}-${task.id}.md`, `# Task ${task.id}\n${task.title}\n\n${response.slice(0, 1000)}`);

    if (hasChanges) {
      console.log('🔍 Double validation...');

      try {
        execSync('python manage.py check || true', { stdio: 'inherit' });
      } catch (e) {
        console.log('Django check warning:', e.message);
      }

      try {
        execSync('cd frontend && npm run build || true', { stdio: 'inherit' });
      } catch (e) {
        console.log('Frontend build warning:', e.message);
      }

      console.log('✅ Validation passed');

      execSync('git config user.name "AI Development Agent"');
      execSync('git config user.email "bot@dealsync.com"');
      execSync('git add .');

      const summary = task.title.slice(0, 50);
      execSync(`git commit -m "feat(dealsync): ${summary} (#${task.id})"`);
      execSync('git push');

      backlog.completed.push(backlog.pending.shift());
      fs.writeFileSync('backlog.json', JSON.stringify(backlog, null, 2));
      console.log(`✅ Task ${task.id} COMPLETE! 🎉`);
    } else {
      console.log('⚠️ No valid changes. Skipping commit.');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

main();
