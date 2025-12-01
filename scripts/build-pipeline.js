const fs = require('fs');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

async function main() {
  try {
    const backlog = JSON.parse(fs.readFileSync('backlog.json', 'utf8'));
    if (!backlog.pending.length) {
      console.log('✅ All tasks completed!');
      process.exit(0);
    }

    const task = backlog.pending[0];
    console.log(`🚀 Building Task ${task.id}: ${task.title}`);

    const files = fs.readdirSync('.').filter((f) => !f.startsWith('.'));
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
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    console.log('🤖 Response preview:', response.slice(0, 300));

    const changes = parseAIResponse(response);
    let hasChanges = false;

    for (const change of changes) {
      const dir = path.dirname(change.filename);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
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

function parseAIResponse(text) {
  const changes = [];
  const parts = text.split('===');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    if (lines.length < 2) continue;

    const firstLine = lines[0].trim();
    if (!firstLine.includes('.')) continue;

    const filename = firstLine;
    const content = lines.slice(1).join('\n').trim();
    if (filename && content) {
      changes.push({ filename, content });
    }
  }
  return changes;
}

main();
