import { createInterface } from "node:readline";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const optionSchema = Type.Object({
	label: Type.String({ description: "Short display label (max 30 chars)" }),
	description: Type.String({ description: "Explanation of this option" }),
});

const questionSchema = Type.Object({
	question: Type.String({ description: "The question to ask" }),
	header: Type.String({ description: "Very short label (max 12 chars)" }),
	options: Type.Array(optionSchema),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options" })),
});

const askUserQuestionSchema = Type.Object({
	questions: Type.Array(questionSchema, { description: "Questions to ask (1-4)" }),
});

export type AskUserQuestionInput = Static<typeof askUserQuestionSchema>;

function askSync(
	question: string,
	header: string,
	options: Array<{ label: string; description: string }>,
): Promise<string[]> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });

		console.log(`\n[${header}] ${question}`);
		options.forEach((opt, i) => {
			console.log(`  ${i + 1}. ${opt.label} - ${opt.description}`);
		});
		console.log("  Enter numbers separated by commas, or 0 to skip all");

		rl.question("> ", (answer) => {
			rl.close();
			if (answer === "0" || answer.trim() === "") {
				resolve([]);
				return;
			}
			const indices = answer
				.split(",")
				.map((s) => Number.parseInt(s.trim(), 10) - 1)
				.filter((i) => i >= 0 && i < options.length);
			resolve(indices.map((i) => options[i].label));
		});
	});
}

export function createAskUserQuestionToolDefinition(): ToolDefinition<
	typeof askUserQuestionSchema,
	{ answers: Record<string, string[]> }
> {
	return {
		name: "askuserquestion",
		label: "AskUserQuestion",
		description:
			"Ask the user one or more questions to clarify requirements, gather preferences, or resolve ambiguity. Use when you need more information before proceeding. Ask 1-4 questions, each with 2-4 options.",
		promptSnippet: "askuserquestion(questions) - Ask user clarifying questions",
		promptGuidelines: [
			"Use askuserquestion to clarify requirements or preferences before making changes",
			"Each question should have 2-4 distinct options with clear labels and descriptions",
			"Keep questions focused and concise - the user should understand the tradeoffs",
			"Set multiSelect: true when user could reasonably choose multiple options",
		],
		parameters: askUserQuestionSchema,
		renderShell: "self",
		executionMode: "sequential",
		async execute(_id, params, _signal) {
			const answers: Record<string, string[]> = {};

			for (const q of params.questions) {
				const selected = await askSync(q.question, q.header, q.options);
				if (selected.length > 0) {
					answers[q.question] = selected;
				}
			}

			const answerText = Object.entries(answers)
				.map(([q, a]) => `"${q}": ${a.join(", ")}`)
				.join("; ");

			return {
				content: [{ type: "text" as const, text: answerText || "User skipped all questions." }],
				details: { answers },
			};
		},
	};
}

export function createAskUserQuestionTool(): ReturnType<typeof wrapToolDefinition> {
	return wrapToolDefinition(createAskUserQuestionToolDefinition());
}
