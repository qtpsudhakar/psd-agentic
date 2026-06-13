import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

const SYSTEM_PROMPT = `You are an expert automated test engineer specializing in the PSD (Page Step Definitions) framework.

Your primary goal is to read a Gherkin .feature file and generate the corresponding steps/pages/*.steps.ts files.

## Workflow

1. **Receive Input:** The user will provide you with the path to a .feature file and the application URL.

2. **Identify Missing Steps (Dry Run):**
   * Run \`npx cucumber-js --dry-run <feature-file>\` using the bash tool.
   * This outputs a list of any steps that are **undefined** — these are the steps you need to create.

3. **Explore Existing Code:**
   * Read the feature file to understand what each scenario does.
   * Read existing step definition files in steps/pages/ to understand the patterns and which steps already exist.
   * Read support/world.ts to understand PSWorld (do NOT modify it).

4. **Implement New Steps:**
   * For each undefined step, write robust Playwright code using user-facing locators.
   * Always add a verification (expect) after every action.

5. **Handle Dynamic Data:** If a step requires unique data, use the support/data.ts module.

6. **Generate and Update Step Definition Files:**
   * Add new steps to the correct existing steps/pages/*.steps.ts file.
   * If the file for that page does not exist, create it with the correct header imports.

## Critical Rules
- **NEVER use Page Object Models (POM).** The step definition IS the implementation.
- **DO NOT modify support/world.ts.** Use support/data.ts for all test data needs.
- **ALWAYS add a verification (expect)** after an action to confirm the app is in the correct state.
- **PRIORITIZE user-facing locators**: getByRole, getByLabel, getByPlaceholder, getByText. Avoid CSS/XPath unless absolutely necessary.

## Step Definition File Header
Every new steps/pages/*.steps.ts file must start with:
\`\`\`typescript
import { Given, When, Then } from "@cucumber/cucumber";
import { PSWorld } from "../../support/world";
import { expect } from "playwright/test";
\`\`\`

## Step Definition Template
\`\`\`typescript
When('step text here', async function (this: PSWorld) {
    const { page } = this;
    await page.getByRole("button", { name: "..." }).click();
    await expect(page.getByRole("heading", { name: "..." })).toBeVisible();
});
\`\`\``;

const TOOLS: Anthropic.Tool[] = [
    {
        name: 'bash',
        description: 'Execute a shell command in the project workspace. Use this to run cucumber dry-run, read directory listings, or any CLI operation.',
        input_schema: {
            type: 'object' as const,
            properties: {
                command: {
                    type: 'string',
                    description: 'The shell command to execute. Runs with the project root as the working directory.',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_file',
        description: 'Read the contents of a file from the project workspace.',
        input_schema: {
            type: 'object' as const,
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file relative to the project root (e.g. "features/empmgmt.feature").',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write content to a file in the project workspace, creating it if it does not exist.',
        input_schema: {
            type: 'object' as const,
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file relative to the project root.',
                },
                content: {
                    type: 'string',
                    description: 'Content to write.',
                },
                append: {
                    type: 'boolean',
                    description: 'If true, append to the file instead of overwriting. Defaults to false.',
                },
            },
            required: ['path', 'content'],
        },
    },
    {
        name: 'list_files',
        description: 'List files and directories inside a directory of the project workspace.',
        input_schema: {
            type: 'object' as const,
            properties: {
                directory: {
                    type: 'string',
                    description: 'Directory path relative to the project root (e.g. "steps/pages").',
                },
            },
            required: ['directory'],
        },
    },
];

async function executeTool(
    name: string,
    input: Record<string, unknown>,
    workspaceRoot: string,
): Promise<string> {
    switch (name) {
        case 'bash': {
            const command = input['command'] as string;
            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd: workspaceRoot,
                    timeout: 120_000,
                });
                let result = '';
                if (stdout) result += `STDOUT:\n${stdout}`;
                if (stderr) result += `STDERR:\n${stderr}`;
                return result || '(no output)';
            } catch (err: any) {
                // cucumber-js --dry-run exits with a non-zero code when steps are undefined
                let result = '';
                if (err.stdout) result += `STDOUT:\n${err.stdout}`;
                if (err.stderr) result += `STDERR:\n${err.stderr}`;
                return result || `Error: ${err.message}`;
            }
        }

        case 'read_file': {
            const filePath = path.join(workspaceRoot, input['path'] as string);
            try {
                return await fs.readFile(filePath, 'utf-8');
            } catch (err: any) {
                return `Error reading file: ${err.message}`;
            }
        }

        case 'write_file': {
            const filePath = path.join(workspaceRoot, input['path'] as string);
            const content = input['content'] as string;
            const append = (input['append'] as boolean) ?? false;
            try {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                if (append) {
                    await fs.appendFile(filePath, content, 'utf-8');
                } else {
                    await fs.writeFile(filePath, content, 'utf-8');
                }
                return `Successfully ${append ? 'appended to' : 'wrote'} ${input['path']}`;
            } catch (err: any) {
                return `Error writing file: ${err.message}`;
            }
        }

        case 'list_files': {
            const dirPath = path.join(workspaceRoot, input['directory'] as string);
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                return entries
                    .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
                    .join('\n') || '(empty directory)';
            } catch (err: any) {
                return `Error listing directory: ${err.message}`;
            }
        }

        default:
            return `Unknown tool: ${name}`;
    }
}

