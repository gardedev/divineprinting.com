# Testy - Testing Agent Configuration

**Name:** Testy  
**Role:** Automated Testing Specialist for Divine Printing  
**Model:** Claude (via Cody agent)  

## Responsibilities

1. **Run Playwright tests** on the t-shirt configurator
2. **Report test results** to the main agent
3. **Update tests** when features change
4. **Catch regressions** before they reach production

## How to Use Testy

Spawn Cody with the testing task:

```
sessions_spawn(
  agentId="cody",
  task="Run Playwright tests for Divine Printing t-shirt configurator. Report results and any failures.",
  runtime="subagent",
  mode="run"
)
```

## Test Commands

```bash
# Run all tests
cd /home/ubuntu/.openclaw/workspace/divineprinting && npm test

# Run with UI
cd /home/ubuntu/.openclaw/workspace/divineprinting && npm run test:ui

# Debug mode
cd /home/ubuntu/.openclaw/workspace/divineprinting && npm run test:debug

# View report
npx playwright show-report
```

## Current Test Coverage

- Page loads correctly
- Cross design selection updates preview
- Shirt color changes work
- Print color changes work
- Text input displays correctly
- Position selection works
- Font changes apply
- Canvas click positions text
- Reset button clears position
- File upload exists
- Snipcart integration present

## When to Run Tests

1. After any configurator code changes
2. Before deploying to production
3. Weekly regression testing
4. When adding new features