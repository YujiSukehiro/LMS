from pathlib import Path
import re

root = Path('/Users/connor/Coding/Contracting/Logicall/Telehealth LMS')
docs = root / 'docs' / 'upgrades'
expected = [
    '00_README.md',
    '01_APPLICATION_AND_LEARNING_REVIEW.md',
    '02_SOURCE_OF_TRUTH_AND_CURRICULUM_QUALITY.md',
    '03_LOCAL_AI_RUNTIME_AND_RELIABILITY.md',
    '04_CALL_AND_WORKFLOW_SIMULATION.md',
    '05_LEARNING_CERTIFICATION_AND_ANALYTICS.md',
    '06_STANDARD_MEDS_CONTENT_PACK.md',
    '07_IMPLEMENTATION_AND_ACCEPTANCE_PLAN.md',
    '08_ASD_STE100_NEXT_CHAT_PROMPT.md',
]

errors = []
for name in expected:
    path = docs / name
    if not path.is_file() or path.stat().st_size == 0:
        errors.append(f'Missing or empty: {name}')

link_pattern = re.compile(r'(?<!!)\[[^\]]+\]\(([^)]+)\)')
for name in expected:
    path = docs / name
    if not path.is_file():
        continue
    text = path.read_text(encoding='utf-8')
    for target in link_pattern.findall(text):
        target = target.split()[0].strip('<>')
        if '://' in target or target.startswith('#'):
            continue
        clean_target = target.split('#', 1)[0]
        if clean_target and not (path.parent / clean_target).exists():
            errors.append(f'Broken link in {name}: {target}')

prompt = (docs / '08_ASD_STE100_NEXT_CHAT_PROMPT.md').read_text(encoding='utf-8')
original = '/Users/connor/Coding/Contracting/Logicall/Telehealth LMS'
fork = '/Users/connor/Coding/Contracting/Logicall/Telehealth LMS/upgrade-fork'
for required in [original, fork, "--exclude 'upgrade-fork/'", 'feature/standard-meds-learning-upgrades', 'chore: preserve pre-upgrade baseline', 'npm run verify:ollama', 'npm run verify:local-ai', 'OpenAI-compatible local HTTP adapter', 'Do not add an MLX SDK', 'Connor explicitly authorizes subagents and swarm mode', 'Swarm operating mode', 'at most 3 implementation agents']:
    if required not in prompt:
        errors.append(f'Prompt missing required text: {required}')

for name in expected:
    text = (docs / name).read_text(encoding='utf-8')
    for forbidden in ['I implemented the upgrade', 'The application upgrade has been performed', 'sk-live-', 'sk-proj-']:
        if forbidden in text:
            errors.append(f'Forbidden claim or secret-like text in {name}: {forbidden}')

print(f'Checked {len(expected)} Upgrade Docs.')
for name in expected:
    path = docs / name
    if path.exists():
        print(f'  {name}: {path.stat().st_size} bytes')
if errors:
    print('VERIFICATION FAILED')
    for error in errors:
        print(f'  - {error}')
    raise SystemExit(1)
print('VERIFICATION PASSED: files, local links, fork paths, branch, and handoff requirements.')