export class TestGeneratorAgent {
    private workspaceRoot: string;
    private client: Anthropic;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.client = new Anthropic();
    }

    async run(featurePath: string, url: string): Promise<void> {
        console.log('TestGeneratorAgent starting');
        console.log(`  Feature : ${featurePath}`);
        console.log(`  URL     : ${url}`);
        console.log('─'.repeat(60));

        const messages: Anthropic.MessageParam[] = [
            {
                role: 'user',
                content:
                    `Generate the missing step definitions for this feature file.\n\n` +
                    `Feature file: ${featurePath}\n` +
                    `Application URL: ${url}\n\n` +
                    `Start with the cucumber dry-run to find undefined steps, then read the ` +
                    `existing step files for patterns, and finally implement and write the new steps.`,
            },
        ];

        // Agentic loop — keep running until Claude signals end_turn
        while (true) {
            const response = await this.client.messages.create({
                model: 'claude-opus-4-8',
                max_tokens: 8192,
                thinking: { type: 'adaptive' },
                system: SYSTEM_PROMPT,
                tools: TOOLS,
                messages,
            });

            // Print Claude's text responses
            for (const block of response.content) {
                if (block.type === 'text' && block.text.trim()) {
                    console.log('\n' + block.text);
                }
            }

            if (response.stop_reason === 'end_turn') {
                console.log('\n' + '─'.repeat(60));
                console.log('Agent finished successfully.');
                break;
            }

            if (response.stop_reason !== 'tool_use') {
                console.log(`Unexpected stop_reason: ${response.stop_reason}`);
                break;
            }

            // Collect and execute all tool calls from this turn
            const toolUseBlocks = response.content.filter(
                (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
            );

            messages.push({ role: 'assistant', content: response.content });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const call of toolUseBlocks) {
                console.log(`\n[Tool] ${call.name}`);
                if (call.name === 'bash') {
                    console.log(`  $ ${(call.input as any).command}`);
                } else if (call.name === 'read_file' || call.name === 'write_file' || call.name === 'list_files') {
                    const p = (call.input as any).path ?? (call.input as any).directory;
                    console.log(`  ${p}`);
                }

                const result = await executeTool(
                    call.name,
                    call.input as Record<string, unknown>,
                    this.workspaceRoot,
                );

                // Print a preview of the result
                const preview = result.length > 600 ? result.slice(0, 600) + '\n...(truncated)' : result;
                console.log(preview);

                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content: result,
                });
            }

            messages.push({ role: 'user', content: toolResults });
        }
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────
// Usage: npx ts-node agents/test-generator.agent.ts <feature-file> <url>
// Example: npx ts-node agents/test-generator.agent.ts features/empmgmt.feature https://app.example.com/
async function main() {
    const [,, featurePath, url] = process.argv;

    if (!featurePath || !url) {
        console.error('Usage: npx ts-node agents/test-generator.agent.ts <feature-file> <url>');
        console.error('Example: npx ts-node agents/test-generator.agent.ts features/empmgmt.feature https://app.example.com/');
        process.exit(1);
    }

    const workspaceRoot = process.cwd();
    const agent = new TestGeneratorAgent(workspaceRoot);
    await agent.run(featurePath, url);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
